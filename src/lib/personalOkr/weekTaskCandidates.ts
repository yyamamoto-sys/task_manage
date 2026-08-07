// src/lib/personalOkr/weekTaskCandidates.ts
//
// 【設計意図】
// 週に紐づけるタスクの「候補」抽出（方式は「自動候補＋明示リンク」＝人が選んで紐づける。
// docs/dev/okr-redesign-plan.md §3-4・§10）。既存の依存関係ロジック（getIncompletePredecessors等・
// CLAUDE.md Section 3-6）は再実装しない——ここは「候補を絞る」だけの役割で、絞った候補の
// 表示（遅延・先行待ち）は呼び出し側（WeekCard等）が既存関数をそのまま使う。
//
// 候補の出し方：本人が担当 かつ 期日がその週の範囲内のタスクを基本とし、その個人KRに
// task_force_id が紐づいている場合はそのTF配下（todos.tf_id経由）のタスクを上位に出す。

import type { Task, ToDo } from "../localData/types";

function isAssignedTo(task: Task, memberId: string): boolean {
  if (task.assignee_member_id === memberId) return true;
  return (task.assignee_member_ids ?? []).includes(memberId);
}

/**
 * 週（weekStart〜weekEnd、"YYYY-MM-DD"）に紐づける候補タスクを返す。
 * TF配下のタスク（personalKrのtask_force_idにToDo経由で属する）を先頭に、期日の昇順で並べる。
 * すでに紐づけ済みのタスク（excludeTaskIds）は候補から除く。
 */
export function computeWeekTaskCandidates(params: {
  tasks: Task[];
  todos: ToDo[];
  weekStart: string;
  weekEnd: string;
  currentMemberId: string;
  taskForceId?: string | null;
  excludeTaskIds?: string[];
}): Task[] {
  const { tasks, todos, weekStart, weekEnd, currentMemberId, taskForceId, excludeTaskIds } = params;
  const excluded = new Set(excludeTaskIds ?? []);
  const tfTodoIds = new Set(
    taskForceId ? todos.filter(td => !td.is_deleted && td.tf_id === taskForceId).map(td => td.id) : [],
  );

  const inRange = tasks.filter(t => {
    if (t.is_deleted || excluded.has(t.id)) return false;
    if (!isAssignedTo(t, currentMemberId)) return false;
    const due = t.due_date;
    if (!due) return false;
    return due >= weekStart && due <= weekEnd;
  });

  const isTfLinked = (t: Task) => (t.todo_ids ?? []).some(id => tfTodoIds.has(id));

  return [...inRange].sort((a, b) => {
    const aRank = isTfLinked(a) ? 0 : 1;
    const bRank = isTfLinked(b) ? 0 : 1;
    if (aRank !== bRank) return aRank - bRank;
    return (a.due_date ?? "").localeCompare(b.due_date ?? "");
  });
}
