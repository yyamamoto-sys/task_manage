// src/components/layout/QuickAddFab.tsx
//
// 【設計意図】
// タスク追加の「＋」FAB。PC版とモバイル版で完全に別のJSXとして重複実装されていた
// （MainLayout.tsx内に2系統）ものを1つに切り出した。位置・展開メニューの起点はPC/モバイルで
// 異なるためpropsで受け、見た目・挙動は切り出し前の実装値をそのまま引き継いでいる。
//
// 【v3.86：待機中は右端へ半分収納＋半透明にする】
// クレーム「＋ボタンが、メニュー表示などで何らかのテキストと被り、プラスマークより下の
// レイヤーの表示が見えない」への対応。待機中はFABを右へ半分ずらし不透明度を下げることで
// 下のテキストが読める状態にし、カーソルが近づく／展開メニューを開く／タッチ端末では
// 完全表示に戻す。
//
// 【ホバー検知方式の選定理由（pointermove採用）】
// 収納中はFAB自体の見た目上の当たり判定が半分になるため、「FAB自身のhoverだけ」で
// 判定すると逆に掴みにくくなる。対策として「FABの周囲に透明な一回り大きいDOM要素を
// 重ねてhoverを拾う」方式ではなく、window全体のpointermoveを購読しFABの
// 「本来（収納前）の中心座標」からの距離で判定する方式を採用した。理由：
//   1) FABの本来位置はPC/モバイルでconsultPanelWidth等により動くため、透明なホバー要素を
//      別途置いてもFAB本体と全く同じ位置計算を2箇所に持つ必要があり、ズレ事故
//      （片方だけ直し忘れる）を誘発する。pointermove方式なら「本来の中心座標」を
//      1箇所で計算してそのまま距離判定に使い回せる。
//   2) 透明要素はそれ自体が固定要素として画面に増える＝Toast/ErrorBar等との重なり調査
//      対象がさらに1つ増える。pointermove方式はDOM要素を増やさない。
//   3) 検知円の中心を「本来の位置」に固定するため、収納後の縮んだ当たり判定へ正確に
//      カーソルを置く必要がなく、近づいた時点で展開できる＝むしろ掴みやすい。
//
// キーボード操作（Tabフォーカス）でも収納・半透明のままだと視認できないため、
// フォーカス中も完全表示にする（isFocusedで判定）。

import { useEffect, useState } from "react";
import { useT } from "../../hooks/useT";
import {
  FAB_SIZE_PX,
  FAB_BOTTOM_PC_PX,
  FAB_BOTTOM_MOBILE_PX,
  FAB_RIGHT_PC_PX,
  FAB_RIGHT_MOBILE_PX,
  FAB_IDLE_OPACITY,
  FAB_IDLE_TRANSLATE_X,
  FAB_NEAR_RADIUS_PX,
} from "../../lib/layout/fabLayout";

/** (hover: hover) の判定。useIsMobileと同じmatchMedia+changeイベント購読の作法。
 *  タッチのみの端末（hoverできない）では常に完全表示にするための判定に使う。 */
function useHoverCapable(): boolean {
  const [hoverCapable, setHoverCapable] = useState(
    () => window.matchMedia("(hover: hover)").matches
  );
  useEffect(() => {
    const mql = window.matchMedia("(hover: hover)");
    const handler = (e: MediaQueryListEvent) => setHoverCapable(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);
  return hoverCapable;
}

/** prefers-reduced-motion の判定。globals.css側の「動きを減らす設定では出現アニメを
 *  無効化する」既存方針に合わせ、新規追加した収納アニメ（transform/opacity）だけを
 *  無効化する（背景色のホバー変化はglobals.css側と同じく止めない）。 */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  useEffect(() => {
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);
  return reduced;
}

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
  dataTourId,
}: QuickAddFabProps) {
  const t = useT();
  const hoverCapable = useHoverCapable();
  const reducedMotion = usePrefersReducedMotion();
  const [isNear, setIsNear] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  const bottomPx = isMobile ? FAB_BOTTOM_MOBILE_PX : FAB_BOTTOM_PC_PX;
  const rightPx = isMobile
    ? FAB_RIGHT_MOBILE_PX
    : (isConsultOpen ? consultPanelWidth + FAB_RIGHT_PC_PX : FAB_RIGHT_PC_PX);

  useEffect(() => {
    if (!hoverCapable) return;
    const handlePointerMove = (e: PointerEvent) => {
      const centerX = window.innerWidth - rightPx - FAB_SIZE_PX / 2;
      const centerY = window.innerHeight - bottomPx - FAB_SIZE_PX / 2;
      const near = Math.hypot(e.clientX - centerX, e.clientY - centerY) <= FAB_NEAR_RADIUS_PX;
      setIsNear(prev => (prev === near ? prev : near));
    };
    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    return () => window.removeEventListener("pointermove", handlePointerMove);
  }, [hoverCapable, bottomPx, rightPx]);

  // タッチ端末（hoverできない）・展開メニュー表示中・接近中・フォーカス中は常に完全表示
  const collapsed = hoverCapable && !isFabMenuOpen && !isNear && !isFocused;

  const motionTransitionPart = reducedMotion ? "" : "transform 0.25s ease, opacity 0.25s ease, ";
  const rightTransitionPart = isMobile
    ? ""
    : (isConsultResizing ? "" : "right 0.3s ease, ");
  const transition = `${motionTransitionPart}${rightTransitionPart}background 0.2s`;

  const transform = [
    collapsed ? `translateX(${FAB_IDLE_TRANSLATE_X})` : "translateX(0)",
    isFabMenuOpen ? "rotate(45deg)" : "rotate(0deg)",
  ].join(" ");

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
        <div style={{
          position: "fixed",
          bottom: isMobile ? "122px" : "74px",
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
              ...(isMobile ? {} : { height: "38px" }),
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
              ...(isMobile ? {} : { height: "38px" }),
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
              ...(isMobile ? {} : { height: "38px" }),
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
        onClick={onToggleMenu}
        // pointermoveでの距離判定が主だが、収納後も残る当たり判定（画面端に残る左半分）に
        // 直接カーソルが乗った場合の保険としてFAB自身のhoverも併用する（矛盾しない・
        // どちらか一方がtrueにすればisNearはtrueになる）
        onMouseEnter={() => setIsNear(true)}
        onMouseLeave={() => setIsNear(false)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        style={{
          position: "fixed",
          bottom: `${bottomPx}px`,
          right: `${rightPx}px`,
          transition,
          zIndex: 60,
          width: "48px", height: "48px", borderRadius: "50%",
          background: isFabMenuOpen ? "var(--color-text-secondary)" : "var(--color-brand)",
          color: "#fff",
          border: "none", fontSize: "22px", lineHeight: 1,
          boxShadow: "var(--shadow-lg)", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          transform,
          opacity: collapsed ? FAB_IDLE_OPACITY : 1,
        }}
        title={t("layout.fab.menuTitle")}
      >＋</button>
    </>
  );
}
