// src/lib/personalOkr/tourPreviewSample.ts
//
// 【設計意図】
// OKRモードの初回ガイドツアー（src/components/tour/tours/okr-intro.ts）で、対象期にKRが
// 1本も無い利用者にサンプルのKR・月次計画・週カードを差し込んで表示するかどうかを判定する
// 純粋関数。CLAUDE.md Section 24・docs/dev/tour-guidelines.md 参照。
//
// 判定は「OKRツアーが実行中か」×「その期のKRが0本かどうか」の2点だけで行う（山本さんの
// 指示：切り分けは「その期のKRが0本かどうか」の1点だけ）。
// - ツアー実行中でなければ常にfalse（ツアー外ではサンプルを出さない。空状態の案内文を見せる）。
// - 対象期にKRが1本でもあれば常にfalse（既存データがある人はその人の実データで案内する）。
//   ゲストはv3.67で既にサンプルKRが「実データ」として注入されているため、この条件だけで
//   自然に「二重差し込みしない」が成立する（isGuestかどうかを個別に判定する必要が無い）。
export function shouldInjectOkrTourPreviewSample(
  isOkrTourRunning: boolean,
  activeKrCountInPeriod: number,
): boolean {
  return isOkrTourRunning && activeKrCountInPeriod === 0;
}
