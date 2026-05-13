// src/components/common/MarkdownLite.tsx
//
// AIが返す軽量マークダウン（## / ### 見出し、- 箇条書き、1. 番号付き、**強調**、空行、段落）を
// 最小限のスタイルで描画する。フル機能のMarkdownライブラリは入れず、AI出力の表示に必要な範囲だけ。

import type { ReactNode } from "react";

/** **bold** だけインラインで処理する（リンク等は対象外） */
function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<strong key={i++} style={{ fontWeight: 700, color: "var(--color-text-primary)" }}>{m[1]}</strong>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function MarkdownLite({ text, compact = false }: { text: string; compact?: boolean }) {
  const lines = text.split("\n");
  const bodySize = compact ? "12px" : "13px";
  return (
    <div>
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={i} style={{ height: compact ? "5px" : "8px" }} />;

        if (trimmed.startsWith("## ")) {
          return (
            <div key={i} style={{
              fontSize: compact ? "12px" : "13px", fontWeight: 700, color: "var(--color-text-primary)",
              marginTop: i > 0 ? (compact ? "12px" : "16px") : 0, marginBottom: "5px",
              borderBottom: "1px solid var(--color-border-primary)", paddingBottom: "3px",
            }}>{renderInline(trimmed.slice(3))}</div>
          );
        }
        if (trimmed.startsWith("### ")) {
          return (
            <div key={i} style={{
              fontSize: bodySize, fontWeight: 700, color: "var(--color-text-primary)",
              marginTop: i > 0 ? "10px" : 0, marginBottom: "4px",
            }}>{renderInline(trimmed.slice(4))}</div>
          );
        }
        if (trimmed.startsWith("# ")) {
          return (
            <div key={i} style={{
              fontSize: compact ? "13px" : "15px", fontWeight: 700, color: "var(--color-text-primary)",
              marginTop: i > 0 ? "14px" : 0, marginBottom: "6px",
            }}>{renderInline(trimmed.slice(2))}</div>
          );
        }
        const bullet = trimmed.match(/^[-*]\s+(.*)$/);
        if (bullet) {
          return (
            <div key={i} style={{ fontSize: bodySize, color: "var(--color-text-secondary)", paddingLeft: "12px", lineHeight: 1.7, display: "flex", gap: "6px", marginBottom: "2px" }}>
              <span style={{ color: "var(--color-brand)", flexShrink: 0 }}>•</span>
              <span>{renderInline(bullet[1])}</span>
            </div>
          );
        }
        const numbered = trimmed.match(/^(\d+)\.\s+(.*)$/);
        if (numbered) {
          return (
            <div key={i} style={{ fontSize: bodySize, color: "var(--color-text-secondary)", paddingLeft: "8px", lineHeight: 1.7, display: "flex", gap: "6px", marginBottom: "2px" }}>
              <span style={{ color: "var(--color-brand)", flexShrink: 0, fontWeight: 600 }}>{numbered[1]}.</span>
              <span>{renderInline(numbered[2])}</span>
            </div>
          );
        }
        return <div key={i} style={{ fontSize: bodySize, color: "var(--color-text-primary)", lineHeight: 1.8 }}>{renderInline(trimmed)}</div>;
      })}
    </div>
  );
}
