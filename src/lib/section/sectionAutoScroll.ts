// src/lib/section/sectionAutoScroll.ts
//
// グループ見出しのドラッグ中、スクロール領域の上端・下端にカーソルが近いときの自動スクロール量（純関数）。
// 端から edge px 以内で動き出し、端に近いほど速く、最大 max px/フレーム。領域の外へ出ても max で頭打ち。

export const AUTO_SCROLL_EDGE = 48;
export const AUTO_SCROLL_MAX = 16;

/** @returns 負＝上へ・正＝下へ・0＝動かさない（px/フレーム） */
export function sectionAutoScrollDelta(
  pointerY: number, top: number, bottom: number,
  edge: number = AUTO_SCROLL_EDGE, max: number = AUTO_SCROLL_MAX,
): number {
  if (!(bottom > top) || edge <= 0) return 0;
  const fromTop = pointerY - top;
  const fromBottom = bottom - pointerY;
  // 領域が小さく両端の帯が重なるときは、近い方の端を採る
  if (fromTop < edge && fromTop <= fromBottom) {
    return -Math.max(1, Math.round(Math.min(1, (edge - fromTop) / edge) * max));
  }
  if (fromBottom < edge) {
    return Math.max(1, Math.round(Math.min(1, (edge - fromBottom) / edge) * max));
  }
  return 0;
}
