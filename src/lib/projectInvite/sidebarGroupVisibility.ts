// src/lib/projectInvite/sidebarGroupVisibility.ts
//
// 【設計意図】
// プロジェクト招待の発行者・PJオーナーには、招待用部署（is_invite_group=true）への
// 兼務が自動付与される（create_project_invite()。CLAUDE.md Section 25）。この兼務が
// MainLayout.tsx の accessibleGroups（サイドバーの「表示部署」切替の選択肢）に混ざると、
// 元々1部署しか無かった人にも切替UIが出てしまう（accessibleGroups.length >= 2 で表示）。
// これは「既存部署の人のビューは変わらない」という要望に反するため、切替の選択肢からは
// 招待用部署を除く。
//
// 🔴 ただし招待された本人は招待用部署しか持たない（ホーム部署がそのまま招待用部署）。
// 素直に「is_invite_group を全部除外」すると、招待された本人の accessibleGroups が
// 空になり、currentGroupId の対応先が無くなって画面が壊れうる。
//
// 対策：フィルタした結果が1件も残らない場合は「除外すると選べる部署が無くなる」ことを
// 意味するため、フィルタを適用せず元のリストをそのまま返す。これにより：
//   - 通常部署のみ（1件・複数件）→ 何も除外されない（元々is_invite_groupが無いため不変）
//   - 発行者・PJオーナー（ホーム部署 + 招待用部署の兼務）→ 招待用部署が除かれ、
//     ホーム部署だけが残る（accessibleGroups.length が1に戻り、切替UIが消える）
//   - 招待された本人（招待用部署のみ）→ 除外すると空になるため、除外前のリストをそのまま
//     返す（画面が真っ白にならない。もともと1件のため切替UI自体は出ない）
// 招待された本人かどうかを個別に判定する必要が無く、「空になるなら諦める」という
// 一般則だけで両ケースを安全に処理できる。
export function filterInviteGroupsForSidebar<T extends { is_invite_group?: boolean }>(
  groups: T[],
): T[] {
  const filtered = groups.filter(g => !g.is_invite_group);
  return filtered.length > 0 ? filtered : groups;
}

// 【設計意図（v3.82追加）】
// サイドバー「表示部署」切替の選択肢一覧を組み立てる、MainLayout.tsxの`accessibleGroups`と
// 同一のロジック。「表示部署をリロード後も維持する」機能（src/lib/layout/
// sidebarCurrentGroupRestore.ts）が、復元してよい部署かどうかをこのリストと同じ基準で
// 判定する必要があるため、ロジックをここへ1本化した（MainLayout.tsx側のuseMemoもこの関数を
// 呼ぶ）。判定基準がずれると、切替UIには出ない部署をリロード後に復元してしまい、UIから
// 戻す手段が無い状態になる。
export function computeAccessibleGroupsForSidebar<
  G extends { id: string; is_deleted?: boolean; is_invite_group?: boolean },
>(
  groups: G[],
  member: { group_id?: string | null; group_ids?: string[] | null },
  isSuperAdmin: boolean,
): G[] {
  const groupsActive = groups.filter(g => !g.is_deleted);
  if (isSuperAdmin) return filterInviteGroupsForSidebar(groupsActive);
  const ids = member.group_ids?.length ? member.group_ids
    : (member.group_id ? [member.group_id] : []);
  return filterInviteGroupsForSidebar(groupsActive.filter(g => ids.includes(g.id)));
}
