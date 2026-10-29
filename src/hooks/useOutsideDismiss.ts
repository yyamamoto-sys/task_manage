// src/hooks/useOutsideDismiss.ts
//
// open の間、containers の外側での pointerdown と Esc で onClose を呼ぶ（v3.193）。
// suspended が true の間（ツアー実行中）は何もしない。
import { useEffect, useRef } from "react";
import { isInsideAny, shouldDismissOnOutside } from "../lib/layout/outsideDismiss";

export function useOutsideDismiss(
  open: boolean,
  containers: ReadonlyArray<React.RefObject<HTMLElement | null>>,
  onClose: () => void,
  suspended: boolean,
): void {
  const containersRef = useRef(containers);
  containersRef.current = containers;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open || suspended) return;
    const onPointerDown = (e: PointerEvent) => {
      const inside = isInsideAny(e.target as Node | null, containersRef.current.map(r => r.current));
      if (shouldDismissOnOutside({ open, suspended, inside })) onCloseRef.current();
    };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") onCloseRef.current(); };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, suspended]);
}
