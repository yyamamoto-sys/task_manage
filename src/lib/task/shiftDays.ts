// src/lib/task/shiftDays.ts
// 「日程をずらす」の日数入力の解釈（v3.156）。整数（プラス＝後ろ・マイナス＝前）だけを受け付け、0・小数・空・非数は null。
// 全角の数字・「＋」「－」も受け付ける（日本語入力のまま打たれても解釈できるように）。

export const MAX_SHIFT_DAYS = 3650;

export function parseShiftDays(raw: string): number | null {
  const norm = raw
    .trim()
    .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[－−ー]/g, "-")
    .replace(/＋/g, "+");
  if (!/^[+-]?\d+$/.test(norm)) return null;
  const n = parseInt(norm, 10);
  if (n === 0 || Math.abs(n) > MAX_SHIFT_DAYS) return null;
  return n;
}
