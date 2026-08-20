// src/lib/taskEditPayload.ts
//
// TaskEditModal・TaskSidePanel のフォーム状態からDB保存用の Task ペイロードを組み立てる
// 純粋関数。autosave（デバウンス発火時）と、閉じる操作時のフラッシュ保存の両方から呼ばれる、
// フィールド組み立てロジックの単一の真実源。
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
  // TaskSidePanel にはタグ編集UIが無いため省略可能にしてある。省略時は originalTask.tags を
  // そのまま維持する（サイドパネル経由の保存でタグが消えないようにするため）。
  tags?: string[];
}

/**
 * フォーム内容から保存用 Task を組み立てる。
 * - 親タスクを設定している場合、project_id は親のPJに合わせる（不一致防止）。
 * - display_order・updated_at 等は originalTask の値を引き継ぎ、ここでは触らない
 *   （updated_at は呼び出し側の saveTask/saveWithLock が expectedUpdatedAt として扱う）。
 */
/**
 * 現在のフォーム内容が baseline（最後に保存した内容、またはフォームを開いた時点の内容）と
 * 異なるか＝dirty判定（v3.87・明示保存への変更に伴い新設）。
 * 参照の同一性ではなく値そのものを比較する（オブジェクトを毎回作り直すReact stateの都合上、
 * 参照比較だと常にdirty扱いになってしまう罠を避けるため）。
 * 配列（担当者・タグ）は順序を無視した集合比較にする（並び替え自体は保存内容の意味を
 * 変えないため、順序差だけで「変更あり」と誤検知しない）。
 */
export function computeFormDirty(current: TaskEditFormState, baseline: TaskEditFormState): boolean {
  if (current.name !== baseline.name) return true;
  if (current.status !== baseline.status) return true;
  if (current.priority !== baseline.priority) return true;
  if (current.project_id !== baseline.project_id) return true;
  if (current.parent_task_id !== baseline.parent_task_id) return true;
  if (current.start_date !== baseline.start_date) return true;
  if (current.due_date !== baseline.due_date) return true;
  if (current.estimated_hours !== baseline.estimated_hours) return true;
  if (current.comment !== baseline.comment) return true;
  if (!sameStringSet(current.assignee_member_ids, baseline.assignee_member_ids)) return true;
  if (!sameStringSet(current.tags ?? [], baseline.tags ?? [])) return true;
  return false;
}

function sameStringSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  for (const x of a) if (!setB.has(x)) return false;
  return true;
}

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
    tags:                form.tags ?? originalTask.tags,
    updated_by:          currentUserId,
  };
}
