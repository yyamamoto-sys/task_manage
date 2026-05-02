// src/lib/supabase/store.ts
//
// 【設計意図】
// Supabaseへの全CRUD操作を集約する低レベル関数群。
// AppDataContext経由でのみ呼び出すこと。コンポーネントから直接呼ばない。
//
// 【楽観ロック (CLAUDE.md Section 5)】
// 主要エンティティの upsert は saveWithLock 経由で updated_at を比較し、
// 他者が同時編集していた場合は ConflictError を投げる。

import { supabase } from "./client";
import type {
  Member, Objective, KeyResult, TaskForce, ToDo,
  Project, Task, ProjectTaskForce, Milestone,
  QuarterlyObjective, QuarterlyKrTaskForce,
  TaskTaskForce, TaskProject,
} from "../localData/types";

// ===== 競合エラー =====

export class ConflictError extends Error {
  table: string;
  id: string;
  constructor(table: string, id: string) {
    super(`他のユーザーが先に「${table}」を変更しました (${id})`);
    this.name = "ConflictError";
    this.table = table;
    this.id = id;
  }
}

/**
 * 楽観ロック付き保存。
 * - id で既存行を確認 → 存在しなければ insert、存在すれば updated_at 一致条件で update
 * - update が 0 件 → ConflictError（他のユーザーによる先行変更）
 * - update に成功すれば updated_at は DB トリガーで NOW() に置き換わる
 */
async function saveWithLock<T extends { id: string; updated_at?: unknown }>(
  table: string,
  row: T,
): Promise<void> {
  const newUpdatedAt = new Date().toISOString();

  const { data: existing, error: e1 } = await supabase
    .from(table)
    .select("id,updated_at")
    .eq("id", row.id)
    .maybeSingle();
  if (e1) throw e1;

  if (!existing) {
    const insertRow = { ...row, updated_at: newUpdatedAt };
    const { error } = await supabase.from(table).insert(insertRow);
    if (error) throw error;
    return;
  }

  // 楽観ロック：呼び出し側が握っていた updated_at と DB の現状が一致する場合のみ更新
  const original = row.updated_at instanceof Date
    ? row.updated_at.toISOString()
    : (typeof row.updated_at === "string" ? row.updated_at : null);

  if (!original) {
    // クライアントが updated_at を持っていない（フォーム新規入力など）
    // → ロックなし更新にフォールバック
    const { error } = await supabase.from(table).update({ ...row, updated_at: newUpdatedAt }).eq("id", row.id);
    if (error) throw error;
    return;
  }

  const { data, error } = await supabase
    .from(table)
    .update({ ...row, updated_at: newUpdatedAt })
    .eq("id", row.id)
    .eq("updated_at", original)
    .select("id");

  if (error) throw error;
  if (!data || data.length === 0) {
    throw new ConflictError(table, row.id);
  }
}

// ===== 全データ一括取得 =====

/**
 * 【設計意図】
 * 論理削除済み行はサーバー側で除外する。クライアント側にダウンロードしてから
 * `filter(x => !x.is_deleted)` していたが、データ量が増えると無駄な転送・JS フィルタになる。
 * 「削除済みを参照する UI」は現状ないため、サーバーで弾いて問題ない。
 * junction テーブル（*_task_forces / task_projects）には is_deleted カラムが無いため除外フィルタは入れない。
 */
export async function fetchAllData() {
  const [members, objectives, keyResults, taskForces, todos, projects, tasks, ptf, qObjs, qKrTfs, ttfs, tpjs, milestones] =
    await Promise.all([
      supabase.from("members").select("*").eq("is_deleted", false),
      supabase.from("objectives").select("*"),
      supabase.from("key_results").select("*").eq("is_deleted", false),
      supabase.from("task_forces").select("*").eq("is_deleted", false),
      supabase.from("todos").select("*").eq("is_deleted", false),
      supabase.from("projects").select("*").eq("is_deleted", false),
      supabase.from("tasks").select("*").eq("is_deleted", false),
      supabase.from("project_task_forces").select("*"),
      supabase.from("quarterly_objectives").select("*").eq("is_deleted", false),
      supabase.from("quarterly_kr_task_forces").select("*"),
      supabase.from("task_task_forces").select("*"),
      supabase.from("task_projects").select("*"),
      supabase.from("milestones").select("*").eq("is_deleted", false),
    ]);

  // いずれかのテーブルでエラーが発生した場合は例外を投げる
  const firstError = [members, objectives, keyResults, taskForces, todos, projects, tasks, ptf, qObjs]
    .find(r => r.error)?.error;
  if (firstError) {
    throw new Error(`データの取得に失敗しました: ${firstError.message} (${firstError.code})`);
  }

  return {
    members:              (members.data    ?? []) as Member[],
    objectives:           (objectives.data ?? []) as Objective[],
    keyResults:           (keyResults.data ?? []) as KeyResult[],
    taskForces:           (taskForces.data ?? []) as TaskForce[],
    todos:                (todos.data      ?? []) as ToDo[],
    projects: (projects.data ?? []).map((p: Record<string, unknown>) => ({
      ...p,
      owner_member_ids: (p.owner_member_ids as string[] | undefined)?.length
        ? p.owner_member_ids as string[]
        : p.owner_member_id ? [p.owner_member_id as string] : [],
    })) as Project[],
    tasks: (tasks.data ?? []).map((t: Record<string, unknown>) => ({
      ...t,
      todo_ids: Array.isArray(t.todo_ids) ? t.todo_ids as string[]
        : t.todo_id ? [t.todo_id as string] : [],
      assignee_member_ids: Array.isArray(t.assignee_member_ids) ? t.assignee_member_ids as string[]
        : t.assignee_member_id ? [t.assignee_member_id as string] : [],
    })) as Task[],
    projectTaskForces:    (ptf.data        ?? []) as ProjectTaskForce[],
    quarterlyObjectives:    (qObjs.data  ?? []) as QuarterlyObjective[],
    quarterlyKrTaskForces:  (qKrTfs.data ?? []) as QuarterlyKrTaskForce[],
    taskTaskForces:         (ttfs.data   ?? []) as TaskTaskForce[],
    taskProjects:           (tpjs.data   ?? []) as TaskProject[],
    milestones:             (milestones.data ?? []) as Milestone[],
  };
}

// ===== Member =====

export async function upsertMember(member: Member) {
  await saveWithLock("members", member);
}

export async function softDeleteMember(id: string, deletedBy: string) {
  const now = new Date().toISOString();
  const { error } = await supabase.from("members")
    .update({ is_deleted: true, deleted_at: now, deleted_by: deletedBy, updated_at: now })
    .eq("id", id);
  if (error) throw error;
}

// ===== Objective =====

export async function upsertObjective(obj: Objective) {
  await saveWithLock("objectives", obj);
}

// ===== KeyResult =====

export async function upsertKeyResult(kr: KeyResult) {
  await saveWithLock("key_results", kr);
}

export async function softDeleteKeyResult(id: string, deletedBy: string) {
  const now = new Date().toISOString();
  const { error } = await supabase.from("key_results")
    .update({ is_deleted: true, deleted_at: now, deleted_by: deletedBy, updated_at: now })
    .eq("id", id);
  if (error) throw error;
}

// ===== TaskForce =====

export async function upsertTaskForce(tf: TaskForce) {
  await saveWithLock("task_forces", tf);
}

export async function softDeleteTaskForce(id: string, deletedBy: string) {
  const now = new Date().toISOString();
  const { error } = await supabase.from("task_forces")
    .update({ is_deleted: true, deleted_at: now, deleted_by: deletedBy, updated_at: now })
    .eq("id", id);
  if (error) throw error;
}

// ===== ToDo =====

export async function upsertToDo(todo: ToDo) {
  await saveWithLock("todos", todo);
}

export async function softDeleteToDo(id: string, deletedBy: string) {
  const now = new Date().toISOString();
  const { error } = await supabase.from("todos")
    .update({ is_deleted: true, deleted_at: now, deleted_by: deletedBy, updated_at: now })
    .eq("id", id);
  if (error) throw error;
}

// ===== Project =====

export async function upsertProject(project: Project) {
  // owner_member_ids は UI 専用フィールド（DB カラム不存在）のため除外する
  // 空文字の日付は PostgreSQL date 型が拒否するため null に変換する
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { owner_member_ids: _omit, ...rest } = project;
  const row = {
    ...rest,
    start_date: project.start_date || null,
    end_date:   project.end_date   || null,
  };
  await saveWithLock("projects", row);
}

export async function softDeleteProject(id: string, deletedBy: string) {
  const now = new Date().toISOString();
  const { error } = await supabase.from("projects")
    .update({ is_deleted: true, deleted_at: now, deleted_by: deletedBy, updated_at: now })
    .eq("id", id);
  if (error) throw error;
}

// ===== Task =====

export async function upsertTask(task: Task) {
  // todo_ids は UI専用（DB は todo_id 単数FK）のため変換する
  // assignee_member_ids は DB の配列カラムにそのまま保存し、
  // 後方互換のため先頭要素を assignee_member_id（単数FK）にも反映する
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { todo_ids, ...rest } = task;
  const ids = task.assignee_member_ids?.length
    ? task.assignee_member_ids
    : task.assignee_member_id ? [task.assignee_member_id] : [];
  const row = {
    ...rest,
    todo_id: todo_ids[0] ?? null,
    assignee_member_id:  ids[0] ?? null,
    assignee_member_ids: ids,
  };
  await saveWithLock("tasks", row);
}

export async function softDeleteTask(id: string, deletedBy: string) {
  const now = new Date().toISOString();
  const { error } = await supabase.from("tasks")
    .update({ is_deleted: true, deleted_at: now, deleted_by: deletedBy, updated_at: now })
    .eq("id", id);
  if (error) throw error;
}

// ===== QuarterlyObjective =====

export async function upsertQuarterlyObjective(qObj: QuarterlyObjective) {
  await saveWithLock("quarterly_objectives", qObj);
}

export async function softDeleteQuarterlyObjective(id: string, deletedBy: string) {
  const now = new Date().toISOString();
  const { error } = await supabase.from("quarterly_objectives")
    .update({ is_deleted: true, deleted_at: now, deleted_by: deletedBy, updated_at: now })
    .eq("id", id);
  if (error) throw error;
}

// ===== QuarterlyKrTaskForce =====

export async function insertQuarterlyKrTaskForce(qKrTf: QuarterlyKrTaskForce) {
  const { error } = await supabase.from("quarterly_kr_task_forces").insert(qKrTf);
  if (error) throw error;
}

export async function deleteQuarterlyKrTaskForce(quarterlyObjId: string, krId: string, tfId: string) {
  const { error } = await supabase.from("quarterly_kr_task_forces")
    .delete()
    .eq("quarterly_objective_id", quarterlyObjId)
    .eq("kr_id", krId)
    .eq("tf_id", tfId);
  if (error) throw error;
}

// ===== TaskTaskForce =====

export async function insertTaskTaskForce(ttf: TaskTaskForce) {
  const { error } = await supabase.from("task_task_forces").insert(ttf);
  if (error) throw error;
}

export async function deleteTaskTaskForce(taskId: string, tfId: string) {
  const { error } = await supabase.from("task_task_forces")
    .delete().eq("task_id", taskId).eq("tf_id", tfId);
  if (error) throw error;
}

// ===== TaskProject =====

export async function insertTaskProject(tp: TaskProject) {
  const { error } = await supabase.from("task_projects").insert(tp);
  if (error) throw error;
}

export async function deleteTaskProject(taskId: string, projectId: string) {
  const { error } = await supabase.from("task_projects")
    .delete().eq("task_id", taskId).eq("project_id", projectId);
  if (error) throw error;
}

// ===== Milestone =====

export async function upsertMilestone(milestone: Milestone) {
  await saveWithLock("milestones", milestone);
}

export async function softDeleteMilestone(id: string, deletedBy: string) {
  const now = new Date().toISOString();
  const { error } = await supabase.from("milestones")
    .update({ is_deleted: true, deleted_at: now, deleted_by: deletedBy, updated_at: now })
    .eq("id", id);
  if (error) throw error;
}

// ===== ProjectTaskForce =====

export async function insertProjectTaskForce(ptf: ProjectTaskForce) {
  const { error } = await supabase.from("project_task_forces").insert(ptf);
  if (error) throw error;
}

export async function deleteProjectTaskForce(projectId: string, tfId: string) {
  const { error } = await supabase.from("project_task_forces")
    .delete()
    .eq("project_id", projectId)
    .eq("tf_id", tfId);
  if (error) throw error;
}

// ===== AI使用量ログ =====

export interface AiUsageLog {
  id?: string;
  called_at?: string;
  member_id: string;
  consultation_type: string;
  input_tokens: number;
  output_tokens: number;
}

export async function insertAiUsageLog(log: Omit<AiUsageLog, "id" | "called_at">) {
  const { error } = await supabase.from("ai_usage_logs").insert(log);
  if (error) throw error;
}

export async function fetchAiUsageLogs(): Promise<AiUsageLog[]> {
  const { data, error } = await supabase
    .from("ai_usage_logs")
    .select("*")
    .order("called_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as AiUsageLog[];
}
