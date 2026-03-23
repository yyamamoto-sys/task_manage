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

// ===== 型定義 =====

export type ApplyResult =
  | { type: "success" }
  | { type: "needs_confirmation"; dialog: ConfirmationDialog }
  | { type: "error"; message: string };

export interface ConfirmationDialog {
  proposal_id: string;
  action_type: "date_change" | "assignee";
  items: ConfirmationItem[];
}

export interface ConfirmationItem {
  task_id: string;     // UUID
  task_name: string;
  current_value: string;
  suggested_value: string;
}

// ===== 内部ヘルパー =====

/**
 * タスクのcommentに追記する（2ステップSELECT+UPDATE）。
 * rpcは使わない（CLAUDE.md Section 6-10参照）。
 */
async function appendTaskComment(
  taskId: string,
  appendText: string,
  currentUserId: string,
): Promise<void> {
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
  const timestamp = new Date().toLocaleDateString("ja-JP");
  const newComment = currentComment
    ? `${currentComment}\n\n[AIアドバイス ${timestamp}]\n${appendText}`
    : `[AIアドバイス ${timestamp}]\n${appendText}`;

  // Step 2: コメントを更新
  const { error: updateError } = await supabase
    .from("tasks")
    .update({
      comment: newComment,
      updated_at: new Date().toISOString(),
      updated_by: currentUserId,
    })
    .eq("id", taskId);

  if (updateError) {
    throw new Error(`タスク更新エラー: ${updateError.message}`);
  }
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

  // ===== milestone: 未対応 =====
  if (action_type === "milestone") {
    return { type: "error", message: "マイルストーンは未対応です" };
  }

  // ===== date_change: 確認ダイアログを返す =====
  if (action_type === "date_change") {
    const items: ConfirmationItem[] = [];

    for (const shortId of proposal.target_task_ids) {
      const uuid = resolveUUID(shortId, shortIdMap);
      if (!uuid) continue;

      const { data: task } = await supabase
        .from("tasks")
        .select("id, name, due_date")
        .eq("id", uuid)
        .single();

      if (!task) continue;

      items.push({
        task_id: uuid,
        task_name: (task.name as string) ?? shortId,
        current_value: (task.due_date as string) ?? "未設定",
        suggested_value: proposal.suggested_date ?? "未定",
      });
    }

    if (items.length === 0) {
      return { type: "error", message: "対象タスクが見つかりませんでした" };
    }

    return {
      type: "needs_confirmation",
      dialog: {
        proposal_id: proposal.proposal_id,
        action_type: "date_change",
        items,
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
      for (const shortId of proposal.target_task_ids) {
        const uuid = resolveUUID(shortId, shortIdMap);
        if (!uuid) continue;
        await appendTaskComment(uuid, proposal.description, currentUserId);
      }
      return { type: "success" };
    } catch (e) {
      return {
        type: "error",
        message: e instanceof Error ? e.message : "コメント追記に失敗しました",
      };
    }
  }

  // ===== scope_reduce / pause: 論理削除 =====
  if (action_type === "scope_reduce" || action_type === "pause") {
    try {
      const now = new Date().toISOString();

      // タスクの論理削除
      for (const shortId of proposal.target_task_ids) {
        const uuid = resolveUUID(shortId, shortIdMap);
        if (!uuid) continue;

        const { error } = await supabase
          .from("tasks")
          .update({
            is_deleted: true,
            deleted_at: now,
            deleted_by: currentUserId,
            updated_at: now,
            updated_by: currentUserId,
          })
          .eq("id", uuid);

        if (error) throw new Error(`タスク削除エラー: ${error.message}`);
      }

      // プロジェクトの論理削除
      for (const shortId of proposal.target_pj_ids) {
        const uuid = resolveUUID(shortId, shortIdMap);
        if (!uuid) continue;

        // PJに紐づく全タスクも論理削除
        const { error: tasksError } = await supabase
          .from("tasks")
          .update({
            is_deleted: true,
            deleted_at: now,
            deleted_by: currentUserId,
            updated_at: now,
            updated_by: currentUserId,
          })
          .eq("project_id", uuid)
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
          .eq("id", uuid);

        if (pjError) throw new Error(`PJ削除エラー: ${pjError.message}`);
      }

      return { type: "success" };
    } catch (e) {
      return {
        type: "error",
        message: e instanceof Error ? e.message : "削除処理に失敗しました",
      };
    }
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
      for (const item of dialog.items) {
        const newDate = confirmedValues[item.task_id];
        if (!newDate) continue;

        const { error } = await supabase
          .from("tasks")
          .update({
            due_date: newDate,
            updated_at: now,
            updated_by: currentUserId,
          })
          .eq("id", item.task_id);

        if (error) throw new Error(`日程更新エラー (${item.task_name}): ${error.message}`);
      }
      return { type: "success" };
    }

    if (dialog.action_type === "assignee") {
      for (const item of dialog.items) {
        const newAssigneeId = confirmedValues[item.task_id];
        if (!newAssigneeId) continue;

        const { error } = await supabase
          .from("tasks")
          .update({
            assignee_member_id: newAssigneeId,
            updated_at: now,
            updated_by: currentUserId,
          })
          .eq("id", item.task_id);

        if (error) throw new Error(`担当者更新エラー (${item.task_name}): ${error.message}`);
      }
      return { type: "success" };
    }

    return { type: "error", message: "未対応のアクションタイプです" };
  } catch (e) {
    return {
      type: "error",
      message: e instanceof Error ? e.message : "反映処理に失敗しました",
    };
  }
}
