// src/lib/admin/guestMembers.ts
//
// 【設計意図】
// v3.60でAdminViewの部署絞り込みをサイドバーの「表示部署」に一本化した副作用の是正。
// プロジェクト招待で受け入れた人（accept_project_invite()）は、ホーム部署が招待用部署
// （groups.is_invite_group=true。CLAUDE.md Section 25）そのものになり、通常の部署を
// 一切持たない。サイドバーの「表示部署」切替は招待用部署を選択肢から除く
// （filterInviteGroupsForSidebar）ため、部署絞り込み（memberInGroup）だけに頼ると
// この人たちがMembersSectionから永久に見えなくなり、編集・削除ができなくなる
// （実データ自体はmembersのRLS拡張＝visible_invite_group_ids()により、そのPJが属する
// 部署のメンバーには既に見えている。CLAUDE.md Section 25 Phase 4(b)参照。UI側の
// フィルタが不要に隠しているだけ）。
//
// 対応：「アクセス可能な部署が1件も無く、招待用部署だけしか持たない」メンバーを
// 「ゲストメンバー」として判定する純粋関数を切り出し、AdminView側で部署絞り込みとは
// 別枠の常時表示リストに出す（部署概念を持たないタグ・グループ数と同じ扱い方の踏襲）。
export function isGuestOnlyMember(
  memberGroupIds: string[],
  inviteGroupIds: ReadonlySet<string> | string[],
): boolean {
  if (memberGroupIds.length === 0) return false;
  const inviteIds = inviteGroupIds instanceof Set ? inviteGroupIds : new Set(inviteGroupIds);
  return memberGroupIds.every(id => inviteIds.has(id));
}
