// src/lib/settings/profileUpdate.ts
//
// 【設計意図・v3.127】
// 設定ページ「プロフィール」から本人が変えられるのは 表示名・短縮名・アバターの色 の3項目だけ。
// saveMember（upsert）は行全体を送るため、自分の行のコピーに対してこの3項目
// （＋表示名から機械的に決まる initials・監査列 updated_by）だけを差し替えて渡す。
// 入力側の型を3項目に絞っておくことで、is_admin / is_super_admin / group_id / group_ids /
// email 等をこの経路から書き換える余地を作らない（DB側はトリガー
// guard_member_privilege_columns が別途差し戻す）。

import type { Member } from "../localData/types";

export interface ProfileInput {
  display_name: string;
  short_name: string;
  color: { bg: string; text: string };
}

/** AdminView MembersSection と同じ規則（空白を除いた先頭2文字・大文字化） */
export function deriveInitials(displayName: string): string {
  return displayName.replace(/\s+/g, "").slice(0, 2).toUpperCase();
}

/** 短縮名が空のときの既定値（表示名の最初の語）。AdminView MembersSection と同じ規則 */
export function fallbackShortName(displayName: string): string {
  return displayName.trim().split(/\s/)[0];
}

export function buildProfileUpdate(self: Member, input: ProfileInput, updatedBy: string): Member {
  const displayName = input.display_name.trim();
  const shortName = input.short_name.trim() || fallbackShortName(displayName);
  return {
    ...self,
    display_name: displayName,
    short_name: shortName,
    initials: deriveInitials(displayName),
    color_bg: input.color.bg,
    color_text: input.color.text,
    updated_by: updatedBy,
  };
}

export const MEMBER_AVATAR_COLORS: readonly { bg: string; text: string }[] = [
  { bg: "var(--avatar-1-bg)", text: "var(--avatar-1-text)" },
  { bg: "var(--avatar-2-bg)", text: "var(--avatar-2-text)" },
  { bg: "var(--avatar-3-bg)", text: "var(--avatar-3-text)" },
  { bg: "var(--avatar-0-bg)", text: "var(--avatar-0-text)" },
  { bg: "var(--avatar-5-bg)", text: "var(--avatar-5-text)" },
  { bg: "var(--avatar-7-bg)", text: "var(--avatar-7-text)" },
];
