// src/lib/layout/fabLayout.ts
//
// 【設計意図】
// FAB（＋ボタン）本体の座標・サイズを、Toast等「FABと重ならないように避けたい」他要素からも
// 参照できる形で1箇所に集約する。値をコピーして手で計算すると片方だけ直し忘れてズレる
// （実際に Toast.tsx と PC版FABが bottom:24px/right:24px で完全に同一座標になっていた事故が
// v3.86で発覚した）。FAB側・Toast側の両方がこのファイルの定数を参照することで、
// 今後FABの位置を動かした場合にToast側も追従する。

/** FAB本体の一辺（正円）[px] */
export const FAB_SIZE_PX = 48;

export const FAB_BOTTOM_PC_PX = 24;
export const FAB_BOTTOM_MOBILE_PX = 68;

export const FAB_RIGHT_PC_PX = 24;
export const FAB_RIGHT_MOBILE_PX = 16;

/** FABの上に確保する最低限の余白（この値の上に別要素を置けば重ならない） */
const FAB_CLEARANCE_PX = 12;

/** Toast等、FABの真上を避けたい要素が使うbottom値（PC）。24 + 48 + 12 = 84 */
export const ABOVE_FAB_BOTTOM_PC_PX = FAB_BOTTOM_PC_PX + FAB_SIZE_PX + FAB_CLEARANCE_PX;
/** 同・モバイル。68 + 48 + 12 = 128 */
export const ABOVE_FAB_BOTTOM_MOBILE_PX = FAB_BOTTOM_MOBILE_PX + FAB_SIZE_PX + FAB_CLEARANCE_PX;

// ===== 待機中の収納・半透明（v3.86） =====
// クレーム「＋ボタンがメニュー等のテキストと被り、下のレイヤーが見えない」への対応。
// 待機中は右へ半分ずらして半透明にし、下のテキストが読めるようにする。

/** 待機中（収納時）の不透明度 */
export const FAB_IDLE_OPACITY = 0.4;
/** 待機中に右へずらす量（自身の幅に対する割合）。50% = 48pxの半分=24pxだけ画面端へ収納 */
export const FAB_IDLE_TRANSLATE_X = "50%";
/** カーソル（pointermove）がFAB本来の中心からこの半径[px]以内に入ったら完全表示へ戻す。
 *  収納中は見た目上の当たり判定が半分になり掴みにくくなるため、実際のボタンサイズ(48px)より
 *  一回り大きい検知半径を確保する。 */
export const FAB_NEAR_RADIUS_PX = 64;
