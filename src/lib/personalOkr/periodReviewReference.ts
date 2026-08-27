// src/lib/personalOkr/periodReviewReference.ts
//
// 【設計意図】
// 「全体」タブ（月全体・四半期全体の振り返り。v3.101・CLAUDE.md Section 24 Step Q）の
// 参考値（機械計算）を組み立てる純粋関数群。山本さんが選んだ設計判断（仕様書§0-1）：
// 全体%の算出は「参考値として機械計算を提示し、確定は手入力」。
//
// 【計算式（画面にもそのまま明記する）】
// 月ブロック：Σ(KRの自己評価% × その月の実効ウェイト) ÷ Σ(その月の実効ウェイト)（対象KRのみ）
//   → その月の personal_kr_months.self_eval_pct をそのままKRごとの値として使う。
//     「実効ウェイト」＝ src/lib/personalOkr/krMonthScope.ts の resolveEffectiveWeightPct()
//     （対象外のKRは分子・分母どちらにも含めない。月ごとの上書きがあればそれを使う）。
// 🔴【2026-08-26・v3.104で変更】四半期ブロック：月ごとに参考値を出し、それらを平均する。
//   v3.101当時は「各KRの3か月平均self_eval_pct × 四半期ウェイト」だったが、月をまたいで
//   対象KR・ウェイトの両方が変わる運用に対応した結果、KR単位で「四半期を通した1つのウェイト」
//   という前提そのものが成り立たなくなったため、算出単位を「月」に変えた。
//   具体的には、3か月それぞれについて上の月ブロックと同じ式で月次参考値を求め（対象外の月は
//   その月だけ算出不可＝null）、その3つの値を computeMonthlyAverage() で単純平均する
//   （averageMonthlyReferences()）。GM評価%も同じ式（self_eval_pctをgm_eval_pctに読み替え）で
//   独立に計算する。
//
// 🔴 実効ウェイトが全て0、または記入済みKR（値がある行）が0件のときはnullを返す
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

/** KRごとの行（その月の対象KR・実効ウェイトの行）から、自己評価%・GM評価%の参考値を独立に算出する。 */
export function computePeriodReference(rows: KrPeriodRow[]): PeriodReference {
  return {
    selfEvalPct: computeWeightedAverage(rows.map(r => ({ weightPct: r.weightPct, value: r.selfEvalPct }))),
    gmEvalPct: computeWeightedAverage(rows.map(r => ({ weightPct: r.weightPct, value: r.gmEvalPct }))),
  };
}

/**
 * 🔴【2026-08-26・v3.104で新設】四半期ブロックの参考値＝3か月分の月次参考値（computePeriodReference
 * の結果）を単純平均する。算出できない月（対象KRが0件・実効ウェイト合計0等でnull）は
 * computeMonthlyAverage()が自動的に除外する。自己評価%・GM評価%は独立に算出する。
 */
export function averageMonthlyReferences(monthly: PeriodReference[]): PeriodReference {
  return {
    selfEvalPct: computeMonthlyAverage(monthly.map(m => m.selfEvalPct)),
    gmEvalPct: computeMonthlyAverage(monthly.map(m => m.gmEvalPct)),
  };
}
