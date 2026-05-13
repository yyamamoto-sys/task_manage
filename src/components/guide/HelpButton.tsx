// src/components/guide/HelpButton.tsx
//
// 【設計意図】
// 各パネルに置く小さな「？」ボタン。modeKey で指定されたガイドを GuideOverlay で開く。
// docs/guides/**/*.md の frontmatter `mode:` キーと一致するページが表示される。
// 一致するページがまだ無くてもクリックは可能（オーバーレイ側で「未作成」を表示）。

import { useState } from "react";
import { GuideOverlay } from "./GuideOverlay";

interface Props {
  modeKey: string;
  /** 表示テキスト。省略時は "?"。 */
  label?: string;
  /** ボタンサイズ（small=20px 円形 / inline=テキスト風）。 */
  variant?: "small" | "inline";
  title?: string;
}

export function HelpButton({ modeKey, label, variant = "small", title }: Props) {
  const [open, setOpen] = useState(false);

  const small: React.CSSProperties = {
    width: "22px", height: "22px", borderRadius: "50%",
    border: "1px solid var(--color-border-primary)",
    background: "var(--color-bg-primary)",
    color: "var(--color-text-tertiary)",
    fontSize: "12px", fontWeight: 700, lineHeight: 1,
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    cursor: "pointer", padding: 0, flexShrink: 0,
  };
  const inline: React.CSSProperties = {
    fontSize: "11px", padding: "3px 9px",
    background: "transparent",
    border: "1px solid var(--color-border-primary)",
    borderRadius: "var(--radius-full)",
    color: "var(--color-text-secondary)", cursor: "pointer",
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={title ?? "このページのガイドを開く"}
        aria-label={title ?? "このページのガイドを開く"}
        style={variant === "small" ? small : inline}
      >
        {label ?? (variant === "small" ? "?" : "📖 ガイド")}
      </button>
      {open && <GuideOverlay modeKey={modeKey} onClose={() => setOpen(false)} />}
    </>
  );
}
