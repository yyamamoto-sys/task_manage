// src/lib/supabase/client.ts
import { createClient } from "@supabase/supabase-js";
import { isGuestMode, GUEST_READONLY_MESSAGE } from "../guestMode";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const isMisconfigured = !url || !key;

// 未設定の場合は App.tsx の isMisconfigured チェックで止まるため、
// ここでは空文字フォールバックでクライアントを生成しておく（呼ばれない）
const rawClient = createClient(url ?? "", key ?? "");

// ===== ゲスト（閲覧のみ）モードの書き込みブロック =====
//
// ゲストモード時は from(table).insert/update/upsert/delete を「失敗」させる。
// 読み取り（select）・realtime（channel）・auth・functions.invoke はそのまま通す。
// これにより通常編集も AI 提案の反映も、テーブル書き込みは一切 DB に届かない。
// 呼び出し側は `if (error) throw error` で扱うため、書き込みは例外として弾かれ、
// 楽観更新は handleSaveError の reload で巻き戻る。

const GUEST_WRITE_ERROR = {
  message: GUEST_READONLY_MESSAGE,
  code: "GUEST_READONLY",
  details: "",
  hint: "",
};

/** どのメソッドを繋いでも {data:null, error} を resolve する、チェーン可能な thenable。 */
function blockedQuery(): unknown {
  const result = { data: null, error: GUEST_WRITE_ERROR };
  const chain: Record<string, unknown> = {
    then: (onF: ((v: unknown) => unknown) | null, onR?: ((e: unknown) => unknown) | null) =>
      Promise.resolve(result).then(onF ?? undefined, onR ?? undefined),
    catch: (onR: (e: unknown) => unknown) => Promise.resolve(result).catch(onR),
    finally: (onFin: () => void) => Promise.resolve(result).finally(onFin),
  };
  const passthrough = () => chain;
  for (const m of [
    "select", "eq", "neq", "in", "is", "match", "order", "limit", "single",
    "maybeSingle", "gte", "lte", "gt", "lt", "or", "filter", "contains", "range", "csv",
  ]) {
    chain[m] = passthrough;
  }
  return chain;
}

const WRITE_METHODS = new Set(["insert", "update", "upsert", "delete"]);

export const supabase = new Proxy(rawClient, {
  get(target, prop, receiver) {
    if (prop === "from") {
      return (table: string) => {
        const builder = target.from(table);
        if (!isGuestMode()) return builder;
        return new Proxy(builder as object, {
          get(bTarget, bProp, bReceiver) {
            if (typeof bProp === "string" && WRITE_METHODS.has(bProp)) {
              return () => blockedQuery();
            }
            return Reflect.get(bTarget, bProp, bReceiver);
          },
        });
      };
    }
    return Reflect.get(target, prop, receiver);
  },
});
