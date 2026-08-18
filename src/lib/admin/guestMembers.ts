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

// メンバーのgroup_ids正規化（group_idsが空ならgroup_id＝ホーム部署にフォールバック）。
// isGuestOnlyMember の呼び出し前に AdminView.tsx 内で3箇所以上同じ式が繰り返されていたため
// 一本化した（v3.78）。
export function memberGroupIdsForGuestCheck(
  m: { group_id?: string | null; group_ids?: string[] | null },
): string[] {
  return m.group_ids?.length ? m.group_ids : (m.group_id ? [m.group_id] : []);
}

// 【v3.78・CLAUDE.md Section 25 Phase 4末尾「部署でスコープする画面を新設するたびに
// 再発しうる構造」への対応】
//
// 部署絞り込み（memberInGroup等）の結果に、招待受諾者（isGuestOnlyMember）を混ぜて返す。
// AI使用量レポート・PJオーナー/メンバー選択・タグ付与メンバー選択の3箇所（AdminView.tsx）
// が対象。MembersSectionが採った「部署絞り込みとは別枠の常時表示カード」方式は
// ドロップダウン・チェックボックス一覧・集計レポートには馴染まないため採らず、
// 既存の一覧に混ぜたうえで呼び出し側が識別ラベル（withGuestLabel）を付ける前提。
//
// 🔴🔴【v3.78・レビュー後の訂正】呼び出し側は、この関数に渡す inviteGroupIds を
// 「選択中の部署のPJに紐づく招待用部署のidだけ」に絞り込んでから渡すこと（下の
// inviteGroupIdsInScope() 参照）。当初は「招待受諾者がクライアントの members state に
// 乗っている時点でRLSが可視範囲を決定済みだから、部署でのさらなる絞り込みは不要」という
// 判断でorg全体の招待受諾者を無条件に混ぜていたが、v3.75の members_select 4条項目
// （visible_project_member_ids()＝自分がアクセスできるPJの参加者全員）でmembersの可視性が
// 部署をまたいで広がったため、この前提は成り立たない。招待用PJが複数部署にできると、
// 部署別のAI使用量レポート等に他部署の招待受諾者のコストが混ざってしまう（絞り込み無しで
// このヘルパー自体を呼ぶと発生する。関数自体は「渡された集合の中から選ぶ」だけで部署を
// 知らないため、絞り込みは呼び出し側の責務）。
export function withGuestOnlyMembers<
  M extends { id: string; group_id?: string | null; group_ids?: string[] | null },
>(scopedMembers: M[], allMembers: M[], inviteGroupIds: ReadonlySet<string> | string[]): M[] {
  const scopedIds = new Set(scopedMembers.map(m => m.id));
  const extra = allMembers.filter(
    m => !scopedIds.has(m.id) && isGuestOnlyMember(memberGroupIdsForGuestCheck(m), inviteGroupIds),
  );
  return extra.length === 0 ? scopedMembers : [...scopedMembers, ...extra];
}

// 招待受諾者かどうかの判定（1メンバー単位）。一覧に混ぜた後、識別ラベルを付けるかどうかの
// 分岐に使う（v3.78）。withGuestOnlyMembers と同じ理由で、呼び出し側は選択中の部署に
// 絞り込んだ inviteGroupIds を渡すこと。
export function isGuestMemberOf(
  m: { group_id?: string | null; group_ids?: string[] | null },
  inviteGroupIds: ReadonlySet<string> | string[],
): boolean {
  return isGuestOnlyMember(memberGroupIdsForGuestCheck(m), inviteGroupIds);
}

// 表示名の後ろに招待受諾者の識別ラベルを付ける（v3.78）。
export function withGuestLabel(name: string, isGuest: boolean): string {
  return isGuest ? `${name}（招待）` : name;
}

// 【v3.78・レビュー後の追加】選択中の部署（selectedGroupId）のPJに紐づく招待用部署のid
// だけを集める純粋関数。withGuestOnlyMembers()／isGuestMemberOf() に渡す inviteGroupIds を
// 部署でスコープするために呼び出し側（AdminView.tsx）が使う。
//
// 招待用部署のidは 'grp-invite-' + PJのid の文字列組み立てで決定的に導出できる（CLAUDE.md
// Section 25の命名規則）が、この規則をフロントに複製しない
// （src/components/project/ProjectSettingsModal.tsx の inviteGroupId 計算と同じ方針）。
// 代わりに、既にストアに読み込まれている projects.group_ids を使う：PJへの招待発行時に
// 招待用部署のidはそのPJの group_ids へ直接追加される（migration
// supabase/migrations/20260810_add_project_invites.sql の create_project_invite() 参照）ため、
// 「選択中の部署に属するPJの group_ids の中から、招待用部署（is_invite_group=true）だけを
// 取り出す」という積集合だけで求まる。新しい導出規則は書き起こさない。
//
// 論理削除済みPJは対象外（is_deleted=trueのPJに紐づく招待用部署は含めない）。
export function inviteGroupIdsInScope(
  projects: { group_id?: string | null; group_ids?: string[] | null; is_deleted?: boolean }[],
  selectedGroupId: string | null,
  inviteGroupIds: ReadonlySet<string> | string[],
): Set<string> {
  const result = new Set<string>();
  if (!selectedGroupId) return result;
  const inviteIds = inviteGroupIds instanceof Set ? inviteGroupIds : new Set(inviteGroupIds);
  for (const p of projects) {
    if (p.is_deleted) continue;
    const projectGroupIds = p.group_ids?.length ? p.group_ids : (p.group_id ? [p.group_id] : []);
    if (!projectGroupIds.includes(selectedGroupId)) continue;
    for (const gid of projectGroupIds) {
      if (inviteIds.has(gid)) result.add(gid);
    }
  }
  return result;
}
