// src/lib/feedback/snapshotContext.ts
//
// ご意見のスナップショットの材料を、画面側が登録した getter から「送信時に取りに行く」ための小さな登録所
// （v3.157・CLAUDE.md Section 82）。unsavedEditorRegistry と同じ pull 型：MainLayout・リスト・ガント・カンバンが
// 自分の見えている設定（列挙値・ID・件数・真偽）だけを返す getter を登録し、スナップショットの構築側は
// 画面の内部 state・DOM を直接読まない。
//
// 🔴 getter が返してよいのは「列挙値・数値・ID・真偽」だけ。タスク名・PJ名・検索語などの文字列は返さない
//    （返しても snapshot.ts の許可リストで落ちるが、最初から渡さないこと）。
// 返り値は最上位のキー（mode／view／listSettings／selection 等）ごとのオブジェクトで、複数の getter が同じキー
// （selection など）を返したら浅くマージする（後から登録した getter が同名のフィールドを上書き）。

type SnapshotPart = Record<string, unknown>;
export type SnapshotProvider = () => SnapshotPart | null | undefined;

const providers = new Map<string, SnapshotProvider>();

/** マウント時に呼ぶ。返り値で解除する（解除漏れがあると閉じた画面の設定がスナップショットに残る） */
export function registerSnapshotProvider(id: string, getter: SnapshotProvider): () => void {
  providers.set(id, getter);
  return () => {
    // 同じ id を別のインスタンスが登録し直していたら、そちらを消さない
    if (providers.get(id) === getter) providers.delete(id);
  };
}

export function snapshotProviderCount(): number {
  return providers.size;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 登録された getter を呼んでマージする。1つの getter の例外で他を止めない（スナップショットは付随機能） */
export function collectSnapshotContext(): SnapshotPart {
  const out: SnapshotPart = {};
  for (const [id, getter] of providers) {
    let part: SnapshotPart | null | undefined;
    try {
      part = getter();
    } catch (e) {
      console.warn(`[feedback] スナップショットの材料（${id}）の取得に失敗:`, e);
      continue;
    }
    if (!isPlainObject(part)) continue;
    for (const [key, value] of Object.entries(part)) {
      const prev = out[key];
      out[key] = isPlainObject(prev) && isPlainObject(value) ? { ...prev, ...value } : value;
    }
  }
  return out;
}
