// src/lib/docs/guideHtmlExport.ts
//
// 【設計意図】
// ガイドの記事を「版つきの単一HTMLファイル」にしてブラウザ内で保存するための純関数群。
// サーバー・public/ には何も置かない（public/ は未ログインで公開されるため）。
//
// 静的HTMLの組み方：renderToStaticMarkup は使わず、guideMarkdown.ts の解析結果（Block/Inline）から
// HTML 文字列を直接組む。理由：①GuideMarkdown.tsx は色・余白を `style={{...var(--color-*)}}` で直書きしており、
// そのまま出すと全要素にインライン style が付いて印刷用の調整（改ページ・A4）が効かない。
// ②リンクは「まとめた HTML 内のページ内アンカー」へ変換する必要があり、React の onNavigate 前提の
// 実装とは出し方が違う。③React/DOM を要さない純関数なのでエスケープ・リンク変換を単体テストしやすい。
// 解析（parseGuideMarkdown）・リンク解決（resolveLink）・SVG の除毒（sanitizeSvg）は GuideMarkdown と同じ関数を使う。

import { APP_VERSION } from "../version";
import {
  parseGuideMarkdown, resolveLink, resolveImage, sanitizeSvg,
  type Block, type Inline, type ListNode,
} from "./guideMarkdown";
import type { DocEntry } from "./types";
import { canViewGuideDoc } from "./guideAccess";

// ===== 資料セット =====

export type GuideSetKind = "manual" | "spec" | "architecture";

export const SPEC_SLUG = "08_spec";
export const ARCHITECTURE_SLUG = "09_architecture";

export const GUIDE_SET_LABELS: Record<GuideSetKind, string> = {
  manual: "マニュアル一式",
  spec: "機能仕様",
  architecture: "システム構成",
};

const FILE_PREFIX: Record<GuideSetKind, string> = {
  manual: "手順案内",
  spec: "設計仕様",
  architecture: "設計仕様",
};

/**
 * セットに含める記事を選ぶ。entries はガイドの目次と同じ並び（groupedDocs の平坦化）で渡すこと。
 * システム構成は管理者だけ（isAdmin が偽なら空）。マニュアル一式は閲覧者によらず同じ（一般向け記事一式）。archived は manifest 側で既に除外されているが念のため落とす。
 */
export function selectGuideSet(kind: GuideSetKind, entries: DocEntry[], isAdmin: boolean): DocEntry[] {
  const live = entries.filter(e => !e.archived && canViewGuideDoc(e, { isAdmin }));
  if (kind === "spec") return live.filter(e => e.slug === SPEC_SLUG);
  if (kind === "architecture") return isAdmin ? live.filter(e => e.slug === ARCHITECTURE_SLUG) : [];
  // マニュアル一式は一般向け記事一式。管理者が出しても管理者向け記事（admin・maintainer だけの記事）は入れない
  return entries.filter(e => !e.archived && canViewGuideDoc(e, { isAdmin: false }) && e.slug !== SPEC_SLUG && e.slug !== ARCHITECTURE_SLUG);
}

// ===== 版・日時・ファイル名 =====

const pad = (n: number) => String(n).padStart(2, "0");

export function formatYmd(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

export function formatDateTime(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 社内命名規則「種別_内容_YYYYMMDD.拡張子」＋版。例：手順案内_業務管理アプリ_マニュアル一式_v3.142_20261014.html */
export function guideExportFileName(kind: GuideSetKind, now: Date, version: string = APP_VERSION): string {
  return `${FILE_PREFIX[kind]}_業務管理アプリ_${GUIDE_SET_LABELS[kind]}_v${version}_${formatYmd(now)}.html`;
}

// ===== ライトテーマの配色（CSS 変数はダウンロードした HTML では未定義になるため値を直接持つ） =====

/**
 * src/styles/globals.css の最初の :root（ライトテーマ）の値の写し。
 * 食い違いは src/lib/docs/__tests__/guideHtmlExport.test.ts が globals.css を読んで検出する。
 * 図解 SVG が参照する var(--color-*) はすべてここに無ければならない（これもテストで検査）。
 */
export const LIGHT_THEME_VARS: Record<string, string> = {
  "--color-bg-primary": "#fbfaf7",
  "--color-bg-secondary": "#f4f2ec",
  "--color-bg-tertiary": "#ebe8e0",
  "--color-bg-info": "#ecf0f9",
  "--color-bg-success": "#eef5ec",
  "--color-bg-warning": "#faf5e2",
  "--color-bg-danger": "#f7eae7",
  "--color-bg-purple": "#f0eef8",
  "--color-text-primary": "#221f1a",
  "--color-text-secondary": "#56524a",
  "--color-text-tertiary": "#6e6860",
  "--color-text-info": "#2c4f8f",
  "--color-text-success": "#2f6b3c",
  "--color-text-warning": "#8a5d10",
  "--color-text-danger": "#a54338",
  "--color-text-purple": "#4d4690",
  "--color-border-primary": "#e3ddcf",
  "--color-border-secondary": "#c7c0ad",
  "--color-border-info": "#a9b9d8",
  "--color-border-success": "#aac4a4",
  "--color-border-warning": "#e2cc88",
  "--color-border-danger": "#d8aaa3",
  "--color-border-purple": "#b4adcc",
  "--color-brand": "#3d4f8a",
  "--color-brand-light": "#e7eaf3",
  "--color-brand-border": "#8993b8",
};

// ===== エスケープ =====

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// ===== Markdown → HTML 文字列 =====

interface Ctx {
  currentPath: string;
  /** まとめた HTML に含まれる記事の slug */
  includedSlugs: Set<string>;
  svgs: Record<string, string>;
  /** slug → (見出しの断片 → 見出しの id)。`foo.md#見出し` をその見出しへのアンカーにするために使う */
  headingIds?: Map<string, Map<string, string>>;
}

/**
 * 記事の id。単射にしてある（"a/b" と "a-b" が衝突しない）：英数字・_・- 以外は `.16進コード.` に符号化し、
 * "." は符号化にしか現れない。見出し id との区切りには "~"（符号化で必ず消える文字）を使う。
 */
export function docAnchorId(slug: string): string {
  let out = "doc-";
  for (const ch of slug) {
    out += /[A-Za-z0-9_-]/.test(ch) ? ch : `.${ch.codePointAt(0)!.toString(16)}.`;
  }
  return out;
}

/** 見出し文字列→リンクの断片。アプリ内の見出しには id 規則が無いため、小文字化・空白を - に・記号を除去（文字と数字は日本語も残す） */
export function headingFragment(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^\p{L}\p{N}_-]/gu, "");
}

/** 見出しブロックの id（出現順）。同じ見出しが重なれば -2, -3 を付けて記事内で一意にする */
export function computeHeadingIds(slug: string, blocks: Block[]): string[] {
  const used = new Map<string, number>();
  const ids: string[] = [];
  for (const b of blocks) {
    if (b.t !== "heading") continue;
    const frag = headingFragment(plainText(b.c)) || "h";
    const n = (used.get(frag) ?? 0) + 1;
    used.set(frag, n);
    ids.push(`${docAnchorId(slug)}~${n === 1 ? frag : `${frag}-${n}`}`);
  }
  return ids;
}

function slugOfPath(path: string): string {
  return path.replace(/\.md$/i, "");
}

function plainText(items: Inline[]): string {
  return items.map(x => (x.t === "text" || x.t === "code" ? x.v : plainText(x.c))).join("");
}

function inlinesHtml(items: Inline[], ctx: Ctx): string {
  return items.map(it => {
    if (it.t === "text") return escapeHtml(it.v);
    if (it.t === "code") return `<code>${escapeHtml(it.v)}</code>`;
    if (it.t === "bold") return `<strong>${inlinesHtml(it.c, ctx)}</strong>`;
    const children = inlinesHtml(it.c, ctx);
    const target = resolveLink(it.href, ctx.currentPath, slug => ctx.includedSlugs.has(slug));
    if (target.kind === "external") {
      return `<a href="${escapeHtml(target.href)}" target="_blank" rel="noopener noreferrer">${children}</a>`;
    }
    if (target.kind === "doc") {
      const hash = it.href.split("#")[1];
      let frag = "";
      if (hash) { try { frag = headingFragment(decodeURIComponent(hash)); } catch { frag = headingFragment(hash); } }
      const headingId = frag ? ctx.headingIds?.get(target.slug)?.get(frag) : undefined;
      return `<a href="#${headingId ?? docAnchorId(target.slug)}">${children}</a>`;
    }
    return children;
  }).join("");
}

function listHtml(list: ListNode, ctx: Ctx): string {
  const tag = list.ordered ? "ol" : "ul";
  const items = list.items.map(item =>
    `<li>${inlinesHtml(item.c, ctx)}${item.children ? listHtml(item.children, ctx) : ""}</li>`).join("");
  return `<${tag}>${items}</${tag}>`;
}

function isWarningQuote(c: Inline[]): boolean {
  const first = c[0];
  if (!first || first.t !== "bold") return false;
  return /^(注意|警告|重要)/.test(plainText(first.c));
}

function blockHtml(block: Block, ctx: Ctx, headingId?: string): string {
  switch (block.t) {
    case "heading": {
      // 記事タイトルが h1 を使うため、本文の見出しは 1 段下げる（# → h2 相当、### は h4）
      const level = block.level + 1;
      return `<h${level}${headingId ? ` id="${escapeHtml(headingId)}"` : ""}>${inlinesHtml(block.c, ctx)}</h${level}>`;
    }
    case "para": return `<p>${inlinesHtml(block.c, ctx)}</p>`;
    case "list": return listHtml(block.list, ctx);
    case "table": {
      const head = block.header.map(h => `<th>${inlinesHtml(h, ctx)}</th>`).join("");
      const rows = block.rows.map(r => `<tr>${r.map(c => `<td>${inlinesHtml(c, ctx)}</td>`).join("")}</tr>`).join("");
      return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
    }
    case "quote": return `<blockquote class="${isWarningQuote(block.c) ? "warn" : "info"}">${inlinesHtml(block.c, ctx)}</blockquote>`;
    case "code": return `<pre><code>${escapeHtml(block.v)}</code></pre>`;
    case "hr": return "<hr>";
    case "image": {
      const svg = resolveImage(block.src, ctx.currentPath, ctx.svgs);
      if (svg === null) return `<div class="img-missing" role="img" aria-label="${escapeHtml(block.alt)}">${escapeHtml(block.alt || "（図）")}</div>`;
      return `<figure class="guide-svg" role="img" aria-label="${escapeHtml(block.alt)}">${sanitizeSvg(svg)}</figure>`;
    }
  }
}

/** 本文の HTML。先頭が記事タイトルと同じ h1 なら（見出しに既に出すため）落とす */
export function markdownToHtml(body: string, title: string, ctx: Ctx): string {
  const all = parseGuideMarkdown(body);
  const ids = computeHeadingIds(slugOfPath(ctx.currentPath), all);
  const idOf = new Map<Block, string>();
  let hi = 0;
  for (const b of all) if (b.t === "heading") idOf.set(b, ids[hi++]);
  let blocks = all;
  const first = blocks[0];
  if (first && first.t === "heading" && first.level === 1 && plainText(first.c).trim() === title.trim()) blocks = blocks.slice(1);
  return blocks.map(b => blockHtml(b, ctx, idOf.get(b))).join("\n");
}

// ===== 文書全体 =====

const STYLE = `
:root{${Object.entries(LIGHT_THEME_VARS).map(([k, v]) => `${k}:${v}`).join(";")}}
@page{size:A4;margin:16mm 14mm 20mm}
*{box-sizing:border-box}
body{margin:0;background:var(--color-bg-primary);color:var(--color-text-primary);font-family:"Hiragino Sans","Hiragino Kaku Gothic ProN","Meiryo UI","Meiryo","Yu Gothic UI","Yu Gothic",sans-serif;font-size:13px;line-height:1.8}
main{max-width:820px;margin:0 auto;padding:24px 28px}
h1{font-size:22px;margin:0 0 6px}
h2{font-size:16px;margin:22px 0 8px;padding-bottom:4px;border-bottom:1px solid var(--color-border-primary)}
h3{font-size:14px;margin:16px 0 6px}
h4,h5{font-size:13px;margin:12px 0 4px}
p{margin:0 0 10px;white-space:pre-line}
ul,ol{margin:4px 0 8px;padding-left:22px;color:var(--color-text-secondary)}
li{white-space:pre-line;margin-bottom:2px}
a{color:var(--color-brand);text-decoration:underline}
code{font-family:Consolas,"Courier New",monospace;font-size:.92em;padding:1px 5px;background:var(--color-bg-tertiary);border-radius:6px}
pre{margin:6px 0 12px;padding:10px 12px;overflow-x:auto;font-size:12px;line-height:1.6;background:var(--color-bg-tertiary);border:1px solid var(--color-border-primary);border-radius:6px;white-space:pre-wrap;word-break:break-all}
pre code{padding:0;background:none}
hr{border:none;border-top:1px solid var(--color-border-primary);margin:16px 0}
.table-wrap{margin:6px 0 12px}
table{border-collapse:collapse;font-size:12px;line-height:1.6;width:100%}
th{text-align:left;padding:6px 10px;background:var(--color-bg-secondary);border:1px solid var(--color-border-primary);font-weight:700}
td{padding:6px 10px;border:1px solid var(--color-border-primary);color:var(--color-text-secondary);vertical-align:top}
tr,figure,blockquote{break-inside:avoid;page-break-inside:avoid}
blockquote{margin:8px 0 12px;padding:8px 12px;white-space:pre-line;border-radius:6px}
blockquote.info{background:var(--color-bg-info);border:1px solid var(--color-border-info);border-left:4px solid var(--color-text-info)}
blockquote.warn{background:var(--color-bg-warning);border:1px solid var(--color-border-warning);border-left:4px solid var(--color-text-warning)}
figure{margin:8px 0 12px}
.guide-svg svg{max-width:100%;height:auto;display:block;margin:0 auto}
.img-missing{margin:8px 0 12px;padding:12px;text-align:center;font-size:12px;color:var(--color-text-tertiary);border:1px dashed var(--color-border-secondary);border-radius:6px}
.cover{padding:40px 0 24px}
.cover h1{font-size:26px}
.meta{font-size:12px;color:var(--color-text-secondary)}
.meta span{display:inline-block;margin-right:14px}
.toc{margin:24px 0 0;padding-left:22px;color:var(--color-text-primary)}
.toc li{margin-bottom:4px}
.toc .upd{color:var(--color-text-tertiary);font-size:12px;margin-left:8px}
.doc{page-break-before:always;break-before:page}
.doc-head{margin-bottom:16px;padding-bottom:10px;border-bottom:2px solid var(--color-border-secondary)}
.tag-old{color:var(--color-text-danger);font-size:12px;margin-left:8px}
.print-footer{margin-top:40px;padding-top:8px;border-top:1px solid var(--color-border-primary);font-size:10px;color:var(--color-text-tertiary);text-align:center}
@media print{
body{background:#fff;font-size:11.5px}
main{max-width:none;padding:0}
.print-footer{position:fixed;left:0;right:0;bottom:-14mm;margin:0;border-top:none}
a{color:inherit}
}
`.trim();

export interface BuildGuideHtmlOptions {
  kind: GuideSetKind;
  entries: DocEntry[];
  now: Date;
  svgs: Record<string, string>;
  version?: string;
}

export function buildGuideHtml({ kind, entries, now, svgs, version = APP_VERSION }: BuildGuideHtmlOptions): string {
  const setLabel = GUIDE_SET_LABELS[kind];
  const stamp = formatDateTime(now);
  const verLabel = `v${version}`;
  const docTitle = `業務管理アプリ ${setLabel}（${verLabel}）`;
  const includedSlugs = new Set(entries.map(e => e.slug));
  const headingIds = new Map<string, Map<string, string>>();
  for (const e of entries) {
    const blocks = parseGuideMarkdown(e.body);
    const ids = computeHeadingIds(e.slug, blocks);
    const byFrag = new Map<string, string>();
    let hi = 0;
    for (const b of blocks) {
      if (b.t !== "heading") continue;
      const id = ids[hi++];
      const frag = headingFragment(plainText(b.c)) || "h";
      if (!byFrag.has(frag)) byFrag.set(frag, id);
    }
    headingIds.set(e.slug, byFrag);
  }

  const toc = kind === "manual"
    ? `<ol class="toc">${entries.map(e =>
      `<li><a href="#${docAnchorId(e.slug)}">${escapeHtml(e.title)}</a><span class="upd">最終更新 ${escapeHtml(e.last_updated || "—")}</span></li>`).join("")}</ol>`
    : "";

  const cover = `<section class="cover">
<h1>業務管理アプリ ${escapeHtml(setLabel)}</h1>
<div class="meta"><span>アプリの版：${escapeHtml(verLabel)}</span><span>出力日時：${escapeHtml(stamp)}</span><span>収録記事数：${entries.length}</span></div>
${toc}
</section>`;

  const docs = entries.map(e => {
    const ctx: Ctx = { currentPath: e.path, includedSlugs, svgs, headingIds };
    return `<article class="doc" id="${docAnchorId(e.slug)}">
<header class="doc-head"><h1>${escapeHtml(e.title)}${e.deprecated ? '<span class="tag-old">⚠ 旧仕様</span>' : ""}</h1>
<div class="meta"><span>最終更新：${escapeHtml(e.last_updated || "—")}</span><span>アプリの版：${escapeHtml(verLabel)}</span><span>出力日時：${escapeHtml(stamp)}</span></div></header>
${markdownToHtml(e.body, e.title, ctx)}
</article>`;
  }).join("\n");

  const footer = `<div class="print-footer">業務管理アプリ ${escapeHtml(setLabel)} ｜ アプリの版 ${escapeHtml(verLabel)} ｜ 出力 ${escapeHtml(stamp)}</div>`;

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(docTitle)}</title>
<style>
${STYLE}
</style>
</head>
<body>
<main>
${cover}
${docs}
</main>
${footer}
</body>
</html>
`;
}

/** ブラウザ内で Blob を作ってダウンロードさせる（サーバーには何も送らない） */
export function downloadGuideHtml(kind: GuideSetKind, entries: DocEntry[], svgs: Record<string, string>, now: Date = new Date()): void {
  const html = buildGuideHtml({ kind, entries, now, svgs });
  const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = guideExportFileName(kind, now);
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 保存ダイアログ・ブラウザの処理が終わる前に URL を失効させないよう、長めに待つ
  setTimeout(() => URL.revokeObjectURL(url), 40000);
}

/** iframe 内（Teams のタブなど）で開いているか。そこではダウンロードが塞がれることがある（成否は検出できないので事前に注記する） */
export function isEmbeddedInFrame(): boolean {
  try {
    return typeof window !== "undefined" && window.self !== window.top;
  } catch {
    return true;
  }
}
