// src/components/consultation/FollowUpButtons.tsx
//
// 【設計意図】
// AIが返したfollow_up_suggestionsを小さなボタンで表示。
// クリックでテキストエリアに挿入する（即APIコールはしない）。
// CLAUDE.md Section 6-12: useFollowUpはexportしない（誤用防止のため）。

interface Props {
  suggestions: string[];
  onSelect: (text: string) => void;
}

export function FollowUpButtons({ suggestions, onSelect }: Props) {
  if (suggestions.length === 0) return null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        padding: "8px 0",
      }}
    >
      <div
        style={{
          fontSize: "10px",
          color: "var(--color-text-tertiary)",
          fontWeight: "500",
          letterSpacing: "0.03em",
        }}
      >
        次の相談候補
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
        {suggestions.map((s, i) => (
          <button
            key={i}
            onClick={() => onSelect(s)}
            style={{
              fontSize: "11px",
              padding: "4px 10px",
              background: "var(--color-bg-secondary)",
              border: "1px solid var(--color-border-primary)",
              borderRadius: "var(--radius-full)",
              color: "var(--color-text-secondary)",
              cursor: "pointer",
              lineHeight: 1.5,
              textAlign: "left",
              maxWidth: "100%",
              whiteSpace: "normal",
            }}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
