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
  MemberTag, MemberTagMember,
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
 * 楽観ロック付き保存（TOCTOU 保護版）。
 *
 * 【設計判断 2026-05-12】
 * 以前は呼び出し側 `row.updated_at` をロック値に使う「フォーム時点の updated_at」
 * ベースの真の楽観ロックだった。しかし多数のクライアント側コードが
 * `{ ...originalTask, updated_at: new Date().toISOString() }` のように
 * 送信直前で updated_at を上書きしており、その新しい値を DB の値と比較する
 * 結果として常に不一致 → 100% ConflictError になっていた（AI追加直後のタスク
 * を編集すると自分の操作で衝突する症状）。
 *
 * 修正方針：呼び出し側が渡す `row.updated_at` は無視し、SELECT で取得した
 * DB の現在値を WHERE 句のロック値に使う。
 * - メリット：クライアントが updated_at を誤って上書きしても破綻しない・
 *   連続保存も DB を再 SELECT するので必ず通る
 * - トレードオフ：本当の「フォーム時点」最適化ロックは外れる。SELECT→UPDATE
 *   間の TOCTOU window のみを保護する弱いロックになる。1〜10名規模の運用では
 *   実害なし。本格的なマルチユーザー運用時には引数で `expectedUpdatedAt` を
 *   明示できる API に拡張する余地あり。
 *
 * - id で既存行を確認 → 存在しなければ insert、存在すれば DB-fetched updated_at
 *   一致条件で update
 * - update が 0 件 → ConflictError（SELECT→UPDATE 間に他者が書き込んだ場合）
 */
async function saveWithLock<T extends { id: string }>(
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

  // ロック値は DB の SELECT 結果を使う（クライアントの row.updated_at は信頼しない）
  const expectedUpdatedAt = existing.updated_at as string | null | undefined;

  if (!expectedUpdatedAt) {
    // DB の updated_at が NULL（古い行など）→ ロックなし更新にフォールバック
    const { error } = await supabase.from(table).update({ ...row, updated_at: newUpdatedAt }).eq("id", row.id);
    if (error) throw error;
    return;
  }

  const { data, error } = await supabase
    .from(table)
    .update({ ...row, updated_at: newUpdatedAt })
    .eq("id", row.id)
    .eq("updated_at", expectedUpdatedAt)
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
  const [members, objectives, keyResults, taskForces, todos, projects, tasks, ptf, qObjs, qKrTfs, ttfs, tpjs, milestones, memberTags, memberTagMembers] =
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
      supabase.from("member_tags").select("*").eq("is_deleted", false),
      supabase.from("member_tag_members").select("*"),
    ]);

  // いずれかのテーブルでエラーが発生した場合は例外を投げる
  // member_tags / member_tag_members はマイグレ未適用環境でも他機能が動くよう
  // ここでは throw せず、空配列フォールバック（後段で取り扱う）
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
    memberTags:             (memberTags.data ?? []) as MemberTag[],
    memberTagMembers:       (memberTagMembers.data ?? []) as MemberTagMember[],
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

// ===== MemberTag =====

export async function upsertMemberTag(tag: MemberTag) {
  await saveWithLock("member_tags", tag);
}

export async function softDeleteMemberTag(id: string, deletedBy: string) {
  const now = new Date().toISOString();
  const { error } = await supabase.from("member_tags")
    .update({ is_deleted: true, deleted_at: now, deleted_by: deletedBy, updated_at: now })
    .eq("id", id);
  if (error) throw error;
}

/** タグ ↔ メンバーの紐付けを差し替える（既存削除→一括追加） */
export async function replaceMemberTagMembers(tagId: string, memberIds: string[]) {
  // まず既存リンクを全削除
  const { error: delErr } = await supabase
    .from("member_tag_members")
    .delete()
    .eq("tag_id", tagId);
  if (delErr) throw delErr;
  // 追加リンクを INSERT（空配列ならスキップ）
  if (memberIds.length > 0) {
    const rows = memberIds.map(member_id => ({ tag_id: tagId, member_id }));
    const { error: insErr } = await supabase
      .from("member_tag_members")
      .insert(rows);
    if (insErr) throw insErr;
  }
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
