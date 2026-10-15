// src/lib/shortcuts/taskFocusDom.ts
//
// 注目中タスクの見た目（フォーカスリング）と画面内への自動スクロール、詳細の欄へのフォーカス（v3.162）。
// 行・カード・ガントのバーは data-task-focus-id={taskId} を持つだけでよい。リングは <style> を1つだけ
// document.head に置いて当てる（メモ化された行コンポーネントを再描画させないため・選択状態の見た目とは独立）。

export const TASK_FOCUS_ATTR = "data-task-focus-id";
const STYLE_ID = "amp-task-focus-style";

function escapeAttr(id: string): string {
  return id.replace(/["\\]/g, "\\$&");
}

export function applyTaskFocusRing(taskId: string | null): void {
  if (typeof document === "undefined") return;
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!taskId) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement("style");
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent =
    `[${TASK_FOCUS_ATTR}="${escapeAttr(taskId)}"]{outline:2px solid var(--color-brand) !important;outline-offset:-2px !important;}`;
}

/** 注目中の要素が画面外なら見える位置まで動かす（block:"nearest"＝すでに見えていれば動かさない） */
export function scrollTaskIntoView(taskId: string): void {
  if (typeof document === "undefined") return;
  const el = document.querySelector<HTMLElement>(`[${TASK_FOCUS_ATTR}="${escapeAttr(taskId)}"]`);
  el?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

export type DetailField = "assignee" | "due";

/**
 * 詳細パネルが開いたあと、担当欄／期限欄にフォーカスする。パネルの描画を待つため短時間ポーリングする。
 * 欄が見つからなければ何もしない（詳細が開くだけ）。データは変えない。
 */
export function focusDetailField(field: DetailField, maxFrames = 40): void {
  if (typeof document === "undefined") return;
  let frames = 0;
  const tick = () => {
    const root = document.querySelector<HTMLElement>(`[data-shortcut-field="${field}"]`);
    const target = root
      ? (root.matches("input,button,select,textarea") ? root : root.querySelector<HTMLElement>("input,button,select,textarea,[tabindex]"))
      : null;
    if (target) {
      target.focus();
      return;
    }
    if (++frames < maxFrames) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
