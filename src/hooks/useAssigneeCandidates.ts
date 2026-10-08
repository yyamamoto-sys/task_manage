// src/hooks/useAssigneeCandidates.ts
//
// 担当者ピッカーの候補（lib/members/assigneeCandidates.ts）をストアから組み立てるフック（v3.139・CLAUDE.md Section 71）。
// projectId を渡すと、そのPJの参加者を候補に足す（既存PJのタスクのときだけ渡す）。
// enabled=false の間は計算しない（一覧の各行にあるインライン編集は、開いたときだけ計算すればよいため）。

import { useMemo } from "react";
import { useAppStore, selectScopedMembers } from "../stores/appStore";
import { buildAssigneeCandidates, projectParticipantIds } from "../lib/members/assigneeCandidates";
import type { Member } from "../lib/localData/types";

const EMPTY: Member[] = [];

export function useAssigneeCandidates(
  projectId: string | null | undefined,
  currentIds: readonly string[],
  enabled = true,
): Member[] {
  const allMembers = useAppStore(s => s.members);
  const scopedMembers = useAppStore(selectScopedMembers);
  const projects = useAppStore(s => s.projects);
  const tasks = useAppStore(s => s.tasks);
  const taskProjects = useAppStore(s => s.taskProjects);
  const groups = useAppStore(s => s.groups);

  const participantIds = useMemo(() => {
    if (!enabled || !projectId) return null;
    const project = projects.find(p => p.id === projectId && !p.is_deleted);
    if (!project) return null;
    return projectParticipantIds(project, { tasks, taskProjects, members: allMembers, groups });
  }, [enabled, projectId, projects, tasks, taskProjects, allMembers, groups]);

  const currentKey = currentIds.join(",");
  return useMemo(
    () => (enabled
      ? buildAssigneeCandidates({ allMembers, scopedMembers, participantIds, currentIds: currentKey ? currentKey.split(",") : [] })
      : EMPTY),
    [enabled, allMembers, scopedMembers, participantIds, currentKey],
  );
}
