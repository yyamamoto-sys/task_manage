// src/components/consultation/FollowUpButtons.tsx
//
// 【設計意図】
// AIが返したfollow_up_suggestionsを小さなボタンで表示。
// クリックでテキストエリアに挿入する（即APIコールはしない）。
// CLAUDE.md Section 6-12: useFollowUpはexportしない（誤用防止のため）。
//
// 数が多いと画面が見づらいため、既定は折りたたみ（ヘッダーだけ表示）。
// ヘッダーをクリックすると候補ボタン群を展開する（トグル）。localStorageで開閉を記憶。

import { useState } from "react";
import { KEYS } from "../../lib/localData/localStore";

interface Props {
  suggestions: string[];
  onSelect: (text: string) => void;
}

export function FollowUpButtons({ suggestions, onSelect }: Props) {
  const [open, setOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(KEYS.CONSULT_FOLLOWUP_OPEN) === "1"; } catch { return false; }
  });

  if (suggestions.length === 0) return null;

  const toggle = () => {
    setOpen(prev => {
      const next = !prev;
      try { localStorage.setItem(KEYS.CONSULT_FOLLOWUP_OPEN, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "8px 0" }}>
      {/* ヘッダー（クリックで開閉） */}
      <button
        onClick={toggle}
        aria-expanded={open}
        style={{
          display: "flex", alignItems: "center", gap: "5px",
          background: "transparent", border: "none", cursor: "pointer",
          padding: 0, color: "var(--color-text-tertiary)",
          fontSize: "10px", fontWeight: "500", letterSpacing: "0.03em",
        }}
      >
        <span style={{ fontSize: "9px", display: "inline-block", transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>▶</span>
        💡 次の相談候補（{suggestions.length}）
      </button>

      {/* 候補ボタン群（開いているときだけ） */}
      {open && (
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
      )}
    </div>
  );
}
