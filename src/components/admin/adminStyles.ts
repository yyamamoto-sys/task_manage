// src/components/admin/adminStyles.ts
//
// 【設計意図】
// 設定画面（AdminView とその配下のセクション）で共有するインラインstyle定数。
// 元は AdminView.tsx のモジュール定数だったが、セクションを別ファイルに切り出すたびに
// 同じ見た目を再定義する（または AdminView を循環importする）ことになるため、
// 純粋な定数だけをこのファイルへ移した。値・見た目は移動前と同一。

export const inputStyle: React.CSSProperties = {
  width: "100%", padding: "6px 9px",
  border: "1px solid var(--color-border-primary)",
  borderRadius: "var(--radius-md)", fontSize: "12px",
  color: "var(--color-text-primary)", background: "var(--color-bg-primary)",
  outline: "none",
};
export const primaryBtnStyle: React.CSSProperties = {
  padding: "5px 14px", fontSize: "11px", fontWeight: "500",
  background: "var(--color-bg-info)", color: "var(--color-text-info)",
  border: "1px solid var(--color-border-info)",
  borderRadius: "var(--radius-md)", cursor: "pointer",
};
export const ghostBtnStyle: React.CSSProperties = {
  padding: "5px 12px", fontSize: "11px",
  color: "var(--color-text-secondary)",
  border: "1px solid var(--color-border-primary)",
  borderRadius: "var(--radius-md)", cursor: "pointer",
  background: "transparent",
};
/** 各セクションヘッダーの「＋ 追加」系ボタン（ブランド色の塗りつぶし・モックのトーン） */
export const addBtnStyle: React.CSSProperties = {
  padding: "6px 12px", fontSize: "12px", fontWeight: "500",
  background: "var(--color-brand)", color: "#fff",
  border: "none", borderRadius: "var(--radius-md)", cursor: "pointer",
};
