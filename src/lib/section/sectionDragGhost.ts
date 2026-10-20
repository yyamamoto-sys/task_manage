// src/lib/section/sectionDragGhost.ts
//
// グループ見出しをドラッグするときに、カーソルに付く小さな札（ドラッグゴースト）を作る。
// setDragImage に渡すため body 直下へ一時的に足し、画面外（top:-1000px）に置く。
// 札は setDragImage のためだけの要素なのでポインタ操作は受けない（pointerEvents:none）。
// dragend・drop・Esc・ドラッグ状態が解除されたとき（useSectionDragGuard）に必ず除去する。

let ghost: HTMLElement | null = null;

export function removeSectionDragGhost(): void {
  if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
  ghost = null;
}

const NAME_MAX = 20;

export function startSectionDragGhost(e: { dataTransfer: DataTransfer | null }, name: string): void {
  removeSectionDragGhost();
  if (typeof document === "undefined" || !e.dataTransfer || typeof e.dataTransfer.setDragImage !== "function") return;
  const shown = name.length > NAME_MAX ? `${name.slice(0, NAME_MAX)}…` : name;
  const el = document.createElement("div");
  el.textContent = `📁 ${shown} を移動`;
  el.setAttribute("aria-hidden", "true");
  el.style.cssText = [
    "position:fixed", "top:-1000px", "left:0", "pointer-events:none",
    "padding:4px 10px", "font-size:12px", "font-weight:600", "white-space:nowrap",
    "color:#fff", "background:var(--color-brand)", "border-radius:6px",
    "box-shadow:0 2px 8px rgba(0,0,0,0.25)",
  ].join(";");
  document.body.appendChild(el);
  ghost = el;
  e.dataTransfer.setDragImage(el, 12, 12);
}
