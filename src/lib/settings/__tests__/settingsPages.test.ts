// src/lib/settings/__tests__/settingsPages.test.ts
//
// v3.155：設定画面のページ定義（唯一の正本）の機械チェック。
//  ① 網羅：旧 AdminTab 13値と個人5値がちょうど1回ずつ・i18n（ja／en）のキーが揃っている
//  ② 可視条件：AdminView のガード（canAccessAdminSection）・お知らせ送信の例外・super_admin 限定と一致
//  ③ 呼び出し元：直接ジャンプ（openSettings の引数）が実在するページ ID だけを指している
// 新しいソース走査はコメントを除去してから走査する（CLAUDE.md Section 59。コメントに書いた語で無力化されない）。

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Member } from "../../localData/types";
import { layoutJa } from "../../../i18n/layout.ja";
import { layoutEn } from "../../../i18n/layout.en";
import { canAccessAdminSection } from "../settingsSections";
import {
  ADMIN_PAGE_IDS, PERSONAL_PAGE_IDS, SETTINGS_PAGES, buildSettingsCardGroups, canViewSettingsPage,
  isAdminPageId, resolveRequestedPage, resolveSettingsAudience, settingsGroupTitleKey,
  settingsPageDescKey, settingsPageTitleKey, type SettingsPageId,
} from "../settingsPages";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, "../../../");

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map(l => {
    const i = l.indexOf("//");
    return i === -1 ? l : l.slice(0, i);
  }).join("\n");
}
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), "utf8");

function member(over: Partial<Member>): Member {
  return {
    id: "m1", display_name: "山本", short_name: "山本", initials: "山本", teams_account: "",
    email: "y@example.com", notify_pref: "browser", is_admin: false, is_super_admin: false,
    color_bg: "x", color_text: "y", is_deleted: false,
    group_id: "grp-a", group_ids: ["grp-a"], updated_at: "2026-10-15T00:00:00Z", updated_by: "m1",
    ...over,
  };
}

// 旧 AdminView の AdminTab 13値（v3.154）＋v3.157 で足した「ご意見・不具合」（feedback）と、旧 SettingsView の個人5項目に相当する新5ページ
const OLD_ADMIN_TABS = ["okr", "tf", "pj", "members", "tags", "ai_usage", "groups", "invites", "tips", "backup", "reminders", "errors", "messages", "feedback"];
const PERSONAL = ["profile", "account", "display", "notify", "help"];

describe("① 設定ページの網羅", () => {
  it("旧 AdminTab 13値＋feedback と個人5値がちょうど1回ずつ（19ページ）", () => {
    const ids = SETTINGS_PAGES.map(p => p.id as string);
    expect(ids).toHaveLength(19);
    expect(new Set(ids).size).toBe(19);
    expect([...ids].sort()).toEqual([...OLD_ADMIN_TABS, ...PERSONAL].sort());
    expect([...ADMIN_PAGE_IDS].sort()).toEqual([...OLD_ADMIN_TABS].sort());
    expect([...PERSONAL_PAGE_IDS].sort()).toEqual([...PERSONAL].sort());
    for (const id of OLD_ADMIN_TABS) expect(isAdminPageId(id as SettingsPageId)).toBe(true);
    for (const id of PERSONAL) expect(isAdminPageId(id as SettingsPageId)).toBe(false);
  });

  it("全ページに名前と1行説明が ja／en の両方にある（キーの有無）", () => {
    for (const p of SETTINGS_PAGES) {
      for (const key of [settingsPageTitleKey(p.id), settingsPageDescKey(p.id)]) {
        expect(layoutJa, `ja:${key}`).toHaveProperty([key]);
        expect(layoutEn, `en:${key}`).toHaveProperty([key]);
        expect((layoutJa as Record<string, string>)[key].length).toBeGreaterThan(0);
        expect((layoutEn as Record<string, string>)[key].length).toBeGreaterThan(0);
      }
    }
    for (const g of ["personal", "department", "app"] as const) {
      expect(layoutJa).toHaveProperty([settingsGroupTitleKey(g)]);
      expect(layoutEn).toHaveProperty([settingsGroupTitleKey(g)]);
    }
  });

  it("AdminView は19ページのうち管理系14ページをすべて描画分岐に持つ（page === \"id\"）", () => {
    const src = stripComments(read("components/admin/AdminView.tsx"));
    for (const id of ADMIN_PAGE_IDS) {
      expect(src, id).toContain(`page === "${id}"`);
    }
  });

  it("詳細ページの名前は設計どおり（名称の付け直し）", () => {
    const ja = layoutJa as Record<string, string>;
    expect(ja[settingsPageTitleKey("notify")]).toBe("通知の受け取り方");
    expect(ja[settingsPageTitleKey("reminders")]).toBe("期限リマインドの実行状況");
    expect(ja[settingsPageTitleKey("groups")]).toBe("部署");
    expect(ja[settingsPageTitleKey("errors")]).toBe("利用者の画面のエラー");
    expect(ja[settingsPageTitleKey("messages")]).toBe("お知らせの送信");
    expect(ja[settingsPageTitleKey("tf")]).toBe("Task Force・ToDo");
  });
});

describe("② 誰に何が見えるか（カード構成）", () => {
  const admin = member({ id: "a", is_admin: true });
  const plain = member({ id: "p" });
  const superAdmin = member({ id: "s", is_super_admin: true });
  const idsFor = (me: Member, all: Member[]) =>
    buildSettingsCardGroups(resolveSettingsAudience(me, all)).flatMap(g => g.pages.map(p => p.id));

  it("一般メンバー（部署に管理者がいる）は個人の5枚だけ。見えない見出しは出さない", () => {
    const groups = buildSettingsCardGroups(resolveSettingsAudience(plain, [admin, plain]));
    expect(groups.map(g => g.group)).toEqual(["personal"]);
    expect(idsFor(plain, [admin, plain])).toEqual(PERSONAL);
  });

  it("部署の管理者は個人＋部署の管理9枚（アプリの管理は出さない）", () => {
    const ids = idsFor(admin, [admin, plain]);
    expect(ids).toEqual([...PERSONAL, "okr", "tf", "pj", "members", "tags", "groups", "invites", "ai_usage", "messages"]);
  });

  it("super_admin は19枚すべて。並びは 目標→手段→人→組織→利用状況→連絡", () => {
    const ids = idsFor(superAdmin, [admin, plain, superAdmin]);
    expect(ids).toHaveLength(19);
    expect(ids.slice(5)).toEqual(["okr", "tf", "pj", "members", "tags", "groups", "invites", "ai_usage", "messages", "tips", "backup", "reminders", "errors", "feedback"]);
  });

  it("管理者が1人もいない部署（ブートストラップ）：部署の管理は全員に出るが、お知らせの送信は出ない", () => {
    const ids = idsFor(plain, [plain]);
    expect(ids).toContain("pj");
    expect(ids).toContain("members");
    expect(ids).not.toContain("messages");
    expect(ids).not.toContain("errors");
    expect(ids).not.toContain("feedback");
  });

  it("部署の管理の可視条件は AdminView のガード（canAccessAdminSection）と常に一致する", () => {
    const cases: [Member, Member[]][] = [
      [plain, [admin, plain]], [admin, [admin, plain]], [superAdmin, [admin, plain, superAdmin]],
      [plain, [plain]], [plain, [plain, member({ id: "d", is_admin: true, is_deleted: true })]],
    ];
    for (const [me, all] of cases) {
      const audience = resolveSettingsAudience(me, all);
      for (const p of SETTINGS_PAGES.filter(x => x.group === "department" && x.id !== "messages")) {
        expect(canViewSettingsPage(p.id, audience), `${me.id}:${p.id}`).toBe(canAccessAdminSection(me, all));
      }
    }
  });

  it("AdminView 自身のガードも canAccessAdminSection（カードの判定と同じ関数）を使っている", () => {
    expect(stripComments(read("components/admin/AdminView.tsx"))).toContain("canAccessAdminSection(currentUser, allMembers)");
  });

  it("権限の無いページ ID・存在しない ID・空はトップ（null）になる", () => {
    const plainAud = resolveSettingsAudience(plain, [admin, plain]);
    expect(resolveRequestedPage("errors", plainAud)).toBeNull();
    expect(resolveRequestedPage("backup", plainAud)).toBeNull();
    expect(resolveRequestedPage("admin", plainAud)).toBeNull();
    expect(resolveRequestedPage(undefined, plainAud)).toBeNull();
    expect(resolveRequestedPage("notify", plainAud)).toBe("notify");
    const superAud = resolveSettingsAudience(superAdmin, [admin, superAdmin]);
    expect(resolveRequestedPage("errors", superAud)).toBe("errors");
    expect(resolveRequestedPage("messages", superAud)).toBe("messages");
  });

  it("件数バッジは現行ナビにあった6件だけ（okr・tf・pj・members・tags・groups）", () => {
    const withCount = SETTINGS_PAGES.filter(p => p.countKey).map(p => p.id).sort();
    expect(withCount).toEqual(["groups", "members", "okr", "pj", "tags", "tf"]);
  });

  it("編集対象の部署を出すのは部署に依存する7ページだけ", () => {
    const scoped = SETTINGS_PAGES.filter(p => p.deptScoped).map(p => p.id).sort();
    expect(scoped).toEqual(["ai_usage", "invites", "members", "okr", "pj", "tags", "tf"]);
  });
});

describe("③ 直接ジャンプの入口がすべて新構造のページを指す", () => {
  const validIds = new Set<string>(SETTINGS_PAGES.map(p => p.id));

  it("MainLayout の openSettings(...) の引数は実在するページ ID だけ", () => {
    const src = stripComments(read("components/layout/MainLayout.tsx"));
    const args = [...src.matchAll(/openSettings\("([^"]+)"\)/g)].map(m => m[1]);
    expect(args.length).toBeGreaterThan(0);
    for (const a of args) expect(validIds.has(a), a).toBe(true);
  });

  it("通知・URL の直接ジャンプ先（errors／backup／messages）と通知設定（notify）が openSettings に配線されている", () => {
    const src = stripComments(read("components/layout/MainLayout.tsx"));
    expect(src).toContain('target === "admin-errors") openSettings("errors")');
    expect(src).toContain('target === "admin-backup") openSettings("backup")');
    expect(src).toContain('target === "admin-sent") openSettings("messages")');
    expect(src).toContain('onOpenSettings={() => openSettings("notify")}');
  });

  it("ダッシュボードの「通知設定」は notify を指定して app:open-settings を飛ばす", () => {
    const src = stripComments(read("components/dashboard/DashboardView.tsx"));
    expect(src).toContain('new CustomEvent("app:open-settings", { detail: "notify" })');
  });

  it("オンボーディングは okr／pj を明示して開く（自動選択に頼らない）", () => {
    const src = stripComments(read("components/dashboard/OnboardingHome.tsx"));
    expect(src).toContain('onOpenAdmin("okr")');
    expect(src).toContain('onOpenAdmin("pj")');
  });

  it("旧構造の入口（initialTab・initialSection・adminInitialTab）がソースに残っていない", () => {
    for (const rel of ["components/layout/MainLayout.tsx", "components/settings/SettingsView.tsx", "components/admin/AdminView.tsx"]) {
      const src = stripComments(read(rel));
      expect(src, rel).not.toMatch(/initialTab|initialSection|adminInitialTab|settingsSection\b/);
    }
  });
});
