// src/hooks/useFloatingPanel.ts
//
// 【設計意図・2026-08-26】
// 「トリガーに追従する小さいポップオーバー」（CustomSelect / InlineEditAssignee /
// ProjectRowMenu / MentionTextarea）の位置決め・スクロール追従・スクロール連鎖の遮断を
// 1箇所に集約する。v3.85（commit aedb241）で座標計算だけを
// `src/lib/layout/floatingPanelPosition.ts` に切り出したが、**その周辺（スクロール時の
// 振る舞い・maxHeight の決め方・Portal要素の pointer-events）は4箇所にコピペのまま残り**、
// 結果として InlineEditAssignee だけが取り残されて業務停止級の不具合になった。
// 同じことを繰り返さないよう、コピペしうる部分をまとめてここへ持ち上げる。
//
// 【このフックが引き受ける3点】
//  ① pointerEvents:"auto"
//     `globals.css` の `body { pointer-events: none }`（外周の余白帯でクリックを通すための
//     指定）は**継承プロパティ**であり、`createPortal(document.body)` した要素は明示的に
//     打ち消さないとクリック・ホバー・ホイールを一切受け取れない。返す panelStyle に必ず含める。
//  ② スクロールしても閉じない（追従する）
//     旧実装は「パネル外で起きたスクロールなら閉じる」だったため、祖先の表本体が少し動いた
//     だけで閉じていた。ここでは位置を再計算して追従し、トリガーが可視範囲から出たときだけ
//     閉じる（判定は computeFloatingPanelCloseOnScroll＝純粋関数・テスト済み）。
//  ③ 固定値の maxHeight をやめる
//     トリガーの上下で実際に使える余白から算出し（computeFloatingPanelMaxHeight）、
//     描画後は ResizeObserver + getBoundingClientRect() の実測値でクランプし直す。
//
// スクロール連鎖（パネル内スクロールが端に達したときに祖先へ伝播すること）の遮断は
// scrollAreaStyle の overscrollBehavior が担う。**実際にスクロールする要素**に当てること
// （CustomSelect のようにルートが overflow:hidden で内側に scroller がある場合は内側）。

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";
import {
  computeFloatingPanelCloseOnScroll,
  computeFloatingPanelMaxHeight,
  computeFloatingPanelPosition,
  FLOATING_PANEL_OVERSCROLL_BEHAVIOR,
  type FloatingPanelTriggerRect,
} from "../lib/layout/floatingPanelPosition";

const DEFAULT_PREFERRED_MAX_HEIGHT = 340;
const DEFAULT_MIN_MAX_HEIGHT = 140;
const DEFAULT_FALLBACK_WIDTH = 220;
const PANEL_Z_INDEX = 9999;

export interface UseFloatingPanelOptions {
  open: boolean;
  /** トリガーが可視範囲から出たなど、フックが「閉じるべき」と判断したときに呼ばれる */
  onRequestClose: () => void;
  triggerRef: RefObject<HTMLElement | null>;
  panelRef: RefObject<HTMLElement | null>;
  /** 水平方向の基準。既定 "left" */
  align?: "left" | "right";
  /**
   * パネル幅の決め方。
   * - 数値      : 固定幅（style に width を設定する）
   * - "trigger" : トリガーと同じ幅（style に width を設定する。minWidth で下限を指定可）
   * - "auto"    : 中身なり（style に width は設定しない。クランプには実測値を使う）
   */
  width?: number | "trigger" | "auto";
  /** width:"trigger" のときの下限幅 */
  minWidth?: number;
  /** width:"auto" で実測前の1フレームだけ使う見積もり幅 */
  fallbackWidth?: number;
  /** 余白が許すなら出したい高さ。既定340 */
  preferredMaxHeight?: number;
  /** 余白が足りなくてもこれ以上は縮めない下限。既定140 */
  minMaxHeight?: number;
  /** 画面端からの最小余白。既定は共通関数の8 */
  margin?: number;
}

export interface UseFloatingPanelResult {
  /** Portal するパネルのルート要素に spread する */
  panelStyle: CSSProperties;
  /** 実際にスクロールする要素に spread する（ルート自身がスクロールするなら両方 spread する） */
  scrollAreaStyle: CSSProperties;
  /** 任意のタイミングで位置を計算し直す（通常は不要。開閉・スクロール・リサイズは自動） */
  reposition: () => void;
}

/** overflow が auto/scroll な最も近い祖先を返す（トリガーがどの容器の中で流れるかの判定に使う） */
function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node && node !== document.body && node !== document.documentElement) {
    const style = window.getComputedStyle(node);
    const overflow = `${style.overflowY} ${style.overflowX}`;
    if (/(auto|scroll|overlay)/.test(overflow)) return node;
    node = node.parentElement;
  }
  return null;
}

function toTriggerRect(rect: DOMRect): FloatingPanelTriggerRect {
  return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
}

export function useFloatingPanel({
  open, onRequestClose, triggerRef, panelRef,
  align = "left",
  width = "auto",
  minWidth,
  fallbackWidth = DEFAULT_FALLBACK_WIDTH,
  preferredMaxHeight = DEFAULT_PREFERRED_MAX_HEIGHT,
  minMaxHeight = DEFAULT_MIN_MAX_HEIGHT,
  margin,
}: UseFloatingPanelOptions): UseFloatingPanelResult {
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});
  // setState を挟まずに前回値と比較するため（同じ値での再レンダーで無限ループになるのを防ぐ）
  const lastRef = useRef<{ top: number; left: number; maxHeight: number; width?: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const scrollParentRef = useRef<HTMLElement | null>(null);

  // onRequestClose は呼び出し側でインライン関数として渡されるため、
  // 依存に入れるとリスナの張り直しが毎レンダー走る。ref で保持する。
  const onRequestCloseRef = useRef(onRequestClose);
  useEffect(() => { onRequestCloseRef.current = onRequestClose; });

  const reposition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const triggerRect = toTriggerRect(trigger.getBoundingClientRect());

    const { maxHeight } = computeFloatingPanelMaxHeight({
      triggerRect,
      viewportHeight: window.innerHeight,
      preferredHeight: preferredMaxHeight,
      minHeight: minMaxHeight,
      ...(margin === undefined ? {} : { margin }),
    });

    // 実測値でクランプし直す（固定値の見積もりは拡大率・フォント設定でズレる）。
    // ただし1回目は position:fixed がまだ当たっておらずパネルが静的配置のままなので、
    // 実測すると「bodyいっぱいの幅」を拾ってしまう。1回目は見積もりを使い、2回目以降
    // （ResizeObserver・スクロール追従）で実測に切り替える。
    const panelRect = lastRef.current ? panelRef.current?.getBoundingClientRect() : undefined;

    let resolvedWidth: number | undefined;
    if (typeof width === "number") {
      resolvedWidth = width;
    } else if (width === "trigger") {
      resolvedWidth = Math.max(triggerRect.right - triggerRect.left, minWidth ?? 0);
    }
    const clampWidth = resolvedWidth ?? (panelRect && panelRect.width > 0 ? panelRect.width : fallbackWidth);
    const clampHeight = panelRect && panelRect.height > 0 ? Math.min(panelRect.height, maxHeight) : maxHeight;

    const { top, left } = computeFloatingPanelPosition({
      triggerRect,
      panelWidth: clampWidth,
      estimatedPanelHeight: clampHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      align,
      ...(margin === undefined ? {} : { margin }),
    });

    const next = { top, left, maxHeight, width: resolvedWidth };
    const prev = lastRef.current;
    if (prev && prev.top === next.top && prev.left === next.left
      && prev.maxHeight === next.maxHeight && prev.width === next.width) return;
    lastRef.current = next;

    setPanelStyle({
      position: "fixed",
      top,
      left,
      ...(resolvedWidth === undefined ? {} : { width: resolvedWidth }),
      maxHeight,
      zIndex: PANEL_Z_INDEX,
      // body { pointer-events: none } を打ち消す。これが無いとパネルはヒットテストの
      // 対象外になり、ホイールが下の要素へ素通りする（2026-08-26の担当者ドロップダウン不具合）
      pointerEvents: "auto",
      overscrollBehavior: FLOATING_PANEL_OVERSCROLL_BEHAVIOR,
    });
  }, [triggerRef, panelRef, align, width, minWidth, fallbackWidth, preferredMaxHeight, minMaxHeight, margin]);

  const scheduleReposition = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      reposition();
    });
  }, [reposition]);

  // 開いた直後に描画前（useLayoutEffect）で位置を確定させる。閉じたら状態を捨てる。
  useLayoutEffect(() => {
    if (!open) {
      // 一度も開いていないなら何もしない（リストの全行にこのフックが載るため、
      // マウント時に無駄な再レンダーを起こさない）
      if (lastRef.current === null) return;
      lastRef.current = null;
      scrollParentRef.current = null;
      setPanelStyle({});
      return;
    }
    scrollParentRef.current = findScrollParent(triggerRef.current);
    reposition();
  }, [open, reposition, triggerRef]);

  // パネル／トリガーの実サイズが決まった・変わったら、実測値でクランプし直す。
  // トリガー側も見るのは、MentionTextarea の textarea が field-sizing:content で入力中に
  // 伸びる・CustomSelect のトリガー幅がサイドバーのドラッグで変わる、といったケースで
  // パネルが取り残されるため（パネル自身のサイズは変わらないので panel だけでは検知できない）。
  useEffect(() => {
    if (!open) return;
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => scheduleReposition());
    if (panelRef.current) ro.observe(panelRef.current);
    if (triggerRef.current) ro.observe(triggerRef.current);
    return () => ro.disconnect();
  }, [open, panelRef, triggerRef, scheduleReposition]);

  // スクロール・リサイズでは閉じずに追従する。
  // 閉じるのは「トリガーが可視範囲から出たとき」だけ（判定は純粋関数）。
  useEffect(() => {
    if (!open) return;

    const onScroll = (e: Event) => {
      const scrolledInsidePanel = e.target instanceof Node && !!panelRef.current?.contains(e.target);
      const trigger = triggerRef.current;
      const clip = scrollParentRef.current;
      const shouldClose = computeFloatingPanelCloseOnScroll({
        scrolledInsidePanel,
        triggerRect: trigger ? toTriggerRect(trigger.getBoundingClientRect()) : null,
        clipRect: clip ? toTriggerRect(clip.getBoundingClientRect()) : null,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      });
      if (shouldClose) { onRequestCloseRef.current(); return; }
      if (!scrolledInsidePanel) scheduleReposition();
    };
    const onResize = () => scheduleReposition();

    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, panelRef, triggerRef, scheduleReposition]);

  useEffect(() => () => {
    if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
  }, []);

  return {
    panelStyle,
    scrollAreaStyle: {
      overflowY: "auto",
      overscrollBehavior: FLOATING_PANEL_OVERSCROLL_BEHAVIOR,
      minHeight: 0,
    },
    reposition,
  };
}
