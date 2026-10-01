// src/components/settings/settingsUi.tsx
//
// 設定ページ（SettingsView）の各セクションが共有する見た目の部品（v3.128 で SettingsView から分離）。

import type { CSSProperties, ReactNode } from "react";

export function SectionBody({ title, lead, children }: { title: string; lead?: string; children: ReactNode }) {
  return (
    <div style={{ padding: "16px 20px", maxWidth: "640px" }}>
      <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--color-text-primary)" }}>{title}</div>
      {lead && <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", marginTop: "4px", lineHeight: 1.7 }}>{lead}</div>}
      <div style={{ marginTop: "14px", display: "flex", flexDirection: "column", gap: "14px" }}>{children}</div>
    </div>
  );
}

export function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div style={{
      padding: "12px 14px", border: "1px solid var(--color-border-primary)",
      borderRadius: "var(--radius-lg)", background: "var(--color-bg-primary)",
    }}>
      <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-text-primary)", marginBottom: "6px" }}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginTop: "6px", lineHeight: 1.7 }}>{hint}</div>}
    </div>
  );
}

export const inputStyle: CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "6px 8px", fontSize: "13px",
  border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
  background: "var(--color-bg-primary)", color: "var(--color-text-primary)",
};

export const btnStyle: CSSProperties = {
  padding: "6px 12px", fontSize: "12px", cursor: "pointer",
  border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
  background: "var(--color-bg-secondary)", color: "var(--color-text-primary)",
};

export const primaryBtnStyle: CSSProperties = {
  ...btnStyle, background: "var(--color-brand)", color: "#fff", border: "1px solid var(--color-brand)",
};

export function SegButtons<T extends string>({ value, options, onChange }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void;
}) {
  return (
    <div style={{ display: "inline-flex", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", overflow: "hidden" }}>
      {options.map((o, i) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          style={{
            padding: "5px 12px", fontSize: "12px", border: "none", cursor: "pointer",
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
