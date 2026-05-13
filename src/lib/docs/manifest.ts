// src/lib/docs/manifest.ts
//
// 【設計意図】
// docs/guides/**/*.md をビルド時に丸ごと取り込み、frontmatter を簡易パースして
// アプリ内ガイドが使うマニフェストを構築する。`docs/` フォルダの MD を1箇所だけ編集
// すれば、アプリ側の「📖 ガイド」モードと各画面の `?` ボタンに即反映される。
//
// 依存追加なしで動かすため、YAMLは「フラットなキー: 値」と「配列リテラル [a, b]」のみを
// 扱う簡易パーサで実装。conventions.md の規格はそれで足りる範囲に意図的に絞っている。

import type { DocAudience, DocEntry, DocFrontmatter } from "./types";

// Vite: docs/guides/**/*.md を文字列として一括取り込み。プロジェクト直下からの相対パス。
const FILES = import.meta.glob("/docs/guides/**/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

// ===== frontmatter パーサ（最小） =====

function parseFrontmatter(raw: string): { fm: Record<string, unknown>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!m) return { fm: {}, body: raw };
  const fm: Record<string, unknown> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(t);
    if (!kv) continue;
    fm[kv[1]] = parseScalar(kv[2]);
  }
  return { fm, body: m[2] };
}

function parseScalar(v: string): unknown {
  const s = v.trim();
  if (s === "" || s === "~" || s === "null") return null;
  if (s === "true") return true;
  if (s === "false") return false;
  // 配列リテラル [a, b, "c"]
  if (s.startsWith("[") && s.endsWith("]")) {
    const inner = s.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map(x => unquote(x.trim()));
  }
  // 数値
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  // 文字列（引用符は剥がす）
  return unquote(s);
}

function unquote(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

// ===== マニフェスト構築（モジュール初期化時に1度） =====

const VALID_AUDIENCE: DocAudience[] = ["all", "member", "kr-rep", "facilitator", "admin", "maintainer"];

function toAudience(v: unknown): DocAudience[] {
  if (!Array.isArray(v)) return ["all"];
  const out: DocAudience[] = [];
  for (const x of v) {
    const s = String(x);
    if ((VALID_AUDIENCE as string[]).includes(s)) out.push(s as DocAudience);
  }
  return out.length ? out : ["all"];
}

function toStringArr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(x => String(x)).filter(Boolean);
}

function buildEntry(absPath: string, raw: string): DocEntry | null {
  // absPath 例: "/docs/guides/02_modes/okr/01_meeting-note.md"
  const prefix = "/docs/guides/";
  if (!absPath.startsWith(prefix)) return null;
  const rel = absPath.slice(prefix.length);
  const slug = rel.replace(/\.md$/i, "");
  const parts = slug.split("/");
  const section = parts.slice(0, -1);

  const { fm, body } = parseFrontmatter(raw);
  const title = typeof fm.title === "string" && fm.title.trim() ? fm.title.trim() : parts[parts.length - 1];
  const last_updated = typeof fm.last_updated === "string" ? fm.last_updated : "";
  const owner = typeof fm.owner === "string" ? fm.owner : "";

  const entry: DocEntry = {
    title,
    audience: toAudience(fm.audience),
    mode: typeof fm.mode === "string" ? fm.mode : undefined,
    order: typeof fm.order === "number" ? fm.order : undefined,
    last_updated,
    owner,
    related: toStringArr(fm.related),
    deprecated: fm.deprecated === true,
    path: rel,
    slug,
    body: body.trim(),
    section,
  } satisfies DocEntry & DocFrontmatter;

  return entry;
}

const ALL_ENTRIES: DocEntry[] = Object.entries(FILES)
  .map(([p, raw]) => buildEntry(p, raw))
  .filter((e): e is DocEntry => !!e)
  .sort((a, b) => {
    // セクション → order → slug
    const sa = a.section.join("/");
    const sb = b.section.join("/");
    if (sa !== sb) return sa.localeCompare(sb);
    const oa = a.order ?? 999;
    const ob = b.order ?? 999;
    if (oa !== ob) return oa - ob;
    return a.slug.localeCompare(b.slug);
  });

const BY_MODE = new Map<string, DocEntry>();
const BY_SLUG = new Map<string, DocEntry>();
for (const e of ALL_ENTRIES) {
  BY_SLUG.set(e.slug, e);
  if (e.mode) BY_MODE.set(e.mode, e);
}

// ===== 公開 API =====

export function listDocs(): DocEntry[] {
  return ALL_ENTRIES;
}

export function getDocByMode(modeKey: string): DocEntry | undefined {
  return BY_MODE.get(modeKey);
}

export function getDocBySlug(slug: string): DocEntry | undefined {
  return BY_SLUG.get(slug);
}

/** セクション（先頭ディレクトリ名）でグループ化したツリーを返す（サイドバー用）。 */
export function groupedDocs(): { section: string; entries: DocEntry[] }[] {
  const map = new Map<string, DocEntry[]>();
  for (const e of ALL_ENTRIES) {
    const key = e.section[0] ?? "";
    const arr = map.get(key) ?? [];
    arr.push(e);
    map.set(key, arr);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([section, entries]) => ({ section, entries }));
}
