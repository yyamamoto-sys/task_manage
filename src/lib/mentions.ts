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
