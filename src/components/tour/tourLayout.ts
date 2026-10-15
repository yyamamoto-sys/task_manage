// src/components/tour/tourLayout.ts
//
// ツアーの重なり順と、対象位置の測り直し判定（純関数）。
// 【v3.161】ツアーの吹き出しは #root（isolation:isolate＝独立した重なりの文脈）の内側に描かれていたため、
// body 直下へ Portal される要素（ベルのパネル z=9999 等）には、z-index の数値に関係なく常に負けていた。
// 「押してください」の結果開いたパネルが吹き出しを覆い、「次へ／終了」が押せなくなった。
// → TourOverlay を body 直下へ Portal し、下の値で一貫させる。

export const TOUR_Z = {
  scrim: 9990,
  spotlight: 9991,
  /** 吹き出しと、枠線を持ち上げたとき（raiseSpotlight）の枠線。body 直下のポップオーバー（9999）より上 */
  bubble: 10000,
} as const;

export interface RectLike { top: number; left: number; width: number; height: number }

/** 位置・大きさが（0.5px 未満の誤差を除いて）同じか。測り直しで無駄な再描画をしないため */
export function sameRect(a: RectLike | null, b: RectLike | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const e = 0.5;
  return Math.abs(a.top - b.top) < e && Math.abs(a.left - b.left) < e
    && Math.abs(a.width - b.width) < e && Math.abs(a.height - b.height) < e;
}
