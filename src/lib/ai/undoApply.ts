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
//
// 【v3.77・部分失敗の明示】1つのsnapshotが複数operationを持つ場合（例：date_changeで複数
// タスクの期日を変更した反映のUndo）、途中のoperationで失敗すると、それより前のoperationは
// 既にDBへ反映済みのまま処理が中断する（ここもトランザクションではない・applyProposal.tsの
// 「部分失敗の方針」と同じ割り切り）。呼び出し元（useAIConsultation.ts）が「一部だけ元に戻った
// 状態で通知もリトライ手段も無い」まま握りつぶさないよう、1件でも既に適用済みなら
// message に「一部のみ元に戻りました」を明示する。

import { useAppStore } from "../../stores/appStore";
import type { Task, Project } from "../localData/types";
import type { UndoSnapshot } from "../../hooks/useUndoStack";
import { formatErrorForUser } from "../errorMessage";

// ===== 型定義 =====

export type UndoResult =
  | { type: "success" }
  | { type: "error"; message: string; partial: boolean };

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
  // 完全に適用し終えたoperationの件数（失敗したoperation自体はカウントしない）。
  // 1件以上あれば「途中まで反映されている」＝partialな失敗としてメッセージを変える。
  let appliedCount = 0;
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
        // 【v3.77・skipCascade漏れの是正】op.fieldがdue_dateのとき（date_change提案のUndo）、
        // skipCascadeを付けずにsaveTaskへ渡すと、Undoで戻した古い日付を起点にB3自動リスケが
        // 再発火してしまう。B3のUndoパターン（appStore.ts runCascade/runBulkShiftのUndo。
        // CLAUDE.md Section 3-6）は例外なくskipCascade:trueを渡しており、ここだけ抜けていた
        // （v3.71のchoke point統一でB3が新たに効くようになったことによる回帰）。
        // 他のフィールド（comment/assignee等）はdue_dateが変化しない限りB3は元々発火しない
        // ため、常時付けても副作用はない。
        try {
          await useAppStore.getState().saveTask(
            { ...task, [op.field]: op.oldValue, updated_by: currentUserId } as Task,
            { skipCascade: true },
          );
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
      appliedCount++;
    }

    return { type: "success" };
  } catch (e) {
    const partial = appliedCount > 0;
    const message = partial
      ? `一部のみ元に戻りました。画面を再読み込みしてご確認ください（${formatErrorForUser("", e)}）`
      : formatErrorForUser("元に戻す処理に失敗しました", e);
    return { type: "error", message, partial };
  }
}
