// src/lib/supabase/store.ts
//
// 【設計意図】
// Supabaseへの全CRUD操作を集約する低レベル関数群。
// AppDataContext経由でのみ呼び出すこと。コンポーネントから直接呼ばない。

import { supabase } from "./client";
import type {
  Member, Objective, KeyResult, TaskForce, ToDo,
  Project, Task, ProjectTaskForce, Milestone,
  QuarterlyObjective, QuarterlyKrTaskForce,
  TaskTaskForce, TaskProject,
} from "../localData/types";

// ===== 全データ一括取得 =====

export async function fetchAllData() {
  const [members, objectives, keyResults, taskForces, todos, projects, tasks, ptf, qObjs, qKrTfs, ttfs, tpjs, milestones] =
    await Promise.all([
      supabase.from("members").select("*"),
      supabase.from("objectives").select("*"),
      supabase.from("key_results").select("*"),
      supabase.from("task_forces").select("*"),
      supabase.from("todos").select("*"),
      supabase.from("projects").select("*"),
      supabase.from("tasks").select("*"),
      supabase.from("project_task_forces").select("*"),
      supabase.from("quarterly_objectives").select("*"),
      supabase.from("quarterly_kr_task_forces").select("*"),
      supabase.from("task_task_forces").select("*"),
      supabase.from("task_projects").select("*"),
      supabase.from("milestones").select("*"),
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
    projects:             (projects.data   ?? []) as Project[],
    tasks:                (tasks.data      ?? []) as Task[],
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
  const { error } = await supabase.from("members").upsert(member);
  if (error) throw error;
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
  const { error } = await supabase.from("objectives").upsert(obj);
  if (error) throw error;
}

// ===== KeyResult =====

export async function upsertKeyResult(kr: KeyResult) {
  const { error } = await supabase.from("key_results").upsert(kr);
  if (error) throw error;
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
  const { error } = await supabase.from("task_forces").upsert(tf);
  if (error) throw error;
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
  // TODO: todos テーブルに name 列を追加するマイグレーション後にこの除外を削除する
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { name: _name, ...row } = todo;
  const { error } = await supabase.from("todos").upsert(row);
  if (error) throw error;
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
  const { error } = await supabase.from("projects").upsert(project);
  if (error) throw error;
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
  const { error } = await supabase.from("tasks").upsert(task);
  if (error) throw error;
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
  const { error } = await supabase.from("quarterly_objectives").upsert(qObj);
  if (error) throw error;
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
  const { error } = await supabase.from("milestones").upsert(milestone);
  if (error) throw error;
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
