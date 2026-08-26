// src/lib/personalOkr/periodReviewReference.ts
//
// 【設計意図】
// 「全体」タブ（月全体・四半期全体の振り返り。v3.101・CLAUDE.md Section 24 Step Q）の
// 参考値（機械計算）を組み立てる純粋関数群。山本さんが選んだ設計判断（仕様書§0-1）：
// 全体%の算出は「参考値として機械計算を提示し、確定は手入力」。
//
// 【計算式（画面にもそのまま明記する）】
// 月ブロック：Σ(KRの自己評価% × weight_pct) ÷ Σ(weight_pct)
//   → その月の personal_kr_months.self_eval_pct をそのままKRごとの値として使う。
// 四半期ブロック：Σ(KRの自己評価%の3か月平均 × weight_pct) ÷ Σ(weight_pct)
//   → 各KRについて、四半期内の3か月のうち記入がある月のself_eval_pctの単純平均を
//     まず求め（＝「3か月の平均」）、それをKRの値として月ブロックと同じ加重平均に使う。
// GM評価%も同じ式（self_eval_pctをgm_eval_pctに読み替え）で独立に計算する。
//
// 🔴 weight_pctが全て0、または記入済みKR（値がある行）が0件のときはnullを返す
// （0除算・誤解を招く0%表示を避けるため。呼び出し側は「参考値を出せません」と表示する）。

export interface KrPeriodRow {
  krId: string;
  label: string;
  weightPct: number;
  selfEvalPct: number | null;
  gmEvalPct: number | null;
}

export interface PeriodReference {
  selfEvalPct: number | null;
  gmEvalPct: number | null;
}

/**
 * Σ(value × weight) ÷ Σ(weight)。value が null、または weight が 0以下の行は
 * 分子・分母のどちらからも除外する。対象行が1件も残らない（＝記入済みKRが0件）、または
 * 残った行のweight合計が0以下（＝weight_pctが実質すべて0）ならnullを返す。
 */
export function computeWeightedAverage(rows: { weightPct: number; value: number | null }[]): number | null {
  const filled = rows.filter(r => r.value != null && r.weightPct > 0);
  const totalWeight = filled.reduce((sum, r) => sum + r.weightPct, 0);
  if (filled.length === 0 || totalWeight <= 0) return null;
  const sum = filled.reduce((s, r) => s + r.weightPct * (r.value as number), 0);
  return sum / totalWeight;
}

/** 記入がある値だけの単純平均（「3か月の平均」）。1件も無ければnull。 */
export function computeMonthlyAverage(values: (number | null | undefined)[]): number | null {
  const filled = values.filter((v): v is number => v != null);
  if (filled.length === 0) return null;
  return filled.reduce((s, v) => s + v, 0) / filled.length;
}

/** KRごとの行（月ブロックなら当月の値、四半期ブロックなら3か月平均済みの値）から、自己評価%・GM評価%の参考値を独立に算出する。 */
export function computePeriodReference(rows: KrPeriodRow[]): PeriodReference {
  return {
    selfEvalPct: computeWeightedAverage(rows.map(r => ({ weightPct: r.weightPct, value: r.selfEvalPct }))),
    gmEvalPct: computeWeightedAverage(rows.map(r => ({ weightPct: r.weightPct, value: r.gmEvalPct }))),
  };
}
