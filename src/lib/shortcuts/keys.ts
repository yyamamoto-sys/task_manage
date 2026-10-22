// src/lib/shortcuts/keys.ts
//
// 【設計意図】キーボードショートカットの「発火してよいか」の判定を1か所に寄せる（v3.162）。
// 単キー（J/K/E/N/A/D/?/Enter 等）は、入力中・IME変換中・モーダル表示中・修飾キー併用時に
// 発火させてはいけない。画面ごとに判定を書くと漏れる（過去にビューごとの重複判定が3つ生まれた）ため、
// 新しい単キーは必ず shouldIgnoreSingleKey を通す。DOM に依存しない構造的な型で受けるので node の
// vitest でそのままテストできる。

export interface KeyEventLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
  defaultPrevented?: boolean;
}

export interface ElementLike {
  tagName?: string;
  isContentEditable?: boolean;
  type?: string;
  getAttribute?: (name: string) => string | null;
}

/** 文字を打たない input（チェックボックス等）。これらにフォーカスがあっても単キーは効かせてよい */
const NON_TEXT_INPUT_TYPES = new Set([
  "checkbox", "radio", "range", "button", "submit", "reset", "file", "color", "image",
]);

/** 文字入力中か（input[text系]・textarea・select・contenteditable） */
export function isTypingTarget(el: ElementLike | null | undefined): boolean {
  if (!el) return false;
  const tag = (el.tagName ?? "").toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return !NON_TEXT_INPUT_TYPES.has((el.type ?? "text").toLowerCase());
  return el.isContentEditable === true;
}

/**
 * Enter で自分自身が動くフォーカス要素か（ボタン・リンク・role=button 等・チェックボックス）。
 * ここでの Enter を奪うと二重に動く（行を開く→閉じる等）ため、Enter だけはこの要素上で無視する。
 */
export function isInteractiveTarget(el: ElementLike | null | undefined): boolean {
  if (!el) return false;
  const tag = (el.tagName ?? "").toUpperCase();
  if (tag === "BUTTON" || tag === "A" || tag === "SUMMARY") return true;
  if (tag === "INPUT" && NON_TEXT_INPUT_TYPES.has((el.type ?? "text").toLowerCase())) return true;
  const role = el.getAttribute?.("role");
  return role === "button" || role === "link" || role === "menuitem" || role === "tab" || role === "checkbox" || role === "switch";
}

/** IME の変換中（変換確定の Enter を含む） */
export function isImeComposing(e: KeyEventLike): boolean {
  return e.isComposing === true || e.key === "Process" || e.keyCode === 229;
}

export function hasCommandModifier(e: KeyEventLike): boolean {
  return e.ctrlKey === true || e.metaKey === true || e.altKey === true;
}

export interface SingleKeyContext {
  activeElement: ElementLike | null | undefined;
  /** モーダル（ConfirmModal・独自モーダル・コマンドパレット等）が開いているか */
  modalOpen: boolean;
}

/**
 * 単キーのショートカットを無視すべきか。true なら何もしない。
 * Ctrl/Alt/Meta 併用は常に無視（Ctrl+E 等のブラウザ動作を奪わない）。
 */
export function shouldIgnoreSingleKey(e: KeyEventLike, ctx: SingleKeyContext): boolean {
  if (isImeComposing(e)) return true;
  if (hasCommandModifier(e)) return true;
  if (e.defaultPrevented) return true;
  if (ctx.modalOpen) return true;
  if (isTypingTarget(ctx.activeElement)) return true;
  return false;
}

/** 単キー名（j/e/n 等）の一致。Shift 併用は誤爆防止のため不一致。CapsLock の大文字は許可 */
export function isPlainLetter(e: KeyEventLike, letter: string): boolean {
  return e.shiftKey !== true && e.key.toLowerCase() === letter;
}

/** Ctrl/Cmd+Z（Shift なし）か。Redo は含めない */
export function isUndoKey(e: KeyEventLike): boolean {
  return (e.ctrlKey === true || e.metaKey === true) && e.shiftKey !== true && e.key.toLowerCase() === "z";
}

/**
 * AI相談パネルの Ctrl+Z（提案の取り消し）を実行してよいか。
 * 入力欄では、ブラウザ標準の文字の取り消しに任せるため実行しない（v3.162 の不具合修正）。
 */
export function shouldRunConsultUndo(e: KeyEventLike, activeElement: ElementLike | null | undefined): boolean {
  if (!isUndoKey(e)) return false;
  return !isTypingTarget(activeElement);
}

/** 並びの中で注目を ±1 動かす。端で止まる（循環しない）。現在地が並びに無いときは先頭 */
export function moveFocus(orderedIds: readonly string[], currentId: string | null, dir: 1 | -1): string | null {
  if (orderedIds.length === 0) return null;
  const idx = currentId === null ? -1 : orderedIds.indexOf(currentId);
  if (idx < 0) return orderedIds[0];
  const next = Math.min(orderedIds.length - 1, Math.max(0, idx + dir));
  return orderedIds[next];
}

/**
 * Ctrl/Cmd 併用のショートカット（Ctrl+A 等）を無視すべきか。修飾キーは前提なので見ない。
 * 入力中・IME変換中・モーダル表示中・他ハンドラ処理済みなら true。
 */
export function shouldIgnoreCommandKey(e: KeyEventLike, ctx: SingleKeyContext): boolean {
  if (isImeComposing(e)) return true;
  if (e.defaultPrevented) return true;
  if (ctx.modalOpen) return true;
  return isTypingTarget(ctx.activeElement);
}
