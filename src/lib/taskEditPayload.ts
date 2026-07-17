// src/lib/taskEditPayload.ts
//
// TaskEditModal のフォーム状態からDB保存用の Task ペイロードを組み立てる純粋関数。
// autosave（デバウンス発火時）と、閉じる操作時のフラッシュ保存（TaskEditModal.tsx の
// handleClose）の両方から呼ばれる、フィールド組み立てロジックの単一の真実源。
// ここを2箇所に重複実装すると、片方だけ直して挙動がズレる事故になるため分離した。

import type { Task } from "./localData/types";

export interface TaskEditFormState {
  name: string;
  status: Task["status"];
  priority: string;
  assignee_member_ids: string[];
  project_id: string | null;
  parent_task_id: string | null;
  start_date: string;
  due_date: string;
  estimated_hours: string;
  comment: string;
  tags: string[];
}

/**
 * フォーム内容から保存用 Task を組み立てる。
 * - 親タスクを設定している場合、project_id は親のPJに合わせる（不一致防止）。
 * - display_order・updated_at 等は originalTask の値を引き継ぎ、ここでは触らない
 *   （updated_at は呼び出し側の saveTask/saveWithLock が expectedUpdatedAt として扱う）。
 */
export function buildTaskUpdatePayload(
  originalTask: Task,
  form: TaskEditFormState,
  parentTask: Task | null | undefined,
  currentUserId: string,
): Task {
  const hours = parseFloat(form.estimated_hours);
  const effectiveProjectId = parentTask ? (parentTask.project_id ?? null) : (form.project_id || null);
  return {
    ...originalTask,
    name:                form.name.trim() || originalTask.name,
    status:              form.status,
    priority:            (form.priority as Task["priority"]) || null,
    assignee_member_ids: form.assignee_member_ids,
    assignee_member_id:  form.assignee_member_ids[0] ?? "",
    project_id:          effectiveProjectId,
    parent_task_id:      form.parent_task_id || null,
    start_date:          form.start_date || null,
    due_date:            form.due_date || null,
    estimated_hours:     isNaN(hours) ? null : hours,
    comment:             form.comment,
    tags:                form.tags,
    updated_by:          currentUserId,
  };
}
