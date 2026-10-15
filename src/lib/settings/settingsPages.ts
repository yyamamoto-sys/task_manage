// src/lib/settings/settingsPages.ts
//
// 【設計意図・v3.155】
// 設定画面（トップのカード一覧＋詳細ページ）の「ページの唯一の定義」。
// 見出し・並び・アイコン・誰に見せるかをここだけで決め、SettingsView（カード一覧）・
// AdminView（詳細の中身）・直接ジャンプ（ベル・通知・オンボーディング）が同じ ID を使う。
// 正本の設計：docs/dev/設計仕様_設定画面リニューアル_20261015.md
//
// 権限の判定は既存の関数をそのまま使う（ここで新しい判定を作らない）：
//  - 部署の管理：canAccessAdminSection（AdminView 冒頭のガードと同じ。管理者不在のブートストラップを含む）
//  - お知らせの送信だけ：is_admin / is_super_admin（ブートストラップを含まない。AdminView の既存の差を維持）
//  - アプリの管理：is_super_admin

import type { Member } from "../localData/types";
import { canAccessAdminSection } from "./settingsSections";

export type PersonalPageId = "profile" | "account" | "display" | "notify" | "help";
export type AdminPageId =
  | "okr" | "tf" | "pj" | "members" | "tags" | "groups" | "invites" | "ai_usage" | "messages"
  | "tips" | "backup" | "reminders" | "errors" | "feedback";
export type SettingsPageId = PersonalPageId | AdminPageId;

export type SettingsGroupId = "personal" | "department" | "app";

/** 件数バッジを出すページ（現行ナビにあった6件だけ。新しい取得は増やさない） */
export type SettingsCountKey = "okr" | "tf" | "pj" | "members" | "tags" | "groups";

export interface SettingsPageDef {
  id: SettingsPageId;
  group: SettingsGroupId;
  icon: string;
  /** 表示部署に依存するページ（詳細ヘッダーに「編集対象：◯◯」を出す） */
  deptScoped: boolean;
  countKey?: SettingsCountKey;
}

/** 表示順。部署の管理は「目標 → 手段 → 人 → 組織 → 利用状況 → 連絡」の順（初見ヒントの順に合わせる） */
export const SETTINGS_PAGES: readonly SettingsPageDef[] = [
  { id: "profile", group: "personal", icon: "👤", deptScoped: false },
  { id: "account", group: "personal", icon: "🔑", deptScoped: false },
  { id: "display", group: "personal", icon: "🎨", deptScoped: false },
  { id: "notify", group: "personal", icon: "🔔", deptScoped: false },
  { id: "help", group: "personal", icon: "🛟", deptScoped: false },
  { id: "okr", group: "department", icon: "🎯", deptScoped: true, countKey: "okr" },
  { id: "tf", group: "department", icon: "🧩", deptScoped: true, countKey: "tf" },
  { id: "pj", group: "department", icon: "📁", deptScoped: true, countKey: "pj" },
  { id: "members", group: "department", icon: "👥", deptScoped: true, countKey: "members" },
  { id: "tags", group: "department", icon: "🏷", deptScoped: true, countKey: "tags" },
  { id: "groups", group: "department", icon: "🏢", deptScoped: false, countKey: "groups" },
  { id: "invites", group: "department", icon: "🎫", deptScoped: true },
  { id: "ai_usage", group: "department", icon: "📊", deptScoped: true },
  { id: "messages", group: "department", icon: "📣", deptScoped: false },
  { id: "tips", group: "app", icon: "💡", deptScoped: false },
  { id: "backup", group: "app", icon: "💾", deptScoped: false },
  { id: "reminders", group: "app", icon: "⏰", deptScoped: false },
  { id: "errors", group: "app", icon: "🚨", deptScoped: false },
  { id: "feedback", group: "app", icon: "💬", deptScoped: false },
];

export const SETTINGS_GROUP_ORDER: readonly SettingsGroupId[] = ["personal", "department", "app"];

export const PERSONAL_PAGE_IDS: readonly PersonalPageId[] = ["profile", "account", "display", "notify", "help"];

export const ADMIN_PAGE_IDS: readonly AdminPageId[] = SETTINGS_PAGES
  .filter(p => p.group !== "personal")
  .map(p => p.id as AdminPageId);

export function isAdminPageId(id: SettingsPageId): id is AdminPageId {
  return !(PERSONAL_PAGE_IDS as readonly string[]).includes(id);
}

export function settingsPageDef(id: SettingsPageId): SettingsPageDef {
  const def = SETTINGS_PAGES.find(p => p.id === id);
  if (!def) throw new Error(`unknown settings page: ${id}`);
  return def;
}

export const settingsPageTitleKey = (id: SettingsPageId) => `layout.settings.page.${id}.title`;
export const settingsPageDescKey = (id: SettingsPageId) => `layout.settings.page.${id}.desc`;
export const settingsGroupTitleKey = (g: SettingsGroupId) => `layout.settings.group.${g}`;

/** 誰に何を見せるか。ページごとの可視条件はこの3つの真偽値だけで決まる */
export interface SettingsAudience {
  /** 部署の管理（AdminView のガードと同じ条件。管理者不在のブートストラップを含む） */
  showDeptAdmin: boolean;
  /** お知らせの送信（ブートストラップを含まない） */
  canSendMessages: boolean;
  /** アプリの管理 */
  isSuperAdmin: boolean;
}

export function resolveSettingsAudience(currentUser: Member, members: readonly Member[]): SettingsAudience {
  const isAdmin = currentUser.is_admin === true;
  const isSuperAdmin = currentUser.is_super_admin === true;
  return {
    showDeptAdmin: canAccessAdminSection(currentUser, members),
    canSendMessages: isAdmin || isSuperAdmin,
    isSuperAdmin,
  };
}

export function canViewSettingsPage(id: SettingsPageId, audience: SettingsAudience): boolean {
  const def = SETTINGS_PAGES.find(p => p.id === id);
  if (!def) return false;
  if (def.group === "personal") return true;
  if (def.group === "app") return audience.isSuperAdmin;
  if (id === "messages") return audience.canSendMessages;
  return audience.showDeptAdmin;
}

export interface SettingsCardGroup {
  group: SettingsGroupId;
  pages: SettingsPageDef[];
}

/** トップに並べる見出しとカード。見えないページしかない見出しは出さない */
export function buildSettingsCardGroups(audience: SettingsAudience): SettingsCardGroup[] {
  return SETTINGS_GROUP_ORDER
    .map(group => ({
      group,
      pages: SETTINGS_PAGES.filter(p => p.group === group && canViewSettingsPage(p.id, audience)),
    }))
    .filter(g => g.pages.length > 0);
}

/** 直接ジャンプで指定されたページ。見えない・存在しない ID はトップ（null）にする */
export function resolveRequestedPage(
  requested: string | null | undefined, audience: SettingsAudience,
): SettingsPageId | null {
  if (!requested) return null;
  const def = SETTINGS_PAGES.find(p => p.id === requested);
  if (!def) return null;
  return canViewSettingsPage(def.id, audience) ? def.id : null;
}
