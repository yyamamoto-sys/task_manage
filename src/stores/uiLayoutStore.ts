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

import { create } from "zustand";

interface UiLayoutState {
  isTaskSidePanelOpen: boolean;
  /** TaskSidePanelの現在の描画幅（px）。ドラッグでユーザーが変更した値をそのまま反映する。 */
  taskSidePanelWidth: number;
  setTaskSidePanelOpen: (open: boolean) => void;
  setTaskSidePanelWidth: (width: number) => void;
}

export const useUiLayoutStore = create<UiLayoutState>((set) => ({
  isTaskSidePanelOpen: false,
  taskSidePanelWidth: 320, // TaskSidePanel.tsxの初期値(320px)と合わせた既定値。実際の値はマウント直後に上書きされる
  setTaskSidePanelOpen: (open) => set({ isTaskSidePanelOpen: open }),
  setTaskSidePanelWidth: (width) => set({ taskSidePanelWidth: width }),
}));
