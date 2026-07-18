// src/lib/lastUndoStore.ts
//
// 【設計意図】
// Ctrl/Cmd+Z で発火する「軽量版Undo」の状態保持。本格的な多段Undo履歴（スタック）は
// 作らず、「直前に表示されたUndoトーストのアクション」だけを1件保持する。
//
// - 登録：Undo付きトースト（isUndo:true）が表示されるたびに setLastUndoAction で上書き
//   （＝より新しいUndoで自動的に置き換わる）
// - 消費：Ctrl/Cmd+Z が押されたら consumeLastUndoAction で取り出し、同時にクリアする
//   （実行後は「戻す前の状態」に戻っているため、続けてもう一度Ctrl+Zしても何も起きない。
//   多段Undoが必要ならこのモジュールを差し替える）
// - トーストが自動消滅（タイムアウト）してもハンドラ自体は保持し続けてよい
//   （クリックできる猶予より少し長くCtrl+Zでの取り消しを許容する親切設計）

let lastUndoAction: (() => void) | null = null;

export function setLastUndoAction(action: () => void): void {
  lastUndoAction = action;
}

/** 取り出すと同時にクリアする（実行後の二重発火防止） */
export function consumeLastUndoAction(): (() => void) | null {
  const action = lastUndoAction;
  lastUndoAction = null;
  return action;
}

export function clearLastUndoAction(): void {
  lastUndoAction = null;
}

/** テスト・デバッグ用（クリアはしない） */
export function peekLastUndoAction(): (() => void) | null {
  return lastUndoAction;
}
