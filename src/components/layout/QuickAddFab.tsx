// src/components/layout/QuickAddFab.tsx
//
// 【設計意図】
// タスク追加の「＋」FAB。PC版とモバイル版で完全に別のJSXとして重複実装されていた
// （MainLayout.tsx内に2系統）ものを1つに切り出した。位置・展開メニューの起点はPC/モバイルで
// 異なるためpropsで受け、見た目・挙動は切り出し前の実装値をそのまま引き継いでいる。
//
// 【v3.91：v3.86の「待機中は右端へ半分収納＋半透明にする」を撤去】
// 利用者（山本さん）から「＋ボタンの位置と透明度は元に戻してほしい」という差し戻し指示を受けた。
// v3.86時点の対応（収納・半透明・pointermoveによるホバー検知・タッチ端末分岐・
// prefers-reduced-motion分岐）は全てこのファイル内に閉じていたため、それらを丸ごと削除し、
// 待機中も常に不透明度1・オフセット0で表示する。コンポーネント自体の共通化（PC/モバイルの
// 重複解消）は維持する（差し戻し対象は「位置と透明度」であって共通化ではない）。
//
// 座標（bottom/right）は src/lib/layout/bottomStack.ts（右下に積み上がる要素のスタックを
// 一元管理するモジュール）から取る。FABの位置を変えるときはこのファイルではなくbottomStack.ts
// を直すこと。
//
// 【v3.95：モバイルのFAB本体bottomと、展開メニューの実測高さ】
// - FAB本体（モバイル）のbottomは、ボトムナビの実測高さ（useUiLayoutStoreの
//   mobileBottomNavHeightPx。MainLayout.tsxがResizeObserverで反映）から算出する
//   （残る2つの実依存の1つ目。CLAUDE.md Section 49参照）。
// - 展開メニュー（3項目の列）は、このコンポーネント自身がResizeObserverで実測し、
//   useUiLayoutStoreのfabMenuHeightPxへ反映する（残る2つの実依存の2つ目。MainLayout.tsxの
//   ショートカットボタンの退避先計算がこの値を読む）。
// - メニュー項目・FAB本体（モバイルのみ相当するボトムナビ）は文字を含むため固定heightを
//   やめ minHeight にした（拡大率・最小フォントサイズ設定で中身が切れないように）。
//   FAB本体自体（＋アイコンのみの正円）は文字を含まないため引き続き固定サイズ。

import { useEffect, useRef } from "react";
import { useT } from "../../hooks/useT";
import { useUiLayoutStore } from "../../stores/uiLayoutStore";
import {
  FAB_SIZE_PX,
  FAB_BOTTOM_PC_PX,
  FAB_RIGHT_PC_PX,
  FAB_RIGHT_MOBILE_PX,
  FAB_MENU_BOTTOM_PC_PX,
  FAB_MENU_ITEM_MIN_HEIGHT_PC_PX,
  FAB_MENU_ITEM_MIN_HEIGHT_MOBILE_PX,
  computeFabBottomMobile,
  computeFabMenuBottom,
} from "../../lib/layout/bottomStack";

interface QuickAddFabProps {
  isMobile: boolean;
  isFabMenuOpen: boolean;
  onToggleMenu: () => void;
  onSelectConsult: () => void;
  onSelectMilestone: () => void;
  onSelectTask: () => void;
  /** PCのみ：AI相談パネルが開いている間、パネル幅ぶんFAB・メニューを左へ避ける */
  isConsultOpen: boolean;
  consultPanelWidth: number;
  /** パネルのドラッグリサイズ中はright方向のtransitionを切る（既存の挙動を踏襲） */
  isConsultResizing: boolean;
  /**
   * 【v3.94】PCのみ：AI相談パネルとは別に、さらに追加で避けたい幅（px）。TaskSidePanelが
   * 開いている間、その実際の幅（uiLayoutStore経由）をMainLayoutが渡す。AI相談パネルと
   * TaskSidePanelは画面右に横並びで同時に開きうるため、consultPanelWidthとは単純加算する
   * （両方開いている場合は両方の幅を避ける）。CLAUDE.md Section 49参照。
   */
  extraAvoidWidthPx?: number;
  /** ツアー等が将来targetとして参照する可能性がある予約属性（現状PCのみに付与） */
  dataTourId?: string;
}

export function QuickAddFab({
  isMobile,
  isFabMenuOpen,
  onToggleMenu,
  onSelectConsult,
  onSelectMilestone,
  onSelectTask,
  isConsultOpen,
  consultPanelWidth,
  isConsultResizing,
  extraAvoidWidthPx = 0,
  dataTourId,
}: QuickAddFabProps) {
  const t = useT();
  const mobileBottomNavHeightPx = useUiLayoutStore(s => s.mobileBottomNavHeightPx);
  const setFabMenuHeightPx = useUiLayoutStore(s => s.setFabMenuHeightPx);

  const bottomPx = isMobile ? computeFabBottomMobile(mobileBottomNavHeightPx) : FAB_BOTTOM_PC_PX;
  const rightPx = isMobile
    ? FAB_RIGHT_MOBILE_PX
    : FAB_RIGHT_PC_PX + (isConsultOpen ? consultPanelWidth : 0) + extraAvoidWidthPx;
  const menuBottomPx = isMobile ? computeFabMenuBottom(bottomPx) : FAB_MENU_BOTTOM_PC_PX;

  // 【v3.95】展開メニューの実測高さをuiLayoutStoreへ反映する（残る2つの実依存の2つ目。
  // MainLayout.tsxのショートカットボタンの退避先計算がこの値を読む）。メニューは開いている
  // 間しかDOMに存在しないため、isFabMenuOpenが変わるたびにobserve/disconnectし直す。
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) setFabMenuHeightPx(entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [isFabMenuOpen, setFabMenuHeightPx]);

  const rightTransitionPart = isMobile
    ? ""
    : (isConsultResizing ? "" : "right 0.3s ease, ");
  const transition = `${rightTransitionPart}transform 0.15s ease, background 0.2s`;

  return (
    <>
      {isFabMenuOpen && (
        // 背景クリックで閉じる（マウス操作の補助）。FABボタン自体がキーボードで開閉トグル
        // 可能なため、背景要素をフォーカス可能にする必要はない
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
        <div
          style={{ position: "fixed", inset: 0, zIndex: 58 }}
          onClick={() => onToggleMenu()}
        />
      )}
      {isFabMenuOpen && (
        <div ref={menuRef} data-bottom-stack="fab-menu" style={{
          position: "fixed",
          bottom: `${menuBottomPx}px`,
          right: `${rightPx}px`,
          transition: isMobile ? undefined : (isConsultResizing ? "none" : "right 0.3s ease"),
          zIndex: 59,
          display: "flex", flexDirection: "column", gap: isMobile ? "8px" : "6px", alignItems: "flex-end",
        }}>
          <button
            className="fab-item-in"
            onClick={onSelectConsult}
            style={{
              display: "flex", alignItems: "center", gap: "8px",
              padding: isMobile ? "10px 16px" : "9px 16px",
              minHeight: isMobile ? `${FAB_MENU_ITEM_MIN_HEIGHT_MOBILE_PX}px` : `${FAB_MENU_ITEM_MIN_HEIGHT_PC_PX}px`,
              background: "linear-gradient(135deg,#8b5cf6,#a78bfa)",
              border: "none", borderRadius: "var(--radius-full)",
              color: "#fff", fontSize: "13px", fontWeight: "600",
              boxShadow: "var(--shadow-lg)", cursor: "pointer",
              whiteSpace: "nowrap", animationDelay: "0.12s",
            }}
          >
            {isMobile ? `💬 ${t("layout.fab.consult")}` : (<><span>💬</span> {t("layout.fab.consult")}</>)}
          </button>
          <button
            className="fab-item-in"
            onClick={onSelectMilestone}
            style={{
              display: "flex", alignItems: "center", gap: "8px",
              padding: isMobile ? "10px 16px" : "9px 16px",
              minHeight: isMobile ? `${FAB_MENU_ITEM_MIN_HEIGHT_MOBILE_PX}px` : `${FAB_MENU_ITEM_MIN_HEIGHT_PC_PX}px`,
              background: "linear-gradient(135deg,#f59e0b,#d97706)",
              border: "none", borderRadius: "var(--radius-full)",
              color: "#fff", fontSize: "13px", fontWeight: "600",
              boxShadow: "var(--shadow-lg)", cursor: "pointer",
              whiteSpace: "nowrap", animationDelay: "0.06s",
            }}
          >
            {isMobile ? `◆ ${t("layout.fab.milestone")}` : (<><span>◆</span> {t("layout.fab.milestone")}</>)}
          </button>
          <button
            className="fab-item-in"
            onClick={onSelectTask}
            style={{
              display: "flex", alignItems: "center", gap: "6px",
              padding: isMobile ? "10px 16px" : "9px 16px",
              minHeight: isMobile ? `${FAB_MENU_ITEM_MIN_HEIGHT_MOBILE_PX}px` : `${FAB_MENU_ITEM_MIN_HEIGHT_PC_PX}px`,
              background: "var(--color-brand)",
              border: "none", borderRadius: "var(--radius-full)",
              color: "#fff", fontSize: "13px", fontWeight: "600",
              boxShadow: "var(--shadow-lg)", cursor: "pointer",
              whiteSpace: "nowrap", animationDelay: "0s",
            }}
          >
            {isMobile ? `＋ ${t("layout.fab.task")}` : (<><span style={{ fontSize: "16px", lineHeight: 1 }}>＋</span> {t("layout.fab.task")}</>)}
          </button>
        </div>
      )}
      <button
        {...(dataTourId ? { "data-tour-id": dataTourId } : {})}
        data-bottom-stack="fab"
        onClick={onToggleMenu}
        style={{
          position: "fixed",
          bottom: `${bottomPx}px`,
          right: `${rightPx}px`,
          transition,
          zIndex: 60,
          width: `${FAB_SIZE_PX}px`, height: `${FAB_SIZE_PX}px`, borderRadius: "50%",
          background: isFabMenuOpen ? "var(--color-text-secondary)" : "var(--color-brand)",
          color: "#fff",
          border: "none", fontSize: "22px", lineHeight: 1,
          boxShadow: "var(--shadow-lg)", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          transform: isFabMenuOpen ? "rotate(45deg)" : "rotate(0deg)",
        }}
        title={t("layout.fab.menuTitle")}
      >＋</button>
    </>
  );
}
