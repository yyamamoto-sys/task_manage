// src/lib/ai/applyProposal.ts
//
// 【設計意図】
// UIProposalをDBに反映する関数群。
// CLAUDE.md Section 6-10のDB操作ルールに従う：
// - date_change / assignee → needs_confirmationを返す（DBは触らない）
// - risk / no_tasks / deadline_risk → タスクのcommentに追記（SELECT+UPDATE、rpcは使わない）
// - scope_reduce / pause → 論理削除（is_deleted=true）
// - milestone → errorを返す
//
// ❌ 物理削除は絶対に行わない（CLAUDE.md Section 4参照）

import { supabase } from "../supabase/client";
import type { UIProposal } from "./proposalMapper";
import type { UndoSnapshot, UndoOperation } from "../../hooks/useUndoStack";

// ===== 型定義 =====

export type ApplyResult =
  | { type: "success"; snapshot: UndoSnapshot }
  | { type: "needs_confirmation"; dialog: ConfirmationDialog }
  | { type: "error"; message: string };

// ===== UndoSnapshot生成ヘルパー =====

/**
 * ランダムなUUIDを生成する（crypto.randomUUID が使えない環境向けのフォールバック付き）
 */
function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * action_typeとタスク数からsnapshotのlabelを生成する
 */
function buildSnapshotLabel(actionType: UIProposal["action_type"], taskCount: number, pjCount: number): string {
  const suffix = taskCount > 0 && pjCount > 0
    ? `(${taskCount}タスク, ${pjCount}PJ)`
    : taskCount > 0
      ? `(${taskCount}タスク)`
      : `(${pjCount}PJ)`;

  switch (actionType) {
    case "date_change":     return `日程変更 ${suffix}`;
    case "assignee":        return `担当者変更 ${suffix}`;
    case "risk":            return `リスク追記 ${suffix}`;
    case "no_tasks":        return `タスクなし追記 ${suffix}`;
    case "deadline_risk":   return `期限リスク追記 ${suffix}`;
    case "scope_reduce":    return `スコープ縮小 ${suffix}`;
    case "pause":           return `一時停止 ${suffix}`;
    default:                return `変更 ${suffix}`;
  }
}

export interface ConfirmationDialog {
  proposal_id: string;
  action_type: "date_change" | "assignee" | "scope_reduce" | "pause";
  items: ConfirmationItem[];
  /** date_change 用：プロジェクト終了日の変更 */
  pj_end_date_items?: PjEndDateItem[];
  /** date_change 用：一括シフト日数（「全て+N日」ボタン用） */
  shift_days?: number;
  /** scope_reduce / pause 用：削除対象のPJ UUID一覧 */
  target_pj_uuids?: string[];
  /** scope_reduce / pause 用：削除対象のタスク UUID一覧 */
  target_task_uuids?: string[];
}

export interface ConfirmationItem {
  task_id: string;     // UUID
  task_name: string;
  current_value: string;
  suggested_value: string;
}

export interface PjEndDateItem {
  pj_id: string;       // UUID
  pj_name: string;
  current_end_date: string | null;
  suggested_end_date: string;
}

// ===== 内部ヘルパー =====

/**
 * タスクのcommentに追記する（2ステップSELECT+UPDATE）。
 * rpcは使わない（CLAUDE.md Section 6-10参照）。
 * 戻り値：更新前のcomment文字列（Undo用）
 */
async function appendTaskComment(
  taskId: string,
  appendText: string,
  currentUserId: string,
): Promise<string> {
  // Step 1: 現在のcommentを取得
  const { data: taskData, error: fetchError } = await supabase
    .from("tasks")
    .select("comment, updated_at")
    .eq("id", taskId)
    .single();

  if (fetchError) {
    throw new Error(`タスク取得エラー: ${fetchError.message}`);
  }

  const currentComment = (taskData?.comment as string) ?? "";
  const originalUpdatedAt = taskData?.updated_at as string;
  const timestamp = new Date().toLocaleDateString("ja-JP");
  const newComment = currentComment
    ? `${currentComment}\n\n[AIアドバイス ${timestamp}]\n${appendText}`
    : `[AIアドバイス ${timestamp}]\n${appendText}`;

  // Step 2: 競合制御付きでコメントを更新（CLAUDE.md Section 5）
  // Step 1 取得時の updated_at と一致する場合のみ更新する
  const now = new Date().toISOString();
  const { data: updated, error: updateError } = await supabase
    .from("tasks")
    .update({
      comment: newComment,
      updated_at: now,
      updated_by: currentUserId,
    })
    .eq("id", taskId)
    .eq("updated_at", originalUpdatedAt)
    .select("id");

  if (updateError) {
    throw new Error(`タスク更新エラー: ${updateError.message}`);
  }

  // 0件更新 = 他のユーザーが先に更新した（競合）
  if (!updated || updated.length === 0) {
    throw new Error(`タスクが他のユーザーによって更新されています。最新の内容を確認してから再度お試しください。`);
  }

  // Undo用に更新前のcommentを返す
  return currentComment;
}

/**
 * shortIdMap を使って shortId から UUID に変換する。
 */
function resolveUUID(shortId: string, shortIdMap: Map<string, string>): string | null {
  return shortIdMap.get(shortId) ?? null;
}

// ===== メイン関数 =====

/**
 * UIProposalをDBに反映する。
 * needs_confirmationの場合はConfirmationDialogを返す（DBは触らない）。
 *
 * @param proposal - 反映する提案
 * @param shortIdMap - shortId→UUIDの変換マップ（payloadBuilderが生成）
 * @param currentUserId - 操作者のメンバーID
 */
export async function applyProposal(
  proposal: UIProposal,
  shortIdMap: Map<string, string>,
  currentUserId: string,
): Promise<ApplyResult> {
  const { action_type } = proposal;

  // ===== info: 情報表示のみ（DBへの反映なし）=====
  if (action_type === "info") {
    return { type: "error", message: "情報カードには反映操作はありません" };
  }

  // ===== milestone: 未対応 =====
  if (action_type === "milestone") {
    return { type: "error", message: "マイルストーンは未対応です" };
  }

  // ===== date_change: 確認ダイアログを返す =====
  if (action_type === "date_change") {
    const items: ConfirmationItem[] = [];
    const pjEndDateItems: PjEndDateItem[] = [];

    // タスクの期日変更
    for (const shortId of proposal.target_task_ids) {
      const uuid = resolveUUID(shortId, shortIdMap);
      if (!uuid) continue;

      const { data: task } = await supabase
        .from("tasks")
        .select("id, name, due_date")
        .eq("id", uuid)
        .single();

      if (!task) continue;

      // shift_days が指定されている場合は現在の期日に日数を加算、なければ suggested_date を使う
      let suggestedValue = proposal.suggested_date ?? "未定";
      if (proposal.shift_days && task.due_date) {
        const d = new Date(task.due_date as string);
        d.setDate(d.getDate() + proposal.shift_days);
        suggestedValue = d.toISOString().split("T")[0];
      }

      items.push({
        task_id: uuid,
        task_name: (task.name as string) ?? shortId,
        current_value: (task.due_date as string) ?? "未設定",
        suggested_value: suggestedValue,
      });
    }

    // プロジェクトの終了日変更
    for (const shortId of proposal.target_pj_ids) {
      const uuid = resolveUUID(shortId, shortIdMap);
      if (!uuid) continue;

      const { data: pj } = await supabase
        .from("projects")
        .select("id, name, end_date")
        .eq("id", uuid)
        .single();

      if (!pj) continue;

      let suggestedEndDate = proposal.suggested_end_date ?? "";
      if (proposal.shift_days && pj.end_date) {
        const d = new Date(pj.end_date as string);
        d.setDate(d.getDate() + proposal.shift_days);
        suggestedEndDate = d.toISOString().split("T")[0];
      }

      pjEndDateItems.push({
        pj_id: uuid,
        pj_name: (pj.name as string) ?? shortId,
        current_end_date: (pj.end_date as string) ?? null,
        suggested_end_date: suggestedEndDate,
      });
    }

    if (items.length === 0 && pjEndDateItems.length === 0) {
      return { type: "error", message: "対象タスク・プロジェクトが見つかりませんでした" };
    }

    return {
      type: "needs_confirmation",
      dialog: {
        proposal_id: proposal.proposal_id,
        action_type: "date_change",
        items,
        pj_end_date_items: pjEndDateItems.length > 0 ? pjEndDateItems : undefined,
        shift_days: proposal.shift_days,
      },
    };
  }

  // ===== assignee: 確認ダイアログを返す =====
  if (action_type === "assignee") {
    if (!proposal.suggested_assignee) {
      return { type: "error", message: "担当者が指定されていません" };
    }

    const items: ConfirmationItem[] = [];

    for (const shortId of proposal.target_task_ids) {
      const uuid = resolveUUID(shortId, shortIdMap);
      if (!uuid) continue;

      const { data: task } = await supabase
        .from("tasks")
        .select("id, name, assignee_member_id")
        .eq("id", uuid)
        .single();

      if (!task) continue;

      // 現在の担当者名を取得
      let currentAssigneeName = "未担当";
      if (task.assignee_member_id) {
        const { data: member } = await supabase
          .from("members")
          .select("short_name")
          .eq("id", task.assignee_member_id as string)
          .single();
        if (member) {
          currentAssigneeName = (member.short_name as string) ?? "不明";
        }
      }

      items.push({
        task_id: uuid,
        task_name: (task.name as string) ?? shortId,
        current_value: currentAssigneeName,
        suggested_value: proposal.suggested_assignee,
      });
    }

    if (items.length === 0) {
      return { type: "error", message: "対象タスクが見つかりませんでした" };
    }

    return {
      type: "needs_confirmation",
      dialog: {
        proposal_id: proposal.proposal_id,
        action_type: "assignee",
        items,
      },
    };
  }

  // ===== risk / no_tasks / deadline_risk: コメントに追記 =====
  if (
    action_type === "risk" ||
    action_type === "no_tasks" ||
    action_type === "deadline_risk"
  ) {
    try {
      const operations: UndoOperation[] = [];
      for (const shortId of proposal.target_task_ids) {
        const uuid = resolveUUID(shortId, shortIdMap);
        if (!uuid) continue;
        const oldComment = await appendTaskComment(uuid, proposal.description, currentUserId);
        operations.push({ type: "task_field", taskId: uuid, field: "comment", oldValue: oldComment || null });
      }
      const snapshot: UndoSnapshot = {
        id: generateId(),
        label: buildSnapshotLabel(action_type, operations.length, 0),
        appliedAt: new Date().toISOString(),
        operations,
      };
      return { type: "success", snapshot };
    } catch (e) {
      return {
        type: "error",
        message: e instanceof Error ? e.message : "コメント追記に失敗しました",
      };
    }
  }

  // ===== scope_reduce / pause: 確認ダイアログを返す（CLAUDE.md Section 6-9参照）=====
  // 論理削除は不可逆な大規模操作のため、必ず確認ダイアログを経由する。
  // 実際の論理削除は applyProposalWithConfirmation で実行する。
  if (action_type === "scope_reduce" || action_type === "pause") {
    const taskUuids: string[] = [];
    const pjUuids: string[] = [];
    const items: ConfirmationItem[] = [];

    for (const shortId of proposal.target_task_ids) {
      const uuid = resolveUUID(shortId, shortIdMap);
      if (!uuid) continue;

      const { data: task } = await supabase
        .from("tasks")
        .select("id, name")
        .eq("id", uuid)
        .single();

      if (!task) continue;
      taskUuids.push(uuid);
      items.push({
        task_id: uuid,
        task_name: (task.name as string) ?? shortId,
        current_value: "有効",
        suggested_value: action_type === "pause" ? "一時停止" : "スコープ縮小（論理削除）",
      });
    }

    for (const shortId of proposal.target_pj_ids) {
      const uuid = resolveUUID(shortId, shortIdMap);
      if (!uuid) continue;

      const { data: pj } = await supabase
        .from("projects")
        .select("id, name")
        .eq("id", uuid)
        .single();

      if (!pj) continue;
      pjUuids.push(uuid);
      items.push({
        task_id: uuid, // PJ UUIDをここに入れる（ConfirmationItemはtask_idフィールドを流用）
        task_name: `[PJ] ${(pj.name as string) ?? shortId}`,
        current_value: "有効",
        suggested_value: action_type === "pause" ? "一時停止（配下タスクも含む）" : "スコープ縮小（配下タスクも含む）",
      });
    }

    if (items.length === 0) {
      return { type: "error", message: "対象タスク・プロジェクトが見つかりませんでした" };
    }

    return {
      type: "needs_confirmation",
      dialog: {
        proposal_id: proposal.proposal_id,
        action_type,
        items,
        target_pj_uuids: pjUuids,
        target_task_uuids: taskUuids,
      },
    };
  }

  return { type: "error", message: "未対応のアクションタイプです" };
}

/**
 * 確認ダイアログでユーザーが内容を確認・調整した後にDBへ反映する。
 * CLAUDE.md Section 6-11に従い、shortIdMapは引数に含めない（confirmedValuesのキーはUUID）。
 *
 * @param dialog - applyProposalが返したConfirmationDialog
 * @param confirmedValues - key: UUID, value: 新しい値（日付またはメンバーID）
 * @param currentUserId - 操作者のメンバーID
 */
export async function applyProposalWithConfirmation(
  dialog: ConfirmationDialog,
  confirmedValues: Record<string, string>,
  currentUserId: string,
): Promise<ApplyResult> {
  try {
    const now = new Date().toISOString();

    if (dialog.action_type === "date_change") {
      const operations: UndoOperation[] = [];

      // タスクの期日更新
      for (const item of dialog.items) {
        const newDate = confirmedValues[item.task_id];
        if (!newDate) continue;

        const { data: taskData } = await supabase
          .from("tasks")
          .select("due_date")
          .eq("id", item.task_id)
          .single();
        const oldDueDate = (taskData?.due_date as string) ?? null;

        const { error } = await supabase
          .from("tasks")
          .update({ due_date: newDate, updated_at: now, updated_by: currentUserId })
          .eq("id", item.task_id);

        if (error) throw new Error(`日程更新エラー (${item.task_name}): ${error.message}`);
        operations.push({ type: "task_field", taskId: item.task_id, field: "due_date", oldValue: oldDueDate });
      }

      // プロジェクト終了日の更新
      for (const pjItem of dialog.pj_end_date_items ?? []) {
        const newEndDate = confirmedValues[pjItem.pj_id];
        if (!newEndDate) continue;

        const { data: pjData } = await supabase
          .from("projects")
          .select("end_date")
          .eq("id", pjItem.pj_id)
          .single();
        const oldEndDate = (pjData?.end_date as string) ?? null;

        const { error } = await supabase
          .from("projects")
          .update({ end_date: newEndDate, updated_at: now, updated_by: currentUserId })
          .eq("id", pjItem.pj_id);

        if (error) throw new Error(`PJ終了日更新エラー (${pjItem.pj_name}): ${error.message}`);
        operations.push({ type: "pj_field", pjId: pjItem.pj_id, field: "end_date", oldValue: oldEndDate });
      }

      const taskCount = operations.filter(o => o.type === "task_field").length;
      const pjCount = operations.filter(o => o.type === "pj_field").length;
      const snapshot: UndoSnapshot = {
        id: generateId(),
        label: buildSnapshotLabel("date_change", taskCount, pjCount),
        appliedAt: now,
        operations,
      };
      return { type: "success", snapshot };
    }

    if (dialog.action_type === "assignee") {
      const operations: UndoOperation[] = [];
      for (const item of dialog.items) {
        const newAssigneeId = confirmedValues[item.task_id];
        if (!newAssigneeId) continue;

        // Undo用に現在のassignee_member_idを取得
        const { data: taskData } = await supabase
          .from("tasks")
          .select("assignee_member_id")
          .eq("id", item.task_id)
          .single();
        const oldAssigneeId = (taskData?.assignee_member_id as string) ?? null;

        const { error } = await supabase
          .from("tasks")
          .update({
            assignee_member_id: newAssigneeId,
            updated_at: now,
            updated_by: currentUserId,
          })
          .eq("id", item.task_id);

        if (error) throw new Error(`担当者更新エラー (${item.task_name}): ${error.message}`);
        operations.push({ type: "task_field", taskId: item.task_id, field: "assignee_member_id", oldValue: oldAssigneeId });
      }
      const snapshot: UndoSnapshot = {
        id: generateId(),
        label: buildSnapshotLabel("assignee", operations.length, 0),
        appliedAt: now,
        operations,
      };
      return { type: "success", snapshot };
    }

    // ===== scope_reduce / pause: 論理削除 =====
    if (
      dialog.action_type === "scope_reduce" ||
      dialog.action_type === "pause"
    ) {
      const operations: UndoOperation[] = [];

      // 個別タスクの論理削除
      for (const taskUuid of dialog.target_task_uuids ?? []) {
        const { error } = await supabase
          .from("tasks")
          .update({
            is_deleted: true,
            deleted_at: now,
            deleted_by: currentUserId,
            updated_at: now,
            updated_by: currentUserId,
          })
          .eq("id", taskUuid);

        if (error) throw new Error(`タスク削除エラー: ${error.message}`);
        operations.push({ type: "task_restore", taskId: taskUuid });
      }

      // PJおよび配下タスクの論理削除
      for (const pjUuid of dialog.target_pj_uuids ?? []) {
        const { error: tasksError } = await supabase
          .from("tasks")
          .update({
            is_deleted: true,
            deleted_at: now,
            deleted_by: currentUserId,
            updated_at: now,
            updated_by: currentUserId,
          })
          .eq("project_id", pjUuid)
          .eq("is_deleted", false);

        if (tasksError) throw new Error(`タスク一括削除エラー: ${tasksError.message}`);

        const { error: pjError } = await supabase
          .from("projects")
          .update({
            is_deleted: true,
            deleted_at: now,
            deleted_by: currentUserId,
            updated_at: now,
            updated_by: currentUserId,
          })
          .eq("id", pjUuid);

        if (pjError) throw new Error(`PJ削除エラー: ${pjError.message}`);
        operations.push({ type: "pj_restore", pjId: pjUuid });
      }

      const snapshot: UndoSnapshot = {
        id: generateId(),
        label: buildSnapshotLabel(
          dialog.action_type,
          (dialog.target_task_uuids ?? []).length,
          (dialog.target_pj_uuids ?? []).length,
        ),
        appliedAt: now,
        operations,
      };
      return { type: "success", snapshot };
    }

    return { type: "error", message: "未対応のアクションタイプです" };
  } catch (e) {
    return {
      type: "error",
      message: e instanceof Error ? e.message : "反映処理に失敗しました",
    };
  }
}
