// src/lib/task/newTask.ts
//
// 【設計意図】
// 新しいタスクを1件作るときの組み立て（親のPJ追従・並び順の採番・メンション確定・日付の検証）を
// 1箇所に集約する。QuickAddTaskModal（ポップアップ）とリストのその場追加（ListInlineAddRow）の
// 2経路が同じ関数を通ることで、挙動（採番・担当者・project_id の決め方）を揃える。
// 保存（saveTask）はストアの choke point が担う（group_id＝表示部署の注入・変更履歴・
// ゲストのメモリ保存はそちら。CLAUDE.md Section 6-10・57）。ここは保存しない。

import { v4 as uuidv4 } from "uuid";
import type { Task } from "../localData/types";
import { finalizedMentionsOf } from "../mentions";

export interface NewTaskInput {
  name: string;
  projectId: string | null;
  /** 親タスクID。リストのその場追加は常に null（トップレベル） */
  parentId: string | null;
  todoIds: string[];
  assigneeIds: string[];
  status: Task["status"];
  priority: Task["priority"];
  startDate: string;
  dueDate: string;
  comment: string;
  /** 指定があるときだけ Task.tags に載せる（無指定のタスクの形を変えない） */
  tags?: string[];
  updatedBy: string;
}

/** 開始日が期日より後ならメッセージを返す（同日・片方だけ・空は通す）。 */
export function validateTaskDateRange(
  startDate: string | null | undefined,
  dueDate: string | null | undefined,
): string | null {
  if (startDate && dueDate && startDate > dueDate) {
    return "開始日が期日より後になっています。日付を見直してください。";
  }
  return null;
}

/** 同じ project_id かつ同じ親の非削除タスクの最大 display_order + 1（無ければ 0）。 */
export function nextDisplayOrder(tasks: Task[], projectId: string | null, parentId: string | null): number {
  const siblings = tasks.filter(t =>
    !t.is_deleted &&
    (t.project_id ?? null) === projectId &&
    (t.parent_task_id ?? null) === parentId,
  );
  return siblings.length === 0
    ? 0
    : Math.max(...siblings.map(t => t.display_order ?? 0)) + 1;
}

export function prepareNewTask(
  input: NewTaskInput,
  tasks: Task[],
  now: string = new Date().toISOString(),
  id: string = uuidv4(),
): Task {
  // 親を選んだら project_id は親のPJ（候補は選択PJで絞り込み済みなので一致するはず）
  const parent = input.parentId ? tasks.find(t => t.id === input.parentId) : null;
  const projectId = parent ? (parent.project_id ?? null) : input.projectId;
  const comment = input.comment.trim();
  const task: Task = {
    id,
    name: input.name.trim(),
    project_id: projectId,
    parent_task_id: input.parentId || null,
    display_order: nextDisplayOrder(tasks, projectId, input.parentId || null),
    todo_ids: input.todoIds,
    assignee_member_id: input.assigneeIds[0] ?? "",
    assignee_member_ids: input.assigneeIds,
    status: input.status,
    priority: input.priority,
    start_date: input.startDate || null,
    due_date: input.dueDate || null,
    estimated_hours: null,
    comment,
    finalized_mentions: finalizedMentionsOf(comment),
    is_deleted: false,
    created_at: now,
    updated_at: now,
    updated_by: input.updatedBy,
  };
  if (input.tags && input.tags.length > 0) task.tags = input.tags;
  return task;
}
