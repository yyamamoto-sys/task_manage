// src/lib/admin/memberPermission.ts
//
// 【設計意図・v3.137】
// members の書き込み権限（migration 20261007c・CLAUDE.md Section 70）を画面側で写したもの。
// 画面に出すボタンをこの判定で絞り、押しても RLS で弾かれる（保存に失敗する／0件更新が
// 「他の人が更新しました」に見える）操作を最初から出さないためにある。強制は DB 側。
//
// - 他人の行の追加・編集・削除：その人のホーム部署（members.group_id）の管理者と super_admin。
//   管理者の権限はホーム部署だけに効き、兼務先では一般メンバー扱い。
// - 招待用部署がホームの行（ゲスト）：見えている招待用部署なら、どこかの管理者でよい（従来どおり）。
// - 自分の行：誰でも編集できる（権限の列はトリガーが差し戻す）。削除はできない。
// - ホーム部署の付け替え：super_admin だけ。

export interface MemberActor {
  id: string;
  group_id?: string | null;
  is_admin?: boolean;
  is_super_admin?: boolean;
}

export interface MemberTarget {
  id: string;
  group_id?: string | null;
}

/** 管理者として扱う部署（ホーム部署）。管理者でなければ null。DB の current_member_admin_group_id() と同じ */
export function adminGroupIdOf(actor: MemberActor): string | null {
  return actor.is_admin === true && actor.group_id ? actor.group_id : null;
}

/** その部署の管理者として振る舞えるか（部署の改名・メンバーの追加） */
export function canAdministerGroup(actor: MemberActor, groupId: string | null | undefined): boolean {
  if (actor.is_super_admin === true) return true;
  if (!groupId) return false;
  return adminGroupIdOf(actor) === groupId;
}

/**
 * 他人の行を管理（編集・削除）できるか。
 * manageableInviteGroupIds は「自分に見えている招待用部署」（自分が見られるPJに紐づく招待用部署）。
 */
export function canManageMember(
  actor: MemberActor,
  target: MemberTarget,
  manageableInviteGroupIds: ReadonlySet<string>,
): boolean {
  if (actor.is_super_admin === true) return true;
  if (!target.group_id) return false;
  if (target.group_id === adminGroupIdOf(actor)) return true;
  return actor.is_admin === true && manageableInviteGroupIds.has(target.group_id);
}

/** 編集フォームを開けるか（自分の行は誰でも開ける） */
export function canEditMemberRow(
  actor: MemberActor,
  target: MemberTarget,
  manageableInviteGroupIds: ReadonlySet<string>,
): boolean {
  return target.id === actor.id || canManageMember(actor, target, manageableInviteGroupIds);
}

/** 削除できるか（自分は削除できない＝画面の既存の約束と同じ） */
export function canDeleteMember(
  actor: MemberActor,
  target: MemberTarget,
  manageableInviteGroupIds: ReadonlySet<string>,
): boolean {
  return target.id !== actor.id && canManageMember(actor, target, manageableInviteGroupIds);
}

/** ホーム部署を付け替えられるか */
export function canChangeHomeGroup(actor: MemberActor): boolean {
  return actor.is_super_admin === true;
}

/** 自分に見えている招待用部署＝自分が見られるPJの group_ids に含まれる招待用部署 */
export function visibleInviteGroupIds(
  projects: readonly { group_ids?: string[] | null; is_deleted?: boolean }[],
  inviteGroupIds: ReadonlySet<string>,
): Set<string> {
  const out = new Set<string>();
  for (const p of projects) {
    if (p.is_deleted) continue;
    for (const gid of p.group_ids ?? []) {
      if (inviteGroupIds.has(gid)) out.add(gid);
    }
  }
  return out;
}
