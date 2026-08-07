// src/lib/personalOkr/weightCheck.ts
//
// 【設計意図】
// 個人KRのウェイト合計が100%かどうかの判定。docs/dev/okr-redesign-plan.md §10の決定事項
// 「合計100%でなければ警告のみ・保存は妨げない（Kintoneが正本のためDB制約では強制しない）」
// をUI側で表示するための純粋関数。

const EPSILON = 0.01;

export function sumWeightPct(items: { weight_pct: number }[]): number {
  return items.reduce((sum, i) => sum + (i.weight_pct || 0), 0);
}

/** 合計が100からEPSILONを超えてずれていれば警告表示の対象 */
export function isWeightTotalWarning(total: number): boolean {
  return Math.abs(total - 100) > EPSILON;
}
