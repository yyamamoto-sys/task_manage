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
import { getAssigneeIds } from "../taskMeta";
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
 * 楽観ロック付き保存（多人数運用対応版）。
 *
 * 【設計（2026-05-12 多人数対応に再昇格）】
 *
 * 呼び出し側から `expectedUpdatedAt`（フォームをロードした時点の updated_at）を
 * 明示的に受け取り、UPDATE 文の WHERE 句のロック値として使う。これにより：
 * - 「ユーザーAがフォームを開いている間にユーザーBが同じ行を更新したケース」を
 *   ちゃんと検出できる（フォーム時点の本物の楽観ロック）
 * - クライアント側で `row.updated_at` を `new Date()` で誤って上書きしていても
 *   `expectedUpdatedAt` が別パラメータなので影響しない
 *
 * `expectedUpdatedAt` を省略した場合は SELECT で取得した DB の現在値を使う
 * TOCTOU 保護ロックにフォールバックする。フォームを介さない自動更新で使う想定。
 *
 * 戻り値：DB に書き込んだ新しい updated_at（呼び出し側が store を同期できるよう）。
 *
 * - id で既存行を確認 → 存在しなければ insert、存在すれば lockValue 一致条件で update
 * - update が 0 件 → ConflictError（フォーム時点とは違う値が DB にある＝他者が先行更新）
 */
async function saveWithLock<T extends { id: string }>(
  table: string,
  row: T,
  expectedUpdatedAt?: string,
): Promise<string> {
  const newUpdatedAt = new Date().toISOString();

  const { data: existing, error: e1 } = await supabase
    .from(table)
    .select("id,updated_at")
    .eq("id", row.id)
    .maybeSingle();
  if (e1) throw e1;

  if (!existing) {
    // 新規行 → INSERT。ロックチェック不要。
    // BEFORE UPDATE トリガーは INSERT には効かないので、INSERT は実際に書き込んだ
    // 値（クライアントが送った newUpdatedAt）と DB の値が一致する。.select() で
    // 返してきた値を採用しておけば trigger 有無に依らず常に正しい。
    const { data: inserted, error } = await supabase
      .from(table)
      .insert({ ...row, updated_at: newUpdatedAt })
      .select("updated_at")
      .single();
    if (error) throw error;
    return (inserted?.updated_at as string | undefined) ?? newUpdatedAt;
  }

  // ロック値の優先順位：
  // 1. 呼び出し側が明示した expectedUpdatedAt（フォーム時点・本物の楽観ロック）
  // 2. DB の SELECT 結果（TOCTOU フォールバック・呼び出し側が値を握っていない場合）
  const dbCurrent = existing.updated_at as string | null | undefined;
  const lockValue = expectedUpdatedAt ?? dbCurrent ?? null;

  if (!lockValue) {
    // DB の updated_at も NULL（古い行など）→ ロックなし更新フォールバック
    const { data: updated, error } = await supabase
      .from(table)
      .update({ ...row, updated_at: newUpdatedAt })
      .eq("id", row.id)
      .select("updated_at")
      .single();
    if (error) throw error;
    return (updated?.updated_at as string | undefined) ?? newUpdatedAt;
  }

  // 【重要】 BEFORE UPDATE トリガー（schema.sql の trg_*_updated_at）が
  // NEW.updated_at = NOW() で上書きするため、クライアントが送った newUpdatedAt は
  // 実際の DB の値とは異なる。.select("updated_at") で trigger 適用後の実値を
  // 取得して store 同期に使う。
  // （旧コードは newUpdatedAt をそのまま return していたため、次の保存の
  //   expectedUpdatedAt が DB と数 μs ずれて 100% ConflictError になっていた）
  const { data, error } = await supabase
    .from(table)
    .update({ ...row, updated_at: newUpdatedAt })
    .eq("id", row.id)
    .eq("updated_at", lockValue)
    .select("id,updated_at");

  if (error) throw error;
  if (!data || data.length === 0) {
    throw new ConflictError(table, row.id);
  }
  const actualUpdatedAt = data[0].updated_at as string | undefined;
  return actualUpdatedAt ?? newUpdatedAt;
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
      member_ids: Array.isArray(p.member_ids) ? p.member_ids as string[] : [],
    })) as Project[],
    tasks: (tasks.data ?? []).map((t: Record<string, unknown>) => ({
      ...t,
      todo_ids: Array.isArray(t.todo_ids) ? t.todo_ids as string[]
        : t.todo_id ? [t.todo_id as string] : [],
      assignee_member_ids: Array.isArray(t.assignee_member_ids) ? t.assignee_member_ids as string[]
        : t.assignee_member_id ? [t.assignee_member_id as string] : [],
      tags: Array.isArray(t.tags) ? t.tags as string[] : [],
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

export async function upsertMember(member: Member, expectedUpdatedAt?: string): Promise<string> {
  return await saveWithLock("members", member, expectedUpdatedAt);
}

export async function softDeleteMember(id: string, deletedBy: string) {
  const now = new Date().toISOString();
  const { error } = await supabase.from("members")
    .update({ is_deleted: true, deleted_at: now, deleted_by: deletedBy, updated_at: now })
    .eq("id", id);
  if (error) throw error;
}

// ===== Objective =====

export async function upsertObjective(obj: Objective, expectedUpdatedAt?: string): Promise<string> {
  return await saveWithLock("objectives", obj, expectedUpdatedAt);
}

// ===== KeyResult =====

export async function upsertKeyResult(kr: KeyResult, expectedUpdatedAt?: string): Promise<string> {
  return await saveWithLock("key_results", kr, expectedUpdatedAt);
}

export async function softDeleteKeyResult(id: string, deletedBy: string) {
  const now = new Date().toISOString();
  const { error } = await supabase.from("key_results")
    .update({ is_deleted: true, deleted_at: now, deleted_by: deletedBy, updated_at: now })
    .eq("id", id);
  if (error) throw error;
}

// ===== TaskForce =====

export async function upsertTaskForce(tf: TaskForce, expectedUpdatedAt?: string): Promise<string> {
  return await saveWithLock("task_forces", tf, expectedUpdatedAt);
}

export async function softDeleteTaskForce(id: string, deletedBy: string) {
  const now = new Date().toISOString();
  const { error } = await supabase.from("task_forces")
    .update({ is_deleted: true, deleted_at: now, deleted_by: deletedBy, updated_at: now })
    .eq("id", id);
  if (error) throw error;
}

// ===== ToDo =====

export async function upsertToDo(todo: ToDo, expectedUpdatedAt?: string): Promise<string> {
  return await saveWithLock("todos", todo, expectedUpdatedAt);
}

export async function softDeleteToDo(id: string, deletedBy: string) {
  const now = new Date().toISOString();
  const { error } = await supabase.from("todos")
    .update({ is_deleted: true, deleted_at: now, deleted_by: deletedBy, updated_at: now })
    .eq("id", id);
  if (error) throw error;
}

// ===== Project =====

export async function upsertProject(project: Project, expectedUpdatedAt?: string): Promise<string> {
  // owner_member_ids は UI 専用フィールド（DB カラム不存在）のため除外する
  // 空文字の日付は PostgreSQL date 型が拒否するため null に変換する
  const { owner_member_ids: _omit, ...rest } = project;
  const row = {
    ...rest,
    start_date: project.start_date || null,
    end_date:   project.end_date   || null,
  };
  return await saveWithLock("projects", row, expectedUpdatedAt);
}

export async function softDeleteProject(id: string, deletedBy: string) {
  const now = new Date().toISOString();
  const { error } = await supabase.from("projects")
    .update({ is_deleted: true, deleted_at: now, deleted_by: deletedBy, updated_at: now })
    .eq("id", id);
  if (error) throw error;
}

// ===== Task =====

export async function upsertTask(task: Task, expectedUpdatedAt?: string): Promise<string> {
  // todo_ids は UI専用（DB は todo_id 単数FK）のため変換する
  // assignee_member_ids は DB の配列カラムにそのまま保存し、
  // 後方互換のため先頭要素を assignee_member_id（単数FK）にも反映する
  const { todo_ids, ...rest } = task;
  const ids = getAssigneeIds(task);
  const row = {
    ...rest,
    todo_id: todo_ids[0] ?? null,
    assignee_member_id:  ids[0] ?? null,
    assignee_member_ids: ids,
  };
  return await saveWithLock("tasks", row, expectedUpdatedAt);
}

export async function softDeleteTask(id: string, deletedBy: string) {
  const now = new Date().toISOString();
  const { error } = await supabase.from("tasks")
    .update({ is_deleted: true, deleted_at: now, deleted_by: deletedBy, updated_at: now })
    .eq("id", id);
  if (error) throw error;
}

// ===== QuarterlyObjective =====

export async function upsertQuarterlyObjective(qObj: QuarterlyObjective, expectedUpdatedAt?: string): Promise<string> {
  return await saveWithLock("quarterly_objectives", qObj, expectedUpdatedAt);
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

export async function upsertMilestone(milestone: Milestone, expectedUpdatedAt?: string): Promise<string> {
  return await saveWithLock("milestones", milestone, expectedUpdatedAt);
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

export async function upsertMemberTag(tag: MemberTag, expectedUpdatedAt?: string): Promise<string> {
  return await saveWithLock("member_tags", tag, expectedUpdatedAt);
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
