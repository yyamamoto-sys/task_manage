// src/lib/mentions.ts
// @メンション文字列のパース・比較ユーティリティ

/** コメント文字列から @short_name の配列を抽出（重複除去）。 */
export function extractMentions(comment: string): string[] {
  const matches = comment.match(/@([^\s@]+)/g) ?? [];
  return [...new Set(matches.map(m => m.slice(1)))];
}

/** 2つの mentions 配列が同じ集合かどうかを判定（重複・順序は無視）。 */
export function mentionsEqual(a: string[], b: string[]): boolean {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size !== setB.size) return false;
  for (const x of setA) if (!setB.has(x)) return false;
  return true;
}

/** タスクを保存する全経路（編集モーダル・サイドパネル・新規登録）が使う、finalized_mentions の唯一の確定規則。
 *  通知は finalized_mentions の変化だけを見るため、保存のたびに必ずこの値を書く。 */
export function finalizedMentionsOf(comment: string): string[] {
  return extractMentions(comment);
}
