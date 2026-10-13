// src/lib/scope/displayGroupScope.ts
//
// サイドバーの「表示部署」（appStore.currentGroupId）で members / projects / tasks を絞る判定（v3.139・CLAUDE.md Section 71）。
// appStore の selectScoped* と担当者候補（lib/members/assigneeCandidates.ts）が同じ判定を使う。

type GroupScoped = { group_id?: string | null; group_ids?: string[] | null };

/**
 * PJ・タスク：group_ids に表示部署を含む、または group_id が一致する（group_ids が空の古い行・作成直後でまだ
 * DBトリガーの結果が返っていない行のため）。group_id==null の行は従来の super_admin 分岐と同じく通す。
 */
export function isRowInDisplayGroup(row: GroupScoped, groupId: string): boolean {
  if (row.group_id == null) return true;
  return row.group_id === groupId || (row.group_ids?.includes(groupId) ?? false);
}

/**
 * 招待されたPJ：自分が属する招待用部署（兼務の group_ids に入る）を group_ids に持つ行は、表示部署に関わらず通す。
 * 招待用部署はサイドバーの表示部署の選択肢から除かれる（sidebarGroupVisibility.ts）ため、既存メンバーが
 * 他部署のPJに招待されると、PJ の group_ids は [他部署, 招待用部署] で表示部署（自部署）とは一致しない。
 * RLS は元々アクセスできる行だけを返す。ここでは「自分が属する招待用部署」だけを見る（他人の招待用部署は通さない）。
 */
export function isRowInUserInviteGroups(row: GroupScoped, userInviteGroupIds: ReadonlySet<string>): boolean {
  if (userInviteGroupIds.size === 0) return false;
  return row.group_ids?.some(g => userInviteGroupIds.has(g)) ?? false;
}

/** メンバー：ホーム部署または兼務先が表示部署。削除済みは除く。 */
export function isMemberInDisplayGroup(m: GroupScoped & { is_deleted?: boolean }, groupId: string): boolean {
  if (m.is_deleted) return false;
  return m.group_id === groupId || (m.group_ids?.includes(groupId) ?? false);
}
