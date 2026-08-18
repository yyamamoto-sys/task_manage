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

/**
 * 見た目のオプション（v3.76）。
 *
 * 🔴 tone の既定値は "danger"（赤・ゴミ箱アイコン・「削除する」ラベル）のまま据え置く。
 * 呼び出し箇所は19あり、うち大半（削除・取り消し・解除等）は破壊的操作のため。既定を
 * "neutral" 側に変えると、それら全ての見た目を一度に変えることになり、拾い漏れた
 * 呼び出しが「削除ボタンが無害に見える」という悪い方向の回帰を起こす（招待の参加確認が
 * 削除の見た目になっていた今回の不具合の逆方向）。**非破壊の確認を新しく追加するときは、
 * 呼び出し側が必ず { tone: "neutral" } を明示すること。**
 */
export interface ConfirmDialogOptions {
  tone?: "danger" | "neutral";
  /** 確定ボタンのラベル（省略時は type/tone から既定値を出す） */
  confirmLabel?: string;
}

type ShowFn = (message: string, type: "confirm" | "alert", opts?: ConfirmDialogOptions) => Promise<boolean>;
let _showFn: ShowFn | null = null;

/** ConfirmModal コンポーネントが呼び出す登録関数（外部から直接呼ばないこと） */
export function _registerModal(fn: ShowFn): void {
  _showFn = fn;
}

/**
 * 確認ダイアログを表示する。
 * Teams 埋め込み環境を含む全ブラウザで動作する。
 * @param opts 見た目の指定。省略時は tone="danger"（削除等の破壊的操作の既定の見た目）。
 * @returns ユーザーが「OK」を押した場合 true、「キャンセル」は false
 */
export function confirmDialog(message: string, opts?: ConfirmDialogOptions): Promise<boolean> {
  if (_showFn) return _showFn(message, "confirm", opts);
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
