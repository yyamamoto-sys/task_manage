// src/stores/uiLayoutStore.ts
//
// 【設計意図・v3.94】
// 画面レイアウト専用のUI状態。appStore（Supabaseと同期する業務データ）とは役割が違うため
// 分離した（appStore.tsのコメント・CLAUDE.md参照）。
//
// 【なぜ要るか】TaskSidePanel（右サイドパネル。ドラッグでユーザーが幅を変えられる）は
// ListView/GanttView/KanbanViewがそれぞれ自分でレンダーしており、MainLayout（FAB・
// ショートカットボタン等を描画する場所）はその存在も幅も直接知らない。v3.86〜v3.92は
// FABの位置を「TaskSidePanelが開いているかどうかに関わらず一定」にすることで衝突を
// 避けていたが、これは「拡大率・フォント設定次第でフッターの実際の高さがズレる」問題に
// 弱かった（CLAUDE.md Section 43・49参照）。v3.94でFABをパネルの横へ完全に退避させる
// ことにしたため、MainLayoutがパネルの開閉・幅を知る必要が生まれ、このストアを新設した。
//
// AI相談パネル（isConsultOpen/consultPanelWidth）はMainLayout自身がuseStateで持って
// いる（MainLayout自身がレンダーする要素のため）。TaskSidePanelだけこの形が取れない
// ため非対称になっているが、意図的な設計判断であり統一のために無理にAI相談パネル側も
// ストア化はしていない。
//
// 【v3.95追加：mobileBottomNavHeightPx / fabMenuHeightPx】
// 右下スタックの「本当に実測が必要な2つの縦の依存」（CLAUDE.md Section 49参照）を
// 通すための値。どちらも「測る側（MainLayout.tsx／QuickAddFab.tsx）」と「使う側
// （FAB自身の位置・ショートカットボタンの退避先を計算する側）」が別のタイミング・
// 場所にまたがるため、モジュール変数ではなくReactの再レンダリングを伴うzustandストアに
// 置く必要がある（unsavedEditorRegistry.ts等の非reactiveなpull型モジュールとは
// 性質が違う）。値は「未測定時のフォールバック」としてbottomStack.tsの見積もり定数を
// 初期値にし、ResizeObserverの実測が届き次第上書きする。

import { create } from "zustand";
import { BOTTOM_NAV_MIN_HEIGHT_MOBILE_PX, FAB_MENU_STACK_HEIGHT_ESTIMATE_PC_PX } from "../lib/layout/bottomStack";

interface UiLayoutState {
  isTaskSidePanelOpen: boolean;
  /** TaskSidePanelの現在の描画幅（px）。ドラッグでユーザーが変更した値をそのまま反映する。 */
  taskSidePanelWidth: number;
  setTaskSidePanelOpen: (open: boolean) => void;
  setTaskSidePanelWidth: (width: number) => void;
  /** モバイルのボトムナビの実測高さ(px)。MainLayout.tsxがResizeObserverで反映する（v3.95）。
   *  初期値はbottomStack.tsのBOTTOM_NAV_MIN_HEIGHT_MOBILE_PX（未測定時のフォールバック）。 */
  mobileBottomNavHeightPx: number;
  setMobileBottomNavHeightPx: (h: number) => void;
  /** FAB展開メニュー（3項目の列）の実測高さ(px)。QuickAddFab.tsxがResizeObserverで
   *  反映する（v3.95）。初期値はPC見積もり（メニューは開いたときしか存在しないため、
   *  初回オープン時にResizeObserverの最初のコールバックが届くまでの短い間だけ使う
   *  フォールバック。ズレても数十ms・数px以内の誤差でしかないため実害は無い）。 */
  fabMenuHeightPx: number;
  setFabMenuHeightPx: (h: number) => void;
}

export const useUiLayoutStore = create<UiLayoutState>((set) => ({
  isTaskSidePanelOpen: false,
  taskSidePanelWidth: 320, // TaskSidePanel.tsxの初期値(320px)と合わせた既定値。実際の値はマウント直後に上書きされる
  setTaskSidePanelOpen: (open) => set({ isTaskSidePanelOpen: open }),
  setTaskSidePanelWidth: (width) => set({ taskSidePanelWidth: width }),
  mobileBottomNavHeightPx: BOTTOM_NAV_MIN_HEIGHT_MOBILE_PX,
  setMobileBottomNavHeightPx: (h) => set({ mobileBottomNavHeightPx: h }),
  fabMenuHeightPx: FAB_MENU_STACK_HEIGHT_ESTIMATE_PC_PX,
  setFabMenuHeightPx: (h) => set({ fabMenuHeightPx: h }),
}));
