// src/lib/members/assigneeCandidates.ts
//
// 担当者ピッカー（タスク編集・サイドパネル・クイック追加・一覧/カンバン/ガントのインライン編集・メンション候補）の
// 候補を組み立てる純粋関数（v3.139・CLAUDE.md Section 71）。
//
// 候補 ＝ 表示部署のメンバー（selectScopedMembers）
//        ＋〔既存PJのタスクなら〕そのPJの参加者（招待受諾者を含む）
//        ＋ 今の担当者（他部署の人でも外さない。候補から消えると選択状態が壊れるため）
// 削除済みメンバーは出さない。名前の解決（id→表示名）にはこの結果ではなく s.members（全件）を使うこと。

import type { Group, Member, Project, Task, TaskProject } from "../localData/types";
import { getAssigneeIds } from "../taskMeta";
import { computeProjectMembers } from "../project/projectMembers";

type ParticipantProject = Pick<Project, "id" | "owner_member_id" | "owner_member_ids" | "member_ids" | "group_ids">;

/**
 * PJの参加者のid集合。定義は visible_project_member_ids()（Section 33）と ProjectSettingsModal の
 * 「関わるメンバー」に揃える：オーナー／projects.member_ids／そのPJのタスク（project_id 直接＋task_projects 経由）の
 * 担当者／そのPJの招待用部署（PJの group_ids のうち is_invite_group=true の部署）に属する人。
 * 集約は computeProjectMembers を再利用する（member_ids は担当者側に混ぜて渡す。役割の区別はここでは使わない）。
 */
export function projectParticipantIds(
  project: ParticipantProject,
  data: { tasks: Task[]; taskProjects: TaskProject[]; members: Member[]; groups: Pick<Group, "id" | "is_invite_group">[] },
): Set<string> {
  const ownerIds = project.owner_member_ids?.length ? project.owner_member_ids : (project.owner_member_id ? [project.owner_member_id] : []);
  const secondaryTaskIds = new Set(data.taskProjects.filter(tp => tp.project_id === project.id).map(tp => tp.task_id));
  const assigneeIds = [...(project.member_ids ?? [])];
  for (const t of data.tasks) {
    if (t.is_deleted) continue;
    if (t.project_id === project.id || secondaryTaskIds.has(t.id)) assigneeIds.push(...getAssigneeIds(t));
  }
  const inviteIds = new Set(data.groups.filter(g => g.is_invite_group).map(g => g.id));
  const projectInviteGroupIds = (project.group_ids ?? []).filter(gid => inviteIds.has(gid));

  const ids = new Set<string>();
  for (const row of computeProjectMembers(data.members, { ownerIds, assigneeIds })) ids.add(row.member.id);
  for (const inviteGroupId of projectInviteGroupIds) {
    for (const row of computeProjectMembers(data.members, { ownerIds: [], assigneeIds: [], inviteGroupId })) ids.add(row.member.id);
  }
  return ids;
}

/** 複数PJの参加者の和集合（AIの確認ダイアログのように、1画面で複数PJのタスクを扱うとき用）。削除済みPJは無視する。 */
export function participantIdsOfProjects(
  projectIds: Iterable<string>,
  data: { projects: (ParticipantProject & { is_deleted?: boolean })[]; tasks: Task[]; taskProjects: TaskProject[]; members: Member[]; groups: Pick<Group, "id" | "is_invite_group">[] },
): Set<string> {
  const ids = new Set<string>();
  for (const pid of new Set(projectIds)) {
    const project = data.projects.find(p => p.id === pid && !p.is_deleted);
    if (!project) continue;
    for (const id of projectParticipantIds(project, data)) ids.add(id);
  }
  return ids;
}

/** 一括の担当者変更：選んだタスクが全部同じPJならそのPJ（参加者を候補に足す）、そうでなければ null。 */
export function sharedProjectId(tasks: Pick<Task, "project_id">[]): string | null {
  const first = tasks[0]?.project_id ?? null;
  if (!first) return null;
  return tasks.every(t => t.project_id === first) ? first : null;
}

/** 並び順：表示部署のメンバー（元の順）→ PJ参加者 → 今の担当者。重複は先勝ち。 */
export function buildAssigneeCandidates(params: {
  allMembers: Member[];
  scopedMembers: Member[];
  participantIds?: ReadonlySet<string> | null;
  currentIds?: readonly string[];
}): Member[] {
  const byId = new Map(params.allMembers.map(m => [m.id, m]));
  const seen = new Set<string>();
  const result: Member[] = [];
  const push = (m: Member | undefined) => {
    if (!m || m.is_deleted || seen.has(m.id)) return;
    seen.add(m.id);
    result.push(m);
  };
  params.scopedMembers.forEach(push);
  if (params.participantIds) {
    for (const m of params.allMembers) if (params.participantIds.has(m.id)) push(m);
  }
  for (const id of params.currentIds ?? []) push(byId.get(id));
  return result;
}
