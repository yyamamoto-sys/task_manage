// src/components/consultation/ErrorView.tsx
//
// 【設計意図】
// API呼び出し失敗時のエラー表示と再試行ボタン。

interface Props {
  message: string;
  onRetry: () => void;
}

export function ErrorView({ message, onRetry }: Props) {
  return (
    <div
      style={{
        margin: "12px 0",
        padding: "12px 14px",
        background: "var(--color-bg-danger)",
        border: "1px solid var(--color-border-danger)",
        borderRadius: "var(--radius-md)",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
      }}
    >
      <div style={{ fontSize: "12px", color: "var(--color-text-danger)" }}>
        {message}
      </div>
      <button
        onClick={onRetry}
        style={{
          alignSelf: "flex-start",
          fontSize: "11px",
          padding: "4px 10px",
          background: "var(--color-bg-primary)",
          border: "1px solid var(--color-border-danger)",
          borderRadius: "var(--radius-sm)",
          color: "var(--color-text-danger)",
          cursor: "pointer",
        }}
      >
        再試行
      </button>
    </div>
  );
}
