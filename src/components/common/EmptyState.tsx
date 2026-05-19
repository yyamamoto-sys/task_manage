// src/components/common/EmptyState.tsx
//
// 各ビューでデータ0件・絞り込み結果0件のときに表示する共通プレースホルダー。
// 「何が起きているか」と「次にやれること（CTA）」をセットで提示する。

interface Action {
  label: string;
  onClick: () => void;
  variant?: "primary" | "ghost";
}

interface Props {
  icon?: string;
  title: string;
  hint?: string;
  actions?: Action[];
}

export function EmptyState({ icon = "📭", title, hint, actions = [] }: Props) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", gap: "10px",
      padding: "48px 24px", textAlign: "center",
      color: "var(--color-text-secondary)",
    }}>
      <div style={{ fontSize: "32px", opacity: 0.7 }}>{icon}</div>
      <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-text-primary)" }}>
        {title}
      </div>
      {hint && (
        <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", maxWidth: "420px", lineHeight: 1.6 }}>
          {hint}
        </div>
      )}
      {actions.length > 0 && (
        <div style={{ display: "flex", gap: "8px", marginTop: "6px", flexWrap: "wrap", justifyContent: "center" }}>
          {actions.map((a, i) => {
            const isPrimary = (a.variant ?? "primary") === "primary";
            return (
              <button key={i} onClick={a.onClick} style={{
                padding: "6px 14px", fontSize: "11px", fontWeight: 600,
                background: isPrimary ? "var(--color-brand)" : "transparent",
                color: isPrimary ? "#fff" : "var(--color-text-secondary)",
                border: isPrimary ? "none" : "1px solid var(--color-border-primary)",
                borderRadius: "var(--radius-md)",
                cursor: "pointer",
              }}>{a.label}</button>
            );
          })}
        </div>
      )}
    </div>
  );
}
