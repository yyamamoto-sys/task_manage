// src/lib/supabase/client.ts
import { createClient } from "@supabase/supabase-js";
import { isGuestMode, GUEST_READONLY_MESSAGE } from "../guestMode";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const isMisconfigured = !url || !key;

// 未設定の場合は App.tsx の isMisconfigured チェックで止まるため、
// ここでは空文字フォールバックでクライアントを生成しておく（呼ばれない）
const rawClient = createClient(url ?? "", key ?? "");

// ===== ゲスト（サンプル閲覧）モードの Supabase 遮断 =====
//
// 【設計意図・2026-08-06改訂】
// 旧実装は from(table) の insert/update/upsert/delete のみをブロックし、select（読み取り）・
// rpc・functions.invoke・storage は素通りしていた。ゲストは独立した権限主体ではなく既存の
// 認証セッション／RLS に被せた見た目だけのペルソナのため、読み取りを許すと自部署の実業務
// データが全部ゲストに見えてしまう穴になっていた（調査で判明・guestMode.ts参照）。
//
// そのため方針を「特定の経路を塞ぐ」から「原則全部止める」に反転する。ゲストモード時は
// from()（読み書き両方）・rpc()・functions.invoke()・storage の全経路を、下の
// assertGuestBlocked() という単一の choke point で止める。新しい経路（例：Supabase の
// 別APIを使う新機能）を追加しても、このProxyのgetトラップを通る限り自動的に塞がれる。
//
// ゲストの画面はこの経路を一切使わず、appStore にサンプルデータ（src/lib/demo/）を
// 直接注入して表示する（App.tsx / AppDataContext.tsx 参照）。

const GUEST_BLOCKED_RESULT = {
  data: null,
  error: {
    message: GUEST_READONLY_MESSAGE,
    code: "GUEST_READONLY",
    details: "",
    hint: "",
  },
};

/**
 * ゲストモード時に Supabase への実アクセスを止める単一の choke point。
 * from/rpc/functions.invoke/storage の全経路がここを通る。
 * true を返したら「ブロックする」ことを示す。呼び出し側は実クライアントを一切呼ばず、
 * ダミーの失敗レスポンスだけを返すこと。
 */
function assertGuestBlocked(): boolean {
  return isGuestMode();
}

/** どのメソッドを繋いでも {data:null, error} を resolve する、チェーン可能な thenable。 */
function blockedQuery(): unknown {
  const chain: Record<string, unknown> = {
    then: (onF: ((v: unknown) => unknown) | null, onR?: ((e: unknown) => unknown) | null) =>
      Promise.resolve(GUEST_BLOCKED_RESULT).then(onF ?? undefined, onR ?? undefined),
    catch: (onR: (e: unknown) => unknown) => Promise.resolve(GUEST_BLOCKED_RESULT).catch(onR),
    finally: (onFin: () => void) => Promise.resolve(GUEST_BLOCKED_RESULT).finally(onFin),
  };
  const passthrough = () => chain;
  // select系（読み取り）と insert/update/upsert/delete（書き込み）の両方を同じダミー
  // チェーンで受ける。ゲストは読み取りも from() の時点で完全にブロックするため、
  // どのメソッドが呼ばれても以後は全部この chain 止まりになる。
  for (const m of [
    "select", "insert", "update", "upsert", "delete",
    "eq", "neq", "in", "is", "match", "order", "limit", "single",
    "maybeSingle", "gte", "lte", "gt", "lt", "or", "filter", "contains", "range", "csv",
  ]) {
    chain[m] = passthrough;
  }
  return chain;
}

/** storage.from(bucket) 配下の呼び出しをブロックするダミー実装。 */
function blockedStorageBucket(): unknown {
  return {
    download: () => Promise.resolve(GUEST_BLOCKED_RESULT),
    upload: () => Promise.resolve(GUEST_BLOCKED_RESULT),
    remove: () => Promise.resolve(GUEST_BLOCKED_RESULT),
    list: () => Promise.resolve(GUEST_BLOCKED_RESULT),
    getPublicUrl: () => ({ data: { publicUrl: "" } }),
    createSignedUrl: () => Promise.resolve(GUEST_BLOCKED_RESULT),
  };
}

export const supabase = new Proxy(rawClient, {
  get(target, prop, receiver) {
    if (prop === "from") {
      return (table: string) => {
        if (assertGuestBlocked()) return blockedQuery();
        return target.from(table);
      };
    }
    if (prop === "rpc") {
      return (fn: string, params?: unknown, options?: unknown) => {
        if (assertGuestBlocked()) return Promise.resolve(GUEST_BLOCKED_RESULT);
        return (target.rpc as (fn: string, params?: unknown, options?: unknown) => unknown)(fn, params, options);
      };
    }
    if (prop === "functions") {
      const functions = target.functions;
      return new Proxy(functions, {
        get(fTarget, fProp, fReceiver) {
          if (fProp === "invoke") {
            return (functionName: string, options?: unknown) => {
              // ⚠️ Phase 3（次のリリース）でゲストにAI機能を限定開放する予定がある。
              // その際はここで functionName や options 側の intent を見て、許可リストの
              // 呼び出しだけ target.invoke() へ通す例外を1つ足す形にする。今回は全面ブロック。
              if (assertGuestBlocked()) return Promise.resolve(GUEST_BLOCKED_RESULT);
              return (fTarget.invoke as (fn: string, o?: unknown) => unknown)(functionName, options);
            };
          }
          return Reflect.get(fTarget, fProp, fReceiver);
        },
      });
    }
    if (prop === "storage") {
      const storage = target.storage;
      return new Proxy(storage, {
        get(sTarget, sProp, sReceiver) {
          if (sProp === "from") {
            return (bucket: string) => {
              if (assertGuestBlocked()) return blockedStorageBucket();
              return (sTarget.from as (b: string) => unknown)(bucket);
            };
          }
          return Reflect.get(sTarget, sProp, sReceiver);
        },
      });
    }
    return Reflect.get(target, prop, receiver);
  },
});
