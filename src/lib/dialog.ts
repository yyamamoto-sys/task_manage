// src/lib/dialog.ts
//
// 【設計意図】
// window.confirm() / alert() は Microsoft Teams の WebView では動作しない。
// このモジュールを通じて呼び出すことで、全環境で一貫した動作を保証する。
//
// 使い方（呼び出し側）：
//   if (!await confirmDialog("削除しますか？")) return;
//
// 仕組み：
//   ConfirmModal コンポーネントが起動時に _registerModal() で自分を登録する。
//   登録前は window.confirm() にフォールバック（開発時のSSRやテスト対応）。

type ShowFn = (message: string, type: "confirm" | "alert") => Promise<boolean>;
let _showFn: ShowFn | null = null;

/** ConfirmModal コンポーネントが呼び出す登録関数（外部から直接呼ばないこと） */
export function _registerModal(fn: ShowFn): void {
  _showFn = fn;
}

/**
 * 確認ダイアログを表示する。
 * Teams 埋め込み環境を含む全ブラウザで動作する。
 * @returns ユーザーが「OK」を押した場合 true、「キャンセル」は false
 */
export function confirmDialog(message: string): Promise<boolean> {
  if (_showFn) return _showFn(message, "confirm");
  // フォールバック（ConfirmModal 未マウント時のみ）
  return Promise.resolve(window.confirm(message));
}

/**
 * 警告ダイアログを表示する。
 * Teams 埋め込み環境を含む全ブラウザで動作する。
 */
export function alertDialog(message: string): Promise<void> {
  if (_showFn) return _showFn(message, "alert").then(() => undefined);
  window.alert(message);
  return Promise.resolve();
}
