// src/components/section/SectionDragGhost.tsx
//
// グループ見出しをドラッグ中にカーソルへ追従する「📁 名前 を移動」の札。
// HTML5 DnD の setDragImage が使えなくなったため、body 直下に固定位置で描く。
//
// 位置は再描画せず、フック（useSectionPointerDrag）が pointermove のたびに transform を直接書く
// （表全体を再描画しない）。マウント直後の初期位置だけこちらで置く。
// 🔴 札はポインタ操作を受けない（none）：受けると elementFromPoint が札を拾い、落とす先を判定できなくなる。
// 🔴 z-index はポップオーバー（9999）と同じ層で、ツアーの吹き出し（TOUR_Z.bubble）より下。

import { useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { TOUR_Z } from "../tour/tourLayout";
import type { SectionDragGhostProps } from "../../hooks/useSectionPointerDrag";

const NAME_MAX = 20;

export function SectionDragGhost({ name, pointRef, elRef }: SectionDragGhostProps) {
  useLayoutEffect(() => {
    const el = elRef.current;
    if (el) el.style.transform = `translate(${pointRef.current.x + 14}px, ${pointRef.current.y + 14}px)`;
  }, [elRef, pointRef]);

  if (typeof document === "undefined") return null;
  const shown = name.length > NAME_MAX ? `${name.slice(0, NAME_MAX)}…` : name;
  return createPortal(
    <div
      ref={elRef}
      aria-hidden="true"
      data-section-drag-ghost=""
      style={{
        position: "fixed", top: 0, left: 0, pointerEvents: "none", zIndex: TOUR_Z.bubble - 1,
        padding: "4px 10px", fontSize: "12px", fontWeight: 600, whiteSpace: "nowrap",
        color: "#fff", background: "var(--color-brand)", borderRadius: "6px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
      }}
    >📁 {shown} を移動</div>,
    document.body,
  );
}
