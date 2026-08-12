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
//
// 【v3.71で choke point 統一】applyProposal.ts と同じ理由で、appStore のアクション
// （saveTask/saveProject/deleteTask/restoreTask/deleteProject/restoreProject）経由に統一した。
// これによりB1/B3/B4がUndoにも一貫して効く（Undoで完了状態に戻すような操作は現状無いが、
// 将来の拡張でも choke point を経由する設計を保つ）。

import { useAppStore } from "../../stores/appStore";
import type { Task, Project } from "../localData/types";
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
    // operationsを逆順に適用
    const reversedOps = [...snapshot.operations].reverse();

    for (const op of reversedOps) {
      if (op.type === "task_field") {
        const task = useAppStore.getState().tasks.find(t => t.id === op.taskId);
        if (!task) continue;
        // 【動的キー】op.fieldは実在の列名であることを呼び出し元（applyProposal.ts）が
        // 保証する契約（comment/due_date/assignee_member_id等、様々な型のフィールドを1つの
        // Union型で表現しているため、Task型に対する厳密なキー別の型チェックはできない）。
        try {
          await useAppStore.getState().saveTask({ ...task, [op.field]: op.oldValue, updated_by: currentUserId } as Task);
        } catch (e) {
          throw new Error(`フィールド復元エラー (${op.field}): ${formatErrorForUser("", e)}`);
        }
      } else if (op.type === "task_restore") {
        try {
          await useAppStore.getState().restoreTask(op.taskId);
        } catch (e) {
          throw new Error(`タスク復元エラー: ${formatErrorForUser("", e)}`);
        }
      } else if (op.type === "task_delete") {
        // add_task で新規作成したタスクの Undo = 論理削除
        try {
          await useAppStore.getState().deleteTask(op.taskId, currentUserId);
        } catch (e) {
          throw new Error(`タスク削除（Undo）エラー: ${formatErrorForUser("", e)}`);
        }
      } else if (op.type === "pj_delete") {
        // add_project で新規作成したPJの Undo = PJと配下タスクを論理削除
        const childTasks = useAppStore.getState().tasks.filter(t => t.project_id === op.pjId && !t.is_deleted);
        for (const t of childTasks) {
          try {
            await useAppStore.getState().deleteTask(t.id, currentUserId);
          } catch (e) {
            throw new Error(`タスク一括削除（Undo）エラー: ${formatErrorForUser("", e)}`);
          }
        }
        try {
          await useAppStore.getState().deleteProject(op.pjId, currentUserId);
        } catch (e) {
          throw new Error(`PJ削除（Undo）エラー: ${formatErrorForUser("", e)}`);
        }
      } else if (op.type === "pj_field") {
        const project = useAppStore.getState().projects.find(p => p.id === op.pjId);
        if (!project) continue;
        try {
          await useAppStore.getState().saveProject({ ...project, [op.field]: op.oldValue, updated_by: currentUserId } as Project);
        } catch (e) {
          throw new Error(`PJフィールド復元エラー (${op.field}): ${formatErrorForUser("", e)}`);
        }
      } else if (op.type === "pj_restore") {
        // PJ配下の全タスクを復元
        const deletedChildTasks = useAppStore.getState().tasks.filter(t => t.project_id === op.pjId && t.is_deleted);
        for (const t of deletedChildTasks) {
          try {
            await useAppStore.getState().restoreTask(t.id);
          } catch (e) {
            throw new Error(`タスク一括復元エラー: ${formatErrorForUser("", e)}`);
          }
        }
        // PJ自体を復元
        try {
          await useAppStore.getState().restoreProject(op.pjId);
        } catch (e) {
          throw new Error(`PJ復元エラー: ${formatErrorForUser("", e)}`);
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
