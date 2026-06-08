// src/lib/mentions.ts
// @メンション文字列のパース・比較ユーティリティ

/** コメント文字列から @short_name の配列を抽出（重複除去）。 */
export function extractMentions(comment: string): string[] {
  const matches = comment.match(/@([^\s@]+)/g) ?? [];
  return [...new Set(matches.map(m => m.slice(1)))];
}

/** 2つの mentions 配列が同じ集合かどうかを判定。 */
export function mentionsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  return b.every(x => setA.has(x));
}
