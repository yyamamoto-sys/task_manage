// src/components/guide/GuideMarkdown.tsx
//
// アプリ内ガイド（docs/guides/**/*.md）専用の Markdown 描画部品。
// 構文解析は src/lib/docs/guideMarkdown.ts（純関数）が担い、ここは React 要素への変換だけを行う。
// MarkdownLite（AI返答用）とは独立しており、そちらは変更しない。

import { useMemo, type CSSProperties, type ReactNode } from "react";
import { getDocBySlug } from "../../lib/docs/manifest";
import { GUIDE_SVGS } from "../../lib/docs/guideAssets";
import {
  parseGuideMarkdown, resolveLink, resolveImage, sanitizeSvg,
  type Block, type Inline, type ListNode,
} from "../../lib/docs/guideMarkdown";

interface Props {
  text: string;
  /** 本文を持つ記事の path（"02_modes/okr/01_x.md"）。相対リンク・画像の基準 */
  currentPath: string;
  /** アプリ内リンクがクリックされたとき（解決済みの slug）。未指定ならリンクは文字だけ表示 */
  onNavigate?: (slug: string) => void;
}

const hasDoc = (slug: string) => !!getDocBySlug(slug);

// SVG をインライン描画するための最小の幅制御（親に合わせて縮む）
const SVG_CSS = ".guide-svg svg{max-width:100%;height:auto;display:block;margin:0 auto}";

const linkStyle: CSSProperties = { color: "var(--color-brand)", textDecoration: "underline", cursor: "pointer" };

function renderInlines(items: Inline[], ctx: Props, keyPrefix = ""): ReactNode[] {
  return items.map((it, i) => {
    const key = keyPrefix + i;
    if (it.t === "text") return <span key={key}>{it.v}</span>;
    if (it.t === "code") {
      return (
        <code key={key} style={{
          fontFamily: "var(--font-mono, monospace)", fontSize: "0.92em", padding: "1px 5px",
          background: "var(--color-bg-tertiary)", borderRadius: "var(--radius-sm)", color: "var(--color-text-primary)",
        }}>{it.v}</code>
      );
    }
    if (it.t === "bold") {
      return <strong key={key} style={{ fontWeight: 700, color: "var(--color-text-primary)" }}>{renderInlines(it.c, ctx, key + "-")}</strong>;
    }
    const target = resolveLink(it.href, ctx.currentPath, hasDoc);
    const children = renderInlines(it.c, ctx, key + "-");
    if (target.kind === "external") {
      return <a key={key} href={target.href} target="_blank" rel="noopener noreferrer" style={linkStyle}>{children}</a>;
    }
    if (target.kind === "doc" && ctx.onNavigate) {
      const slug = target.slug;
      return (
        <a key={key} href={"#" + slug} style={linkStyle}
          onClick={e => { e.preventDefault(); ctx.onNavigate?.(slug); }}>{children}</a>
      );
    }
    return <span key={key}>{children}</span>;
  });
}

function renderList(list: ListNode, ctx: Props, depth: number): ReactNode {
  const Tag = list.ordered ? "ol" : "ul";
  return (
    <Tag style={{
      margin: depth === 0 ? "4px 0 8px" : "2px 0", paddingLeft: "22px",
      fontSize: "13px", lineHeight: 1.8, color: "var(--color-text-secondary)",
    }}>
      {list.items.map((item, i) => (
        <li key={i} style={{ whiteSpace: "pre-line", marginBottom: "2px" }}>
          {renderInlines(item.c, ctx)}
          {item.children && renderList(item.children, ctx, depth + 1)}
        </li>
      ))}
    </Tag>
  );
}

function isWarningQuote(c: Inline[]): boolean {
  const first = c[0];
  if (!first || first.t !== "bold") return false;
  const label = first.c.map(x => (x.t === "text" || x.t === "code" ? x.v : "")).join("");
  return /^(注意|警告|重要)/.test(label);
}

function renderBlock(block: Block, i: number, ctx: Props): ReactNode {
  switch (block.t) {
    case "heading": {
      const style: CSSProperties = block.level === 1
        ? { fontSize: "17px", margin: "20px 0 8px" }
        : block.level === 2
          ? { fontSize: "15px", margin: "20px 0 8px", paddingBottom: "4px", borderBottom: "1px solid var(--color-border-primary)" }
          : { fontSize: "13.5px", margin: "14px 0 6px" };
      const Tag = (`h${block.level}`) as "h1" | "h2" | "h3";
      return <Tag key={i} style={{ ...style, fontWeight: 700, color: "var(--color-text-primary)" }}>{renderInlines(block.c, ctx)}</Tag>;
    }
    case "para":
      return (
        <p key={i} style={{ margin: "0 0 10px", fontSize: "13px", lineHeight: 1.8, color: "var(--color-text-primary)", whiteSpace: "pre-line" }}>
          {renderInlines(block.c, ctx)}
        </p>
      );
    case "list":
      return <div key={i}>{renderList(block.list, ctx, 0)}</div>;
    case "table":
      return (
        <div key={i} style={{ overflowX: "auto", margin: "6px 0 12px", maxWidth: "100%" }}>
          <table style={{ borderCollapse: "collapse", fontSize: "12.5px", lineHeight: 1.6 }}>
            <thead>
              <tr>
                {block.header.map((h, c) => (
                  <th key={c} style={{
                    textAlign: "left", padding: "6px 10px", background: "var(--color-bg-secondary)",
                    border: "1px solid var(--color-border-primary)", color: "var(--color-text-primary)", fontWeight: 700, whiteSpace: "nowrap",
                  }}>{renderInlines(h, ctx)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} style={{
                      padding: "6px 10px", border: "1px solid var(--color-border-primary)",
                      color: "var(--color-text-secondary)", verticalAlign: "top",
                    }}>{renderInlines(cell, ctx)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "quote": {
      const warn = isWarningQuote(block.c);
      return (
        <blockquote key={i} style={{
          margin: "8px 0 12px", padding: "8px 12px", fontSize: "13px", lineHeight: 1.8, whiteSpace: "pre-line",
          background: warn ? "var(--color-bg-warning)" : "var(--color-bg-info)",
          border: `1px solid ${warn ? "var(--color-border-warning)" : "var(--color-border-info)"}`,
          borderLeft: `4px solid ${warn ? "var(--color-text-warning)" : "var(--color-text-info)"}`,
          borderRadius: "var(--radius-sm)", color: "var(--color-text-primary)",
        }}>{renderInlines(block.c, ctx)}</blockquote>
      );
    }
    case "code":
      return (
        <pre key={i} style={{
          margin: "6px 0 12px", padding: "10px 12px", overflowX: "auto", fontSize: "12px", lineHeight: 1.6,
          background: "var(--color-bg-tertiary)", border: "1px solid var(--color-border-primary)",
          borderRadius: "var(--radius-sm)", color: "var(--color-text-primary)",
        }}><code>{block.v}</code></pre>
      );
    case "hr":
      return <hr key={i} style={{ border: "none", borderTop: "1px solid var(--color-border-primary)", margin: "16px 0" }} />;
    case "image": {
      const svg = resolveImage(block.src, ctx.currentPath, GUIDE_SVGS);
      if (svg === null) {
        return (
          <div key={i} role="img" aria-label={block.alt} style={{
            margin: "8px 0 12px", padding: "12px", textAlign: "center", fontSize: "12px",
            color: "var(--color-text-tertiary)", border: "1px dashed var(--color-border-secondary)", borderRadius: "var(--radius-sm)",
          }}>{block.alt || "（図）"}</div>
        );
      }
      return (
        <figure key={i} style={{ margin: "8px 0 12px", color: "var(--color-text-primary)" }}>
          <div className="guide-svg" role="img" aria-label={block.alt} dangerouslySetInnerHTML={{ __html: sanitizeSvg(svg) }} />
        </figure>
      );
    }
  }
}

export function GuideMarkdown({ text, currentPath, onNavigate }: Props) {
  const blocks = useMemo(() => parseGuideMarkdown(text), [text]);
  const ctx: Props = { text, currentPath, onNavigate };
  return (
    <div style={{ minWidth: 0, maxWidth: "100%" }}>
      <style>{SVG_CSS}</style>
      {blocks.map((b, i) => renderBlock(b, i, ctx))}
    </div>
  );
}
