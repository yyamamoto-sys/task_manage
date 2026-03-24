// src/lib/supabase/store.ts
//
// 【設計意図】
// Supabaseへの全CRUD操作を集約する低レベル関数群。
// AppDataContext経由でのみ呼び出すこと。コンポーネントから直接呼ばない。

import { supabase } from "./client";
import type {
  Member, Objective, KeyResult, TaskForce,
  Project, Task, ProjectTaskForce,
  QuarterlyObjective, QuarterlyKeyResult,
} from "../localData/types";

// ===== 全データ一括取得 =====

export async function fetchAllData() {
  const [members, objectives, keyResults, taskForces, projects, tasks, ptf, qObjs, qKrs] =
    await Promise.all([
      supabase.from("members").select("*"),
      supabase.from("objectives").select("*"),
      supabase.from("key_results").select("*"),
      supabase.from("task_forces").select("*"),
      supabase.from("projects").select("*"),
      supabase.from("tasks").select("*"),
      supabase.from("project_task_forces").select("*"),
      supabase.from("quarterly_objectives").select("*"),
      supabase.from("quarterly_key_results").select("*"),
    ]);

  // いずれかのテーブルでエラーが発生した場合は例外を投げる
  const firstError = [members, objectives, keyResults, taskForces, projects, tasks, ptf, qObjs, qKrs]
    .find(r => r.error)?.error;
  if (firstError) {
    throw new Error(`データの取得に失敗しました: ${firstError.message} (${firstError.code})`);
  }

  return {
    members:              (members.data    ?? []) as Member[],
    objectives:           (objectives.data ?? []) as Objective[],
    keyResults:           (keyResults.data ?? []) as KeyResult[],
    taskForces:           (taskForces.data ?? []) as TaskForce[],
    projects:             (projects.data   ?? []) as Project[],
    tasks:                (tasks.data      ?? []) as Task[],
    projectTaskForces:    (ptf.data        ?? []) as ProjectTaskForce[],
    quarterlyObjectives:  (qObjs.data      ?? []) as QuarterlyObjective[],
    quarterlyKeyResults:  (qKrs.data       ?? []) as QuarterlyKeyResult[],
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

// ===== QuarterlyKeyResult =====

export async function upsertQuarterlyKeyResult(qKr: QuarterlyKeyResult) {
  const { error } = await supabase.from("quarterly_key_results").upsert(qKr);
  if (error) throw error;
}

export async function softDeleteQuarterlyKeyResult(id: string, deletedBy: string) {
  const now = new Date().toISOString();
  const { error } = await supabase.from("quarterly_key_results")
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
