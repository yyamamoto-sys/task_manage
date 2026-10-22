// src/lib/visibility.ts
//
// タブが非表示（hidden）かどうか。DB に問い合わせる定期処理は、非表示の間は取りに行かず、
// 前面に戻ったときに1回だけ取る（v3.171・CLAUDE.md Section 76 の Disk IO 対策）。
// document が無い環境（テスト）では false（＝表示中として扱う）。

export function isDocumentHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}
