// src/components/settings/settingsUi.tsx
//
// 設定ページ（SettingsView）の各ページが共有する見た目の部品（v3.128 で SettingsView から分離）。
// v3.155：見た目の基準（docs/dev/設計仕様_設定画面リニューアル_20261015.md §4.2）に揃えた。
// 最小文字は12px（Section 60：fontSize を下げる方向の調整はしない）。モバイルは入力 16px・最小高さ44px。

import { useMemo, type CSSProperties, type ReactNode } from "react";
import { useIsMobile } from "../../hooks/useIsMobile";

/** ページ本文の縦の並び（見出し・説明は SettingsView の見出しバーと本文先頭が持つ） */
export function SectionBody({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>{children}</div>;
}

export function Row({ label, hint, flash, children }: { label: string; hint?: string; flash?: ReactNode; children: ReactNode }) {
  const isMobile = useIsMobile();
  return (
    <div style={{
      padding: isMobile ? "14px 16px" : "16px 18px", border: "1px solid var(--color-border-primary)",
      borderRadius: "var(--radius-lg)", background: "var(--color-bg-primary)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
        <div style={{ flex: 1, minWidth: 0, fontSize: "14px", fontWeight: 600, color: "var(--color-text-primary)" }}>{label}</div>
        {flash}
      </div>
      {children}
      {hint && <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", marginTop: "8px", lineHeight: 1.6 }}>{hint}</div>}
    </div>
  );
}

export function fieldStyles(isMobile: boolean) {
  const input: CSSProperties = {
    width: "100%", boxSizing: "border-box",
    padding: isMobile ? "10px 12px" : "8px 12px", minHeight: isMobile ? "44px" : "40px",
    fontSize: isMobile ? "16px" : "14px",
    border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
    background: "var(--color-bg-primary)", color: "var(--color-text-primary)",
  };
  const btn: CSSProperties = {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    padding: "0 16px", minHeight: isMobile ? "44px" : "36px", fontSize: "14px", cursor: "pointer",
    border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
    background: "var(--color-bg-secondary)", color: "var(--color-text-primary)",
  };
  const primaryBtn: CSSProperties = {
    ...btn, background: "var(--color-brand)", color: "#fff", border: "1px solid var(--color-brand)",
  };
  return { input, btn, primaryBtn };
}

/** 入力欄・ボタンの見た目（PC：14px・最小高さ40／36px、モバイル：16px・44px） */
export function useFieldStyles() {
  const isMobile = useIsMobile();
  return useMemo(() => ({ ...fieldStyles(isMobile), isMobile }), [isMobile]);
}

export function SegButtons<T extends string>({ value, options, onChange }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void;
}) {
  const isMobile = useIsMobile();
  return (
    <div style={{ display: "inline-flex", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", overflow: "hidden" }}>
      {options.map((o, i) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          style={{
            padding: "0 16px", minHeight: isMobile ? "44px" : "36px", fontSize: "14px", border: "none", cursor: "pointer",
            borderLeft: i > 0 ? "1px solid var(--color-border-primary)" : "none",
            background: value === o.value ? "var(--color-bg-info)" : "transparent",
            color: value === o.value ? "var(--color-text-info)" : "var(--color-text-secondary)",
            fontWeight: value === o.value ? 600 : 400,
          }}
        >{o.label}</button>
      ))}
    </div>
  );
}
