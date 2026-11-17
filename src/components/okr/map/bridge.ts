// MainLayout のサイドバー（いつも読み込まれる）と、遅延読み込みの地図の画面をつなぐ小さな置き場。
// 地図の画面が「いまのページ・KRの行・選択中のKR」と操作の入口を載せ、サイドバーはそれを描くだけにする。
// 地図の画面が閉じたら空に戻す（OKRモードを出たあとにサイドバーへ古い行が残らないように）。
import { create } from "zustand";
import type { SidebarKr } from "./nav";
import type { ViewMode } from "./state";

export interface OkrMapSidebarView {
  mode: ViewMode;
  krs: SidebarKr[];
  selKrId: string | null;
}

export interface OkrMapSidebarActions {
  setMode: (m: ViewMode) => void;
  openKr: (krId: string) => void;
  openDocs: () => void;
}

interface BridgeState {
  view: OkrMapSidebarView | null;
  actions: OkrMapSidebarActions | null;
  /** MainLayout のサイドバーの実際の幅（px。折りたたみ中は 48）。見本（テスト）では null */
  sidebarPx: number | null;
  /** 右の AI 相談パネルの幅（px。閉じているとき・モバイルは 0） */
  consultPx: number;
  publish: (view: OkrMapSidebarView, actions: OkrMapSidebarActions) => void;
  clear: () => void;
  setSidebarPx: (px: number) => void;
  setConsultPx: (px: number) => void;
}

export const useOkrMapBridge = create<BridgeState>((set) => ({
  view: null,
  actions: null,
  sidebarPx: null,
  consultPx: 0,
  publish: (view, actions) => set({ view, actions }),
  clear: () => set({ view: null, actions: null }),
  setSidebarPx: (px) => set((s) => (s.sidebarPx === px ? s : { sidebarPx: px })),
  setConsultPx: (px) => set((s) => (s.consultPx === px ? s : { consultPx: px })),
}));
