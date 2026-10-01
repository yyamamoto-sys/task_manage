// src/lib/settings/settingsSections.ts
//
// 【設計意図・v3.127】
// 設定ページの目次。個人設定（全員）＋管理（管理者のみ）。
// 「管理」を出す条件は AdminView 冒頭の管理者ガードと完全に同じにする
// （is_admin / is_super_admin、またはアクティブな is_admin が1人もいないブートストラップ状態）。
// ここがずれると「目次にあるのに開くと🔒」や「権限があるのに目次に無い」になる。

import type { Member } from "../localData/types";
import { active } from "../localData/localStore";

export type SettingsSection = "profile" | "display" | "notify" | "help" | "admin";

export const PERSONAL_SECTIONS: readonly SettingsSection[] = ["profile", "display", "notify", "help"];

export function canAccessAdminSection(currentUser: Member, members: readonly Member[]): boolean {
  if (currentUser.is_admin === true || currentUser.is_super_admin === true) return true;
  const hasAnyAdmin = active(members as Member[]).some(m => m.is_admin === true);
  return !hasAnyAdmin;
}

export function buildSettingsSections(showAdmin: boolean): SettingsSection[] {
  return showAdmin ? [...PERSONAL_SECTIONS, "admin"] : [...PERSONAL_SECTIONS];
}

/** 自部署（表示部署）の管理者。group_ids が入っていればそれで、無ければ group_id で判定する */
export function adminsOfGroup(members: readonly Member[], groupId: string | null): Member[] {
  if (!groupId) return [];
  return active(members as Member[]).filter(m => {
    if (m.is_admin !== true) return false;
    if (m.group_ids && m.group_ids.length > 0) return m.group_ids.includes(groupId);
    return m.group_id === groupId;
  });
}
