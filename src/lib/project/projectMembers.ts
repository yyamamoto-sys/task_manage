// src/lib/project/projectMembers.ts
//
// 【設計意図】
// PJ設定画面「このPJに関わるメンバー」の一覧を組み立てる純粋関数。
// 新しい project_members のような紐づけテーブルは作らず（CLAUDE.md の指示どおり）、
// 既存データ3種の和集合として組み立てる：
//   - オーナー（project.owner_member_ids／owner_member_id）
//   - タスクの担当者（このPJに紐づくタスクの assignee）
//   - 招待用部署に属する人（招待された本人＋兼務で加わった社内メンバー。
//     Section 25参照。招待が1件も無いPJでは何も足されない）
// 同じ人が複数の立場を兼ねる場合は1行に集約し、役割を配列で持たせる（重複排除）。
//
// 呼び出し側（ProjectSettingsModal）が owner/assignee/inviteGroupId を計算して渡す。
// ここでは「集約して並べる」ことだけに責務を絞り、DB由来のjoinロジックは持たない。

import type { Member } from "../localData/types";

export type ProjectMemberRole = "owner" | "assignee" | "invited";

export interface ProjectMemberRow {
  member: Member;
  roles: ProjectMemberRole[];
}

const ROLE_PRIORITY: Record<ProjectMemberRole, number> = {
  owner: 0,
  assignee: 1,
  invited: 2,
};

function bestRolePriority(roles: ProjectMemberRole[]): number {
  return Math.min(...roles.map(r => ROLE_PRIORITY[r]));
}

export interface ComputeProjectMembersParams {
  ownerIds: string[];
  assigneeIds: string[];
  /** 招待用部署のid（`project_invites.invite_group_id`）。招待が1件も無ければ null/undefined でよい */
  inviteGroupId?: string | null;
}

/**
 * members から「このPJに関わる人」を集約して返す。
 * 並び順：役割の優先度（オーナー＞担当者＞招待のみ）→ short_name。
 */
export function computeProjectMembers(
  members: Member[],
  params: ComputeProjectMembersParams,
): ProjectMemberRow[] {
  const memberById = new Map(members.map(m => [m.id, m]));
  const rows = new Map<string, ProjectMemberRow>();

  const addRole = (id: string, role: ProjectMemberRole) => {
    const m = memberById.get(id);
    if (!m) return;
    const existing = rows.get(id);
    if (existing) {
      if (!existing.roles.includes(role)) existing.roles.push(role);
    } else {
      rows.set(id, { member: m, roles: [role] });
    }
  };

  params.ownerIds.forEach(id => addRole(id, "owner"));
  params.assigneeIds.forEach(id => addRole(id, "assignee"));
  if (params.inviteGroupId) {
    for (const m of members) {
      if (m.group_ids?.includes(params.inviteGroupId)) addRole(m.id, "invited");
    }
  }

  return [...rows.values()].sort((a, b) => {
    const pa = bestRolePriority(a.roles);
    const pb = bestRolePriority(b.roles);
    if (pa !== pb) return pa - pb;
    return a.member.short_name.localeCompare(b.member.short_name, "ja");
  });
}
