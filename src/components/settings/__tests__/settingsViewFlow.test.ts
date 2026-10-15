// src/components/settings/__tests__/settingsViewFlow.test.ts
//
// v3.155：設定画面（SettingsView）を実際に描画して、利用者から見える動きを確かめる。
//  - 誰にどのカードが出るか（一般＝個人5枚／部署の管理者＝14枚／super_admin＝18枚）
//  - カードを押すと詳細ページ、「← 設定」でトップに戻る
//  - 直接ジャンプ（initialPage）：権限のあるページは直接開き、権限の無いページはトップ
//  - 未保存の編集があるとき、確認を拒否すると遷移しない（Section 46・47）
// 最小 DOM（miniDom）で描画する。クリックは React の props の onClick を直接呼ぶ。

import { allElements, reactProps, type MiniElement } from "../../../__tests__/miniDom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dialog = vi.hoisted(() => ({ confirmResult: true }));
vi.mock("../../../hooks/useIsMobile", () => ({ useIsMobile: () => false }));
vi.mock("../../../lib/dialog", () => ({
  confirmDialog: vi.fn(async () => dialog.confirmResult),
  alertDialog: vi.fn(async () => {}),
}));
vi.mock("../../../lib/supabase/auth", () => ({ updateOwnPassword: vi.fn(), getAuthEmail: vi.fn() }));
vi.mock("../SettingsHelpButton", () => ({ SettingsHelpButton: () => null }));
vi.mock("../NotificationSettingsSection", () => ({ NotificationSettingsSection: () => null }));

import { SettingsView } from "../SettingsView";
import { useAppStore } from "../../../stores/appStore";
import { registerUnsavedEditor, _resetUnsavedEditorRegistryForTest } from "../../../lib/editing/unsavedEditorRegistry";
import type { Member } from "../../../lib/localData/types";
import type { AdminPageId, SettingsPageId } from "../../../lib/settings/settingsPages";

function member(over: Partial<Member>): Member {
  return {
    id: "m1", display_name: "山本 勇気", short_name: "山本", initials: "山本", teams_account: "",
    email: "y@example.com", notify_pref: "browser", is_admin: false, is_super_admin: false,
    color_bg: "var(--avatar-1-bg)", color_text: "var(--avatar-1-text)", is_deleted: false,
    group_id: "grp-a", group_ids: ["grp-a"], updated_at: "2026-10-15T00:00:00Z", updated_by: "m1",
    ...over,
  };
}

const admin = member({ id: "a", display_name: "管理者", is_admin: true });
const plain = member({ id: "p", display_name: "一般" });
const superAdmin = member({ id: "s", display_name: "スーパー", is_super_admin: true });

let root: Root | null = null;
const adminPagesRendered: AdminPageId[] = [];

function mount(me: Member, initialPage?: SettingsPageId) {
  useAppStore.setState({
    members: [admin, plain, superAdmin],
    groups: [{ id: "grp-a", name: "EGG", is_deleted: false } as never],
    currentGroupId: "grp-a",
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(createElement(SettingsView, {
    currentUser: me, theme: "light", onToggleTheme: () => {},
    renderAdminPage: (page: AdminPageId) => { adminPagesRendered.push(page); return createElement("div", { "data-admin-page": page }, `admin:${page}`); },
    onClose: () => {}, onOpenGuide: () => {}, onRestartTour: () => {}, onOpenShortcuts: () => {}, onLogout: () => {},
    initialPage,
  })));
}

async function click(el: MiniElement) {
  await act(async () => { (reactProps(el).onClick as () => void)(); });
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
}

const cards = () => allElements().filter(e => e.getAttribute("class") === "settings-card");
const backButton = () => allElements().find(e => e.tagName === "BUTTON" && /^[←‹] 設定$/.test(e.textContent.trim()));
/** 見出しバーのページ名（18px の div）。React の要素でないもの（コンテナ等）は無視する */
const headerTitle = () => allElements().find(e => {
  if (e.tagName !== "DIV") return false;
  try { return (reactProps(e).style as { fontSize?: string } | undefined)?.fontSize === "18px"; } catch { return false; }
});

beforeEach(() => {
  dialog.confirmResult = true;
  adminPagesRendered.length = 0;
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  _resetUnsavedEditorRegistryForTest();
  for (const c of [...document.body.childNodes]) document.body.removeChild(c);
});

describe("設定画面のトップ（カード一覧）", () => {
  it("一般メンバー：個人の5枚だけ。見出しは「個人」のみ（部署の管理・アプリの管理は出さない）", () => {
    mount(plain);
    expect(cards()).toHaveLength(5);
    const text = allElements().map(e => e.textContent).join("");
    expect(text).toContain("通知の受け取り方");
    expect(text).not.toContain("アプリの管理");
    expect(text).not.toContain("お知らせの送信");
    expect(backButton()).toBeUndefined();
  });

  it("部署の管理者：個人5＋部署の管理9＝14枚（アプリの管理は出さない）", () => {
    mount(admin);
    expect(cards()).toHaveLength(14);
    expect(allElements().map(e => e.textContent).join("")).not.toContain("利用者の画面のエラー");
  });

  it("全社スーパー管理者：18枚すべて", () => {
    mount(superAdmin);
    expect(cards()).toHaveLength(18);
    expect(allElements().map(e => e.textContent).join("")).toContain("利用者の画面のエラー");
  });
});

describe("カード→詳細→戻る", () => {
  it("カードを押すと詳細ページが開き（← 設定が出る）、戻るとトップのカード一覧に戻る", async () => {
    mount(plain);
    const profileCard = cards().find(c => c.textContent.includes("プロフィール"))!;
    await click(profileCard);
    expect(cards()).toHaveLength(0);
    expect(backButton()).toBeDefined();
    expect(headerTitle()?.textContent).toBe("プロフィール");
    expect(allElements().some(e => e.textContent === "表示名")).toBe(true);

    await click(backButton()!);
    expect(cards()).toHaveLength(5);
    expect(backButton()).toBeUndefined();
    expect(headerTitle()?.textContent).toBe("設定");
  });

  it("管理ページのカードは renderAdminPage に page を渡して中身を出す", async () => {
    mount(admin);
    await click(cards().find(c => c.textContent.includes("プロジェクト招待"))!);
    expect(adminPagesRendered).toContain("invites");
    expect(allElements().some(e => e.getAttribute("data-admin-page") === "invites")).toBe(true);
  });
});

describe("直接ジャンプ（initialPage）", () => {
  it("権限のあるページは直接開く（super_admin の errors）", () => {
    mount(superAdmin, "errors");
    expect(cards()).toHaveLength(0);
    expect(adminPagesRendered).toContain("errors");
    expect(headerTitle()?.textContent).toBe("利用者の画面のエラー");
  });

  it("権限の無いページはトップを開く（一般メンバーの errors・backup）", () => {
    mount(plain, "errors");
    expect(cards()).toHaveLength(5);
    expect(adminPagesRendered).toEqual([]);
  });

  it("誰でも開ける notify は直接開く", () => {
    mount(plain, "notify");
    expect(cards()).toHaveLength(0);
    expect(headerTitle()?.textContent).toBe("通知の受け取り方");
  });
});

describe("未保存の確認（Section 46・47）", () => {
  it("未保存の編集があって確認を拒否したら、「← 設定」を押しても詳細に留まる。承認すれば戻る", async () => {
    mount(plain, "profile");
    registerUnsavedEditor("test-dirty", () => true);
    dialog.confirmResult = false;
    await click(backButton()!);
    expect(cards()).toHaveLength(0);
    expect(backButton()).toBeDefined();

    dialog.confirmResult = true;
    await click(backButton()!);
    expect(cards()).toHaveLength(5);
  });
});
