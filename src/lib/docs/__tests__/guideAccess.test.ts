import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { canViewGuideDoc, isAdminOnlyDoc, filterViewableDocs, isGuideAdmin } from "../guideAccess";
import { listDocs, groupedDocs, getDocBySlug } from "../manifest";
import { resolveLink } from "../guideMarkdown";
import { selectGuideSet } from "../guideHtmlExport";
import type { DocAudience } from "../types";

const d = (audience: DocAudience[]) => ({ audience });

describe("canViewGuideDoc", () => {
  it("admin だけの記事は管理者のみ", () => {
    expect(canViewGuideDoc(d(["admin"]), { isAdmin: false })).toBe(false);
    expect(canViewGuideDoc(d(["admin"]), { isAdmin: true })).toBe(true);
  });
  it("all・非管理者向けラベルを含めば全員", () => {
    expect(canViewGuideDoc(d(["all"]), { isAdmin: false })).toBe(true);
    expect(canViewGuideDoc(d(["admin", "all"]), { isAdmin: false })).toBe(true);
    expect(canViewGuideDoc(d(["kr-rep"]), { isAdmin: false })).toBe(true);
    expect(canViewGuideDoc(d(["maintainer", "member"]), { isAdmin: false })).toBe(true);
  });
  it("audience 未指定・空は全員、記事なしは不可", () => {
    expect(canViewGuideDoc({ audience: undefined as unknown as DocAudience[] }, { isAdmin: false })).toBe(true);
    expect(canViewGuideDoc(d([]), { isAdmin: false })).toBe(true);
    expect(canViewGuideDoc(undefined, { isAdmin: true })).toBe(false);
  });
  it("admin・maintainer だけの記事も管理者のみ", () => {
    expect(canViewGuideDoc(d(["maintainer"]), { isAdmin: false })).toBe(false);
    expect(canViewGuideDoc(d(["admin", "maintainer"]), { isAdmin: false })).toBe(false);
    expect(canViewGuideDoc(d(["maintainer"]), { isAdmin: true })).toBe(true);
  });
  it("isAdminOnlyDoc", () => {
    expect(isAdminOnlyDoc(d(["admin", "admin"]))).toBe(true);
    expect(isAdminOnlyDoc(d(["admin", "member"]))).toBe(false);
  });
});

describe("isGuideAdmin", () => {
  it("is_admin / is_super_admin は管理者、ゲストは権限があっても対象外", () => {
    expect(isGuideAdmin({ id: "a", is_admin: true })).toBe(true);
    expect(isGuideAdmin({ id: "a", is_super_admin: true })).toBe(true);
    expect(isGuideAdmin({ id: "a" })).toBe(false);
    expect(isGuideAdmin({ id: "__guest__", is_admin: true })).toBe(false);
    expect(isGuideAdmin(null)).toBe(false);
  });
});

describe("実際の記事（manifest）", () => {
  const ADMIN_ONLY = [
    "03_roles/admin", "04_workflows/quarter-rollover", "05_admin/departments-and-members",
    "05_admin/objective-kr-tf", "05_admin/settings-overview", "_meta/conventions",
  ];
  it("管理者専用記事が一般メンバーの目次（groupedDocs を絞ったもの）から消え、管理者には出る", () => {
    const flat = groupedDocs().flatMap(g => g.entries);
    const member = filterViewableDocs(flat, { isAdmin: false }).map(e => e.slug);
    const admin = filterViewableDocs(flat, { isAdmin: true }).map(e => e.slug);
    for (const s of ADMIN_ONLY) {
      expect(member).not.toContain(s);
      expect(admin).toContain(s);
    }
    expect(member).toContain("00_overview");
  });
  it("管理者専用の判定は上記6本（＋あれば 09_architecture）だけ", () => {
    const found = listDocs().filter(isAdminOnlyDoc).map(e => e.slug).filter(s => s !== "09_architecture").sort();
    expect(found).toEqual([...ADMIN_ONLY].sort());
  });
  it("記事内リンク：一般メンバーには管理者専用記事が文字だけ（none）、管理者には doc", () => {
    const has = (isAdmin: boolean) => (slug: string) => canViewGuideDoc(getDocBySlug(slug), { isAdmin });
    expect(resolveLink("../03_roles/admin.md", "02_modes/tasks.md", has(false))).toEqual({ kind: "none" });
    expect(resolveLink("../03_roles/admin.md", "02_modes/tasks.md", has(true))).toEqual({ kind: "doc", slug: "03_roles/admin" });
    expect(resolveLink("../00_overview.md", "02_modes/tasks.md", has(false))).toEqual({ kind: "doc", slug: "00_overview" });
  });
  it("HTML保存：どの種別でも一般メンバーに管理者専用記事を含めない", () => {
    const flat = groupedDocs().flatMap(g => g.entries);
    for (const kind of ["manual", "spec", "architecture"] as const) {
      expect(selectGuideSet(kind, flat, false).filter(isAdminOnlyDoc)).toEqual([]);
    }
    expect(selectGuideSet("architecture", flat, true).length).toBeGreaterThanOrEqual(0);
  });
});

describe("適用箇所の登録（Section 59：コメントを除いて走査）", () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const read = (p: string) => strip(readFileSync(resolve(__dirname, "../../../", p), "utf8"));
  it.each([
    ["components/guide/GuideModeView.tsx", /canViewGuideDoc|filterViewableDocs/],
    ["components/guide/GuideOverlay.tsx", /canViewGuideDoc/],
    ["components/guide/GuideMarkdown.tsx", /canViewGuideDoc/],
    ["components/guide/HelpButton.tsx", /guideViewerIsAdmin/],
    ["lib/docs/guideHtmlExport.ts", /canViewGuideDoc|filterViewableDocs/],
    ["components/layout/MainLayout.tsx", /isGuideAdmin/],
  ])("%s は共通判定を通している", (file, re) => {
    expect(read(file)).toMatch(re);
  });
  it("MainLayout に isAdmin の直書き式（is_super_admin === true）が残っていない", () => {
    expect(read("components/layout/MainLayout.tsx")).not.toMatch(/is_admin === true \|\| currentUser\.is_super_admin === true/);
  });
});
