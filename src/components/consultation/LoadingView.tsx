// src/components/consultation/LoadingView.tsx
//
// 【設計意図】
// AI応答待ち中に表示するローディングコンポーネント。
// loadingMessageはuseAIConsultationからランダムに渡される。

interface Props {
  message: string;
}

export function LoadingView({ message }: Props) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "12px",
        padding: "32px 16px",
        color: "var(--color-text-secondary)",
      }}
    >
      <div
        style={{
          width: "24px",
          height: "24px",
          border: "2px solid var(--color-brand-border)",
          borderTopColor: "var(--color-brand)",
          borderRadius: "50%",
          animation: "spin 0.8s linear infinite",
        }}
      />
      <span style={{ fontSize: "12px" }}>{message}</span>
    </div>
  );
}
