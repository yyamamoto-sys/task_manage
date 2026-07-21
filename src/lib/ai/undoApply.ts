// src/lib/ai/undoApply.ts
//
// 【設計意図】
// UndoSnapshotをDBに反映する（各operationを逆順に適用して元に戻す）。
// - task_field: 指定フィールドをoldValueに戻す
// - task_restore: is_deleted=false に戻す（scope_reduce/pause の取り消し）
// - task_delete: is_deleted=true にする（add_task で作成したタスクの取り消し）
// - pj_field: PJの指定フィールドをoldValueに戻す（date_changeのPJ終了日変更の取り消し）
// - pj_restore: PJとその配下の全タスクをis_deleted=falseに戻す（scope_reduce/pause の取り消し）
// - pj_delete: PJとその配下の全タスクをis_deleted=trueにする（add_project の取り消し）
//
// 物理削除は絶対に行わない（CLAUDE.md Section 4参照）

import { supabase } from "../supabase/client";
import type { UndoSnapshot } from "../../hooks/useUndoStack";
import { formatErrorForUser } from "../errorMessage";

// ===== 型定義 =====

export type UndoResult =
  | { type: "success" }
  | { type: "error"; message: string };

// ===== メイン関数 =====

/**
 * 【設計意図】
 * UndoSnapshotをDBに反映する。
 * operations配列は逆順（後に実行した操作から順に戻す）で適用する。
 *
 * @param snapshot - 取り消すUndoSnapshot
 * @param currentUserId - 操作者のメンバーID
 */
export async function applyUndo(
  snapshot: UndoSnapshot,
  currentUserId: string,
): Promise<UndoResult> {
  try {
    const now = new Date().toISOString();

    // operationsを逆順に適用
    const reversedOps = [...snapshot.operations].reverse();

    for (const op of reversedOps) {
      if (op.type === "task_field") {
        const { error } = await supabase
          .from("tasks")
          .update({
            [op.field]: op.oldValue,
            updated_at: now,
            updated_by: currentUserId,
          })
          .eq("id", op.taskId);

        if (error) {
          throw new Error(`フィールド復元エラー (${op.field}): ${error.message}`);
        }
      } else if (op.type === "task_restore") {
        const { error } = await supabase
          .from("tasks")
          .update({
            is_deleted: false,
            deleted_at: null,
            deleted_by: null,
            updated_at: now,
            updated_by: currentUserId,
          })
          .eq("id", op.taskId);

        if (error) {
          throw new Error(`タスク復元エラー: ${error.message}`);
        }
      } else if (op.type === "task_delete") {
        // add_task で新規作成したタスクの Undo = 論理削除
        const { error } = await supabase
          .from("tasks")
          .update({
            is_deleted: true,
            deleted_at: now,
            deleted_by: currentUserId,
            updated_at: now,
            updated_by: currentUserId,
          })
          .eq("id", op.taskId);

        if (error) {
          throw new Error(`タスク削除（Undo）エラー: ${error.message}`);
        }
      } else if (op.type === "pj_delete") {
        // add_project で新規作成したPJの Undo = PJと配下タスクを論理削除
        const { error: tasksError } = await supabase
          .from("tasks")
          .update({
            is_deleted: true,
            deleted_at: now,
            deleted_by: currentUserId,
            updated_at: now,
            updated_by: currentUserId,
          })
          .eq("project_id", op.pjId)
          .eq("is_deleted", false);

        if (tasksError) {
          throw new Error(`タスク一括削除（Undo）エラー: ${tasksError.message}`);
        }

        const { error: pjError } = await supabase
          .from("projects")
          .update({
            is_deleted: true,
            deleted_at: now,
            deleted_by: currentUserId,
            updated_at: now,
            updated_by: currentUserId,
          })
          .eq("id", op.pjId);

        if (pjError) {
          throw new Error(`PJ削除（Undo）エラー: ${pjError.message}`);
        }
      } else if (op.type === "pj_field") {
        const { error } = await supabase
          .from("projects")
          .update({
            [op.field]: op.oldValue,
            updated_at: now,
            updated_by: currentUserId,
          })
          .eq("id", op.pjId);

        if (error) {
          throw new Error(`PJフィールド復元エラー (${op.field}): ${error.message}`);
        }
      } else if (op.type === "pj_restore") {
        // PJ配下の全タスクを復元
        const { error: tasksError } = await supabase
          .from("tasks")
          .update({
            is_deleted: false,
            deleted_at: null,
            deleted_by: null,
            updated_at: now,
            updated_by: currentUserId,
          })
          .eq("project_id", op.pjId)
          .eq("is_deleted", true);

        if (tasksError) {
          throw new Error(`タスク一括復元エラー: ${tasksError.message}`);
        }

        // PJ自体を復元
        const { error: pjError } = await supabase
          .from("projects")
          .update({
            is_deleted: false,
            deleted_at: null,
            deleted_by: null,
            updated_at: now,
            updated_by: currentUserId,
          })
          .eq("id", op.pjId);

        if (pjError) {
          throw new Error(`PJ復元エラー: ${pjError.message}`);
        }
      }
    }

    return { type: "success" };
  } catch (e) {
    return {
      type: "error",
      message: formatErrorForUser("元に戻す処理に失敗しました", e),
    };
  }
}
