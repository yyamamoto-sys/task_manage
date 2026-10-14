import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildGuideHtml, selectGuideSet, guideExportFileName, escapeHtml, markdownToHtml,
  LIGHT_THEME_VARS, docAnchorId, ARCHITECTURE_SLUG, SPEC_SLUG,
} from "../guideHtmlExport";
import { listDocs } from "../manifest";
import { GUIDE_SVGS } from "../guideAssets";
import { APP_VERSION } from "../../version";
import type { DocEntry } from "../types";

function entry(over: Partial<DocEntry> & { slug: string }): DocEntry {
  return {
    title: over.slug, audience: ["all"], last_updated: "2026-10-01", owner: "x",
    path: over.slug + ".md", body: "本文", section: [], ...over,
  } as DocEntry;
}

const NOW = new Date(2026, 9, 14, 9, 5);
const A = entry({ slug: "00_overview", title: "全体像", last_updated: "2026-10-02", body: "# 全体像\n\n本文A" });
const B = entry({ slug: "02_modes/tasks", title: "タスク", last_updated: "2026-10-03", body: "[全体像へ](../00_overview.md) と [未収録](../03_roles/admin.md)" });
const ADMIN_ONLY = entry({ slug: "05_admin/x", title: "管理者作業", audience: ["admin"] });
const ARCHIVED = entry({ slug: "old", archived: true });
const SPEC = entry({ slug: SPEC_SLUG, title: "機能仕様書", last_updated: "2026-10-14" });
const ARCH = entry({ slug: ARCHITECTURE_SLUG, title: "システム構成", audience: ["admin"], last_updated: "2026-10-14" });
const ALL = [A, B, ADMIN_ONLY, ARCHIVED, SPEC, ARCH];

describe("selectGuideSet", () => {
  it("マニュアル一式：all を含み archived でなく、機能仕様・システム構成を除く（並び順は維持）", () => {
    expect(selectGuideSet("manual", ALL, true).map(e => e.slug)).toEqual(["00_overview", "02_modes/tasks"]);
    expect(selectGuideSet("manual", ALL, false).map(e => e.slug)).toEqual(["00_overview", "02_modes/tasks"]);
  });
  it("機能仕様：誰でも", () => {
    expect(selectGuideSet("spec", ALL, false).map(e => e.slug)).toEqual([SPEC_SLUG]);
  });
  it("システム構成：管理者のみ", () => {
    expect(selectGuideSet("architecture", ALL, true).map(e => e.slug)).toEqual([ARCHITECTURE_SLUG]);
    expect(selectGuideSet("architecture", ALL, false)).toEqual([]);
  });
});

describe("ファイル名", () => {
  it("種別_内容_版_YYYYMMDD.html", () => {
    expect(guideExportFileName("manual", NOW, "3.142")).toBe("手順案内_計画管理アプリ_マニュアル一式_v3.142_20261014.html");
    expect(guideExportFileName("spec", NOW, "3.142")).toBe("設計仕様_計画管理アプリ_機能仕様_v3.142_20261014.html");
    expect(guideExportFileName("architecture", NOW, "3.142")).toBe("設計仕様_計画管理アプリ_システム構成_v3.142_20261014.html");
  });
  it("版は APP_VERSION から組み立てる", () => {
    expect(guideExportFileName("spec", NOW)).toContain(`_v${APP_VERSION}_`);
  });
});

describe("buildGuideHtml：版・日時・最終更新日", () => {
  const html = buildGuideHtml({ kind: "manual", entries: [A, B], now: NOW, svgs: {}, version: "3.142" });
  it("冒頭と各記事に版・出力日時・最終更新日、フッターに版と日時", () => {
    expect(html).toContain("アプリの版：v3.142");
    expect(html).toContain("出力日時：2026-10-14 09:05");
    expect(html).toContain("最終更新：2026-10-02");
    expect(html).toContain("最終更新：2026-10-03");
    expect(html).toMatch(/class="print-footer">[^<]*v3\.142[^<]*2026-10-14 09:05/);
  });
  it("マニュアル一式は冒頭に目次（記事名と最終更新日・アンカー）", () => {
    expect(html).toContain(`<a href="#${docAnchorId("00_overview")}">全体像</a><span class="upd">最終更新 2026-10-02</span>`);
  });
  it("機能仕様には目次を付けない", () => {
    expect(buildGuideHtml({ kind: "spec", entries: [SPEC], now: NOW, svgs: {} })).not.toContain('class="toc"');
  });
  it("記事ごとに改ページ・本文先頭の同名h1は重複させない", () => {
    expect(html).toContain('class="doc"');
    expect(html).toContain("page-break-before:always");
    expect((html.match(/<h1>全体像<\/h1>/g) ?? []).length).toBe(1);
  });
});

describe("エスケープ（XSS）", () => {
  const evil = entry({
    slug: "evil", title: '<script>alert(1)</script>"&',
    body: [
      "<img src=x onerror=alert(1)> **<b>太字</b>** `<i>code</i>`",
      "[クリック](javascript:alert(1)) [外部](https://example.com/?a=1&b=\"2\")",
      "| <h> | b |", "|---|---|", "| <s>x</s> | `<y>` |",
      "> <u>引用</u>", "```", "<script>x</script>", "```", "- <li>項目",
    ].join("\n"),
  });
  const html = buildGuideHtml({ kind: "manual", entries: [evil], now: NOW, svgs: {} });
  it("タイトル・本文・表・引用・コードの生タグは出ない", () => {
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>x");
    expect(html).not.toContain("<b>太字");
    expect(html).not.toContain("<s>x");
    expect(html).not.toContain("<u>引用");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;&quot;&amp;");
  });
  it("javascript: のリンクは文字だけ・外部リンクは属性をエスケープして rel 付き", () => {
    expect(html).not.toContain("javascript:");
    expect(html).toContain('href="https://example.com/?a=1&amp;b=&quot;2&quot;" target="_blank" rel="noopener noreferrer"');
  });
  it("escapeHtml", () => {
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });
});

describe("SVG", () => {
  const svgs = {
    "/docs/guides/_img/a.svg":
      '<svg viewBox="0 0 10 10"><script>alert(1)</script><rect onclick="x()" fill="var(--color-brand)"/><a href="https://evil.example">x</a></svg>',
  };
  const e = entry({ slug: "d", path: "d.md", body: "![図](_img/a.svg)\n\n![無い](_img/none.svg)" });
  const html = buildGuideHtml({ kind: "spec", entries: [e], now: NOW, svgs });
  it("サニタイズを通してインライン埋め込み・欠けた図は代替表示", () => {
    expect(html).toContain('<figure class="guide-svg" role="img" aria-label="図"><svg');
    expect(html).not.toContain("alert(1)");
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("evil.example");
    expect(html).toContain('class="img-missing"');
  });
  it("CSS 変数を :root に定義する", () => {
    expect(html).toContain(":root{--color-bg-primary:#fbfaf7;");
  });
});

describe("相対リンクのアンカー化", () => {
  it("収録記事はページ内アンカー、未収録は文字だけ", () => {
    const html = buildGuideHtml({ kind: "manual", entries: [A, B], now: NOW, svgs: {} });
    expect(html).toContain(`<a href="#${docAnchorId("00_overview")}">全体像へ</a>`);
    expect(html).toContain("未収録");
    expect(html).not.toContain("03_roles");
  });
  it("収録されていない記事へのリンクは単体セットでは文字だけ", () => {
    const html = markdownToHtml("[x](./y.md)", "t", { currentPath: "a.md", includedSlugs: new Set(), svgs: {} });
    expect(html).toBe("<p>x</p>");
  });
});

describe("外部参照が無い単一ファイル", () => {
  it("src= / <link / <script / url(http / @import / <img が無い（実記事で確認）", () => {
    const docs = listDocs();
    for (const kind of ["manual", "spec", "architecture"] as const) {
      const es = selectGuideSet(kind, docs, true);
      const html = buildGuideHtml({ kind, entries: es, now: NOW, svgs: GUIDE_SVGS });
      expect(html).not.toMatch(/\ssrc\s*=/i);
      expect(html).not.toMatch(/<link\b/i);
      expect(html).not.toMatch(/<script\b/i);
      expect(html).not.toMatch(/<img\b/i);
      expect(html).not.toMatch(/@import/i);
      expect(html).not.toMatch(/url\(\s*['"]?(https?:)?\/\//i);
      expect(html).not.toMatch(/\son[a-z]+\s*=/i);
    }
  });
  it("実記事：マニュアル一式は機能仕様・システム構成を含まない", () => {
    const slugs = selectGuideSet("manual", listDocs(), true).map(e => e.slug);
    expect(slugs).not.toContain(SPEC_SLUG);
    expect(slugs).not.toContain(ARCHITECTURE_SLUG);
    expect(slugs.length).toBeGreaterThan(5);
  });
});

describe("ライトテーマの値と globals.css の一致", () => {
  const css = readFileSync(resolve(__dirname, "../../../styles/globals.css"), "utf-8");
  const firstRoot = /:root\s*\{([\s\S]*?)\n\}/.exec(css)![1];
  it.each(Object.entries(LIGHT_THEME_VARS))("%s", (name, value) => {
    const m = new RegExp(name.replace(/[-]/g, "\\-") + "\\s*:\\s*([^;]+);").exec(firstRoot);
    expect(m, `${name} が globals.css の最初の :root に無い`).not.toBeNull();
    expect(m![1].trim().toLowerCase()).toBe(value.toLowerCase());
  });
  it("図解 SVG が参照する var(--color-*) は全て定義済み", () => {
    const used = new Set<string>();
    for (const svg of Object.values(GUIDE_SVGS)) for (const m of svg.matchAll(/var\((--[a-z0-9-]+)/g)) used.add(m[1]);
    for (const name of used) expect(LIGHT_THEME_VARS, name).toHaveProperty(name);
  });
});
