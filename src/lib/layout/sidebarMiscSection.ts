// src/lib/layout/sidebarMiscSection.ts
//
// 【設計意図】
// サイドバー下部の「ガイド／設定／招待コードを入力」を見出し＋折りたたみで包むかどうかの
// 判定を担う純粋関数。JSX側に条件式を散らさず、ここに切り出す（sidebarWidth.ts・
// filterByPeriod.ts と同じ「純粋関数に切り出す」流儀。CLAUDE.md参照）。
//
// 【判断基準】表示対象の項目（ボタン）が2つ以上のときだけ見出し＋折りたたみにする。
// 1つ以下（ゲストは「ガイド」のみ表示）のときに見出しで包むと、見出し行が増える分だけ
// かえって縦の占有面積が増えて逆効果になるため。

/** 表示対象の項目数が2つ以上なら、見出し＋折りたたみで包むべきと判定する。 */
export function shouldGroupSidebarMiscButtons(visibleItemCount: number): boolean {
  return visibleItemCount >= 2;
}
