// src/lib/docs/guideMarkdown.ts
//
// アプリ内ガイド（docs/guides/**/*.md）専用の Markdown パーサ（純関数）。
// 描画は src/components/guide/GuideMarkdown.tsx。外部ライブラリは使わない。
// AI返答用の MarkdownLite とは独立（そちらは変更しない）。

export type Inline =
  | { t: "text"; v: string }
  | { t: "code"; v: string }
  | { t: "bold"; c: Inline[] }
  | { t: "link"; href: string; c: Inline[] };

export interface ListItem { c: Inline[]; children: ListNode | null }
export interface ListNode { ordered: boolean; items: ListItem[] }

export type Block =
  | { t: "heading"; level: 1 | 2 | 3; c: Inline[] }
  | { t: "para"; c: Inline[] }
  | { t: "list"; list: ListNode }
  | { t: "table"; header: Inline[][]; rows: Inline[][][] }
  | { t: "quote"; c: Inline[] }
  | { t: "code"; lang: string; v: string }
  | { t: "hr" }
  | { t: "image"; alt: string; src: string };

// ===== インライン =====

const INLINE_RE = /`([^`]+)`|\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const re = new RegExp(INLINE_RE.source, "g");
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ t: "text", v: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ t: "code", v: m[1] });
    else if (m[2] !== undefined) out.push({ t: "bold", c: parseInline(m[2]) });
    else out.push({ t: "link", href: m[4], c: parseInline(m[3]) });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ t: "text", v: text.slice(last) });
  return out;
}

// ===== ブロック =====

const RE_HEADING = /^(#{1,3})\s+(.*)$/;
const RE_HR = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const RE_LIST = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
const RE_IMAGE = /^\s*!\[([^\]]*)\]\(([^)\s]+)\)\s*$/;
const RE_TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function splitCells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && s[i + 1] === "|") { cur += "|"; i++; continue; }
    if (s[i] === "|") { cells.push(cur.trim()); cur = ""; continue; }
    cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

function isTableStart(lines: string[], i: number): boolean {
  return lines[i].includes("|") && i + 1 < lines.length && lines[i + 1].includes("-") && RE_TABLE_SEP.test(lines[i + 1]);
}

function isBlockStart(lines: string[], i: number): boolean {
  const l = lines[i];
  return (
    /^\s*```/.test(l) || RE_HEADING.test(l) || RE_HR.test(l) || RE_LIST.test(l) ||
    /^\s*>/.test(l) || RE_IMAGE.test(l) || isTableStart(lines, i)
  );
}

export function parseGuideMarkdown(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const fence = /^\s*```(.*)$/.exec(line);
    if (fence) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) buf.push(lines[i++]);
      i++; // 閉じフェンス（無くても落とさない）
      blocks.push({ t: "code", lang: fence[1].trim(), v: buf.join("\n") });
      continue;
    }

    const h = RE_HEADING.exec(line);
    if (h) {
      blocks.push({ t: "heading", level: h[1].length as 1 | 2 | 3, c: parseInline(h[2].trim()) });
      i++;
      continue;
    }

    if (RE_HR.test(line) && !RE_LIST.test(line)) { blocks.push({ t: "hr" }); i++; continue; }

    const img = RE_IMAGE.exec(line);
    if (img) { blocks.push({ t: "image", alt: img[1], src: img[2] }); i++; continue; }

    if (isTableStart(lines, i)) {
      const header = splitCells(lines[i]).map(parseInline);
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) {
        rows.push(splitCells(lines[i]).map(parseInline));
        i++;
      }
      blocks.push({ t: "table", header, rows });
      continue;
    }

    if (/^\s*>/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push({ t: "quote", c: parseInline(buf.join("\n").trim()) });
      continue;
    }

    if (RE_LIST.test(line)) {
      const root: ListNode = { ordered: /^\s*\d+\./.test(line), items: [] };
      let child: ListNode | null = null;
      let last: ListItem | null = null;
      while (i < lines.length) {
        const m = RE_LIST.exec(lines[i]);
        if (m) {
          const indent = m[1].replace(/\t/g, "  ").length;
          const item: ListItem = { c: parseInline(m[3]), children: null };
          if (indent >= 2 && last) {
            if (!last.children) last.children = { ordered: /\d/.test(m[2]), items: [] };
            child = last.children;
            child.items.push(item);
          } else {
            root.items.push(item);
            last = item;
            child = null;
          }
          i++;
          continue;
        }
        // 字下げされた継続行は直前の項目に連結する
        if (lines[i].trim() && /^\s{2,}\S/.test(lines[i]) && (child ?? last)) {
          const target: ListItem = child ? child.items[child.items.length - 1] : last!;
          target.c = [...target.c, ...parseInline("\n" + lines[i].trim())];
          i++;
          continue;
        }
        break;
      }
      blocks.push({ t: "list", list: root });
      continue;
    }

    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && (buf.length === 0 || !isBlockStart(lines, i))) {
      buf.push(lines[i++].trim());
    }
    blocks.push({ t: "para", c: parseInline(buf.join("\n")) });
  }
  return blocks;
}

// ===== リンク・画像の解決 =====

/** currentPath（"02_modes/okr/01_x.md"）のディレクトリから相対パスを解決する。ガイドルートより上へ出る場合は null */
export function resolveRelative(currentPath: string, rel: string): string | null {
  const stack = currentPath.split("/").slice(0, -1);
  for (const seg of rel.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (stack.length === 0) return null;
      stack.pop();
    } else stack.push(seg);
  }
  return stack.join("/");
}

export type LinkTarget =
  | { kind: "external"; href: string }
  | { kind: "doc"; slug: string }
  | { kind: "none" };

export function resolveLink(href: string, currentPath: string, hasDoc: (slug: string) => boolean): LinkTarget {
  if (/^https?:\/\//i.test(href)) return { kind: "external", href };
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) return { kind: "none" };
  const pathPart = href.split("#")[0].split("?")[0];
  if (!/\.md$/i.test(pathPart)) return { kind: "none" };
  const resolved = resolveRelative(currentPath, pathPart);
  if (resolved === null) return { kind: "none" };
  const slug = resolved.replace(/\.md$/i, "");
  return hasDoc(slug) ? { kind: "doc", slug } : { kind: "none" };
}

/** 画像の相対パスから SVG ソースを引く。見つからなければ null */
export function resolveImage(src: string, currentPath: string, svgs: Record<string, string>): string | null {
  if (!/\.svg$/i.test(src.split("#")[0].split("?")[0])) return null;
  const resolved = resolveRelative(currentPath, src.split("#")[0].split("?")[0]);
  if (resolved === null) return null;
  return svgs["/docs/guides/" + resolved] ?? null;
}

// ===== SVG サニタイズ =====

/** <script>・<foreignObject>・on* 属性・外部参照（# 以外の href）・外部 URL の CSS 参照を除去する */
export function sanitizeSvg(src: string): string {
  let s = src;
  s = s.replace(/<\?[\s\S]*?\?>/g, "").replace(/<!DOCTYPE[\s\S]*?>/gi, "").replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<script\b[\s\S]*?<\/script\s*>/gi, "").replace(/<script\b[^>]*\/>/gi, "").replace(/<\/?script\b[^>]*>/gi, "");
  s = s.replace(/<foreignObject\b[\s\S]*?<\/foreignObject\s*>/gi, "").replace(/<\/?foreignObject\b[^>]*>/gi, "");
  s = s.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  s = s.replace(/\s+(?:xlink:)?href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi, (all, _v, a, b, c) => {
    const v = (a ?? b ?? c ?? "").trim();
    return v.startsWith("#") ? all : "";
  });
  s = s.replace(/@import[^;}]*;?/gi, "");
  s = s.replace(/url\(\s*(['"]?)\s*(?:https?:)?\/\/[^)]*\)/gi, "none");
  s = s.replace(/javascript:/gi, "");
  return s.trim();
}
