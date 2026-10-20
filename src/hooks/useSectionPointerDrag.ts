// src/hooks/useSectionPointerDrag.ts
//
// グループ見出しのドラッグ（⠿ をつかんで並べ替え）を Pointer Events で行う共通フック（リスト・ガント）。
//
// 【HTML5 DnD をやめた理由】Windows の Chrome は native drag 中にマウスホイールでスクロールできない。
// 長い表では「つかんだまま画面をスクロールして落とす先を探す」ことができなかった。
// Pointer Events なら通常のマウス押下と同じなので、ホイールがそのまま効く（preventDefault しない）。
//
// 🔴 setPointerCapture は使わない：捕捉するとホイールのスクロール先・elementFromPoint の判定を
//    こちらで管理する必要が出る。window の pointermove だけで足りる（ウィンドウ外へ出たら止まるだけ）。
// 🔴 落とす先の見出しは `data-section-drop-key`（行のキー）・`data-section-key`（グループ id／未分類）・
//    `data-section-project`（PJ id）で判定する。呼び出し側は見出しの行にこの3属性を付ける。
// 🔴 ドラッグが始まらなかった pointerup（4px 未満）は何もしない＝クリック（折りたたみ・⋮）に影響しない。
//    ドラッグが成立したときだけ、直後に来る click を1回だけ握りつぶす（ガントは同じ行の上で離すと
//    行の onClick＝折りたたみが誤発火するため）。

import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject, PointerEvent as ReactPointerEvent } from "react";
import { sectionAutoScrollDelta } from "../lib/section/sectionAutoScroll";

export const SECTION_DRAG_THRESHOLD_PX = 4;

export interface SectionDragState { id: string; projectId: string; name: string }
export interface SectionDropTarget { key: string; sectionKey: string; projectId: string }

export interface SectionPointerDragOptions {
  /** 自動スクロールの対象（scrollEl）と、端の判定に使う領域（rectEl。省略時は scrollEl 自身） */
  getScrollArea: () => { scrollEl: HTMLElement | null; rectEl?: HTMLElement | null };
  /** 落とした。target が null＝見出しの上ではない場所で離した */
  onCommit: (drag: SectionDragState, target: SectionDropTarget | null) => void;
}

export interface SectionDragGhostProps {
  name: string;
  pointRef: MutableRefObject<{ x: number; y: number }>;
  elRef: MutableRefObject<HTMLDivElement | null>;
}

export function targetFromElement(el: Element | null): SectionDropTarget | null {
  const row = el?.closest<HTMLElement>("[data-section-drop-key]");
  if (!row) return null;
  const key = row.getAttribute("data-section-drop-key");
  const sectionKey = row.getAttribute("data-section-key");
  const projectId = row.getAttribute("data-section-project");
  if (!key || !sectionKey || !projectId) return null;
  return { key, sectionKey, projectId };
}

export function useSectionPointerDrag(options: SectionPointerDragOptions) {
  const optsRef = useRef(options);
  optsRef.current = options;

  const [dragging, setDragging] = useState<SectionDragState | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const pointRef = useRef({ x: 0, y: 0 });
  const ghostElRef = useRef<HTMLDivElement | null>(null);

  const cancel = useCallback(() => { cleanupRef.current?.(); }, []);
  useEffect(() => () => { cleanupRef.current?.(); }, []);

  const begin = useCallback((drag: SectionDragState, e: ReactPointerEvent) => {
    if (e.button !== 0 || !e.isPrimary) return;
    cleanupRef.current?.();

    const startX = e.clientX;
    const startY = e.clientY;
    pointRef.current = { x: startX, y: startY };
    let started = false;
    let target: SectionDropTarget | null = null;
    let raf = 0;
    let done = false;
    const prevUserSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;

    const placeGhost = () => {
      const el = ghostElRef.current;
      if (el) el.style.transform = `translate(${pointRef.current.x + 14}px, ${pointRef.current.y + 14}px)`;
    };

    const updateTarget = () => {
      const { x, y } = pointRef.current;
      const next = targetFromElement(document.elementFromPoint(x, y));
      if ((next?.key ?? null) === (target?.key ?? null)) { target = next; return; }
      target = next;
      setDropKey(next ? next.key : null);
    };

    const tick = () => {
      if (done) return;
      const { scrollEl, rectEl } = optsRef.current.getScrollArea();
      if (scrollEl) {
        const rect = (rectEl ?? scrollEl).getBoundingClientRect();
        const delta = sectionAutoScrollDelta(pointRef.current.y, rect.top, rect.bottom);
        if (delta !== 0) {
          const before = scrollEl.scrollTop;
          scrollEl.scrollTop = before + delta;
          if (scrollEl.scrollTop !== before) updateTarget();
        }
      }
      raf = requestAnimationFrame(tick);
    };

    const swallowNextClick = () => {
      const handler = (ev: MouseEvent) => { ev.stopPropagation(); ev.preventDefault(); };
      window.addEventListener("click", handler, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener("click", handler, { capture: true }), 100);
    };

    const onMove = (ev: PointerEvent) => {
      if (!ev.isPrimary) return;
      pointRef.current = { x: ev.clientX, y: ev.clientY };
      if (!started) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < SECTION_DRAG_THRESHOLD_PX) return;
        started = true;
        document.body.style.userSelect = "none";
        document.body.style.cursor = "grabbing";
        setDragging(drag);
        raf = requestAnimationFrame(tick);
      } else if (ev.buttons === 0) {
        // 押下中のはずが離れている（ウィンドウ外で離した等）＝中止
        cleanup();
        return;
      }
      placeGhost();
      updateTarget();
    };

    const onUp = (ev: PointerEvent) => {
      if (!ev.isPrimary) return;
      if (!started) { cleanup(); return; }
      pointRef.current = { x: ev.clientX, y: ev.clientY };
      updateTarget();
      const dropped = target;
      cleanup();
      swallowNextClick();
      optsRef.current.onCommit(drag, dropped);
    };

    const onScroll = () => { if (started) updateTarget(); };
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") cleanup(); };

    function cleanup() {
      if (done) return;
      done = true;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", cleanup);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", cleanup);
      cancelAnimationFrame(raf);
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
      if (cleanupRef.current === cleanup) cleanupRef.current = null;
      if (started) { setDragging(null); setDropKey(null); }
    }

    cleanupRef.current = cleanup;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", cleanup);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", cleanup);
  }, []);

  const ghostProps: SectionDragGhostProps | null = dragging
    ? { name: dragging.name, pointRef, elRef: ghostElRef }
    : null;

  return { dragging, dropKey, cancel, begin, ghostProps };
}
