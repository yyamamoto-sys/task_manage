// src/hooks/useBulkTaskActions.ts
//
// リスト/カンバン共通の一括操作ロジック（一括ステータス変更・一括優先度変更・一括担当者変更・一括削除）。
// 元はListView.tsx内にあった3関数（bulkUpdateStatus/bulkUpdateAssignee/bulkDelete）を
// そのままこのフックへ移し、カンバンビューにも同じロジックを持たせるために共有する
// （KanbanViewの複数選択＋一括操作を追加した際の抽出。CLAUDE.md v2.51）。
// bulkUpdatePriority はリストビュー改良第4弾で追加（CLAUDE.md v2.62）。
//
// 選択状態（selectedIds・Shift+クリックのアンカー等）は各ビューの選択UIに強く紐づくため
// 呼び出し側（ListView/KanbanView）で管理し、このフックは「選択中IDに対して何をするか」
// の実行ロジックのみを持つ。各操作はUndoトースト（isUndo:true）を出す＝アプリ全体の
// Ctrl+Zで戻せる（既存のUndoの仕組みにそのまま乗る）。

import { useCallback } from "react";
import { useAppStore } from "../stores/appStore";
import type { Member, Task } from "../lib/localData/types";
import { TASK_STATUS_LABEL, TASK_PRIORITY_LABEL } from "../lib/taskMeta";
import { confirmDialog } from "../lib/dialog";
import { showToast } from "../components/common/Toast";
import { formatErrorForUser } from "../lib/errorMessage";
import { planProjectMove, projectMoveConfirmMessage } from "../lib/task/projectMove";
import { computeBulkMoveShifts } from "../components/gantt/ganttUtils";
import { settleUndoSaves } from "../lib/task/settleSaves";
import { confirmHiddenIncluded, countHiddenTargets, withHiddenNote } from "../lib/task/hiddenSelection";

export function useBulkTaskActions(
  allTasks: Task[],
  members: Member[],
  selectedIds: Set<string>,
  currentUserId: string,
  clearSelection: () => void,
  /** 今画面に見えているタスクid（表示順）。選択のうち見えていないものを確認ダイアログで明示する（M77・M80）。省略時は確認なし */
  visibleIdsRef?: { readonly current: readonly string[] },
) {
  const saveTask = useAppStore(s => s.saveTask);
  const deleteTask = useAppStore(s => s.deleteTask);
  const restoreTask = useAppStore(s => s.restoreTask);
  const bulkShiftTasks = useAppStore(s => s.bulkShiftTasks);

  // 一括ステータス変更
  const bulkUpdateStatus = useCallback(async (status: Task["status"]) => {
    const targets = allTasks.filter(t => selectedIds.has(t.id));
    if (targets.length === 0) return;
    // Undo用に変更前ステータスを控える。巻き戻しは「Undo時点の最新タスク」に
    // 旧ステータスだけ適用する（古いスナップショット全体を保存すると楽観ロックと衝突するため）
    const prevStatusById = new Map(targets.map(t => [t.id, t.status]));
    if (!await confirmHiddenIncluded(
      `${targets.length}件のステータスを「${TASK_STATUS_LABEL[status]}」に変更します。`,
      countHiddenTargets(targets.map(t => t.id), visibleIdsRef?.current),
    )) return;
    try {
      await Promise.all(targets.map(t =>
        saveTask({ ...t, status, updated_by: currentUserId }),
      ));
      showToast(`${targets.length}件のステータスを「${TASK_STATUS_LABEL[status]}」に変更しました`, "success", {
        label: "元に戻す",
        isUndo: true,
        onClick: () => {
          const tasksNow = useAppStore.getState().tasks;
          void settleUndoSaves(Array.from(prevStatusById, ([id, prevStatus]) => {
            const t = tasksNow.find(x => x.id === id);
            return t ? saveTask({ ...t, status: prevStatus, updated_by: currentUserId }) : Promise.resolve();
          }));
        },
      });
      clearSelection();
    } catch (err) {
      showToast(formatErrorForUser("一括変更に失敗しました", err), "error");
    }
  }, [allTasks, selectedIds, saveTask, currentUserId, clearSelection, visibleIdsRef]);

  // 一括優先度変更
  const bulkUpdatePriority = useCallback(async (priority: Task["priority"]) => {
    const targets = allTasks.filter(t => selectedIds.has(t.id));
    if (targets.length === 0) return;
    // Undo用に変更前優先度を控える（方式はbulkUpdateStatusと同じ）
    const prevPriorityById = new Map(targets.map(t => [t.id, t.priority]));
    if (!await confirmHiddenIncluded(
      `${targets.length}件の優先度を変更します。`,
      countHiddenTargets(targets.map(t => t.id), visibleIdsRef?.current),
    )) return;
    try {
      await Promise.all(targets.map(t =>
        saveTask({ ...t, priority, updated_by: currentUserId }),
      ));
      const label = priority ? TASK_PRIORITY_LABEL[priority] : "なし";
      showToast(`${targets.length}件の優先度を「${label}」に変更しました`, "success", {
        label: "元に戻す",
        isUndo: true,
        onClick: () => {
          const tasksNow = useAppStore.getState().tasks;
          void settleUndoSaves(Array.from(prevPriorityById, ([id, prevPriority]) => {
            const t = tasksNow.find(x => x.id === id);
            return t ? saveTask({ ...t, priority: prevPriority, updated_by: currentUserId }) : Promise.resolve();
          }));
        },
      });
      clearSelection();
    } catch (err) {
      showToast(formatErrorForUser("一括変更に失敗しました", err), "error");
    }
  }, [allTasks, selectedIds, saveTask, currentUserId, clearSelection, visibleIdsRef]);

  // 一括担当者変更
  const bulkUpdateAssignee = useCallback(async (memberId: string) => {
    const targets = allTasks.filter(t => selectedIds.has(t.id));
    if (targets.length === 0) return;
    // Undo用に変更前の担当者を控える（方式はbulkUpdateStatusと同じ）
    const prevAssigneesById = new Map(targets.map(t => [
      t.id,
      { single: t.assignee_member_id, multi: t.assignee_member_ids },
    ]));
    if (!await confirmHiddenIncluded(
      `${targets.length}件の担当者を変更します。`,
      countHiddenTargets(targets.map(t => t.id), visibleIdsRef?.current),
    )) return;
    try {
      await Promise.all(targets.map(t => saveTask({
        ...t,
        assignee_member_id: memberId,
        assignee_member_ids: [memberId],
        updated_by: currentUserId,
      })));
      const m = members.find(mm => mm.id === memberId);
      showToast(`${targets.length}件の担当者を「${m?.display_name ?? memberId}」に変更しました`, "success", {
        label: "元に戻す",
        isUndo: true,
        onClick: () => {
          const tasksNow = useAppStore.getState().tasks;
          void settleUndoSaves(Array.from(prevAssigneesById, ([id, prev]) => {
            const t = tasksNow.find(x => x.id === id);
            return t ? saveTask({
              ...t,
              assignee_member_id: prev.single,
              assignee_member_ids: prev.multi,
              updated_by: currentUserId,
            }) : Promise.resolve();
          }));
        },
      });
      clearSelection();
    } catch (err) {
      showToast(formatErrorForUser("一括変更に失敗しました", err), "error");
    }
  }, [allTasks, selectedIds, saveTask, currentUserId, members, clearSelection, visibleIdsRef]);

  // 一括削除
  const bulkDelete = useCallback(async () => {
    const count = selectedIds.size;
    if (count === 0) return;
    const hidden = countHiddenTargets(selectedIds, visibleIdsRef?.current);
    const ok = await confirmDialog(withHiddenNote(`選択中の ${count} 件のタスクを削除します。`, hidden) + "\n（変更履歴から復元できます）");
    if (!ok) return;
    try {
      const ids = Array.from(selectedIds);
      await Promise.all(ids.map(id => deleteTask(id, currentUserId)));
      showToast(`${count}件のタスクを削除しました`, "info", {
        label: "元に戻す",
        isUndo: true,
        onClick: () => { void settleUndoSaves(ids.map(id => restoreTask(id, currentUserId))); },
      });
      clearSelection();
    } catch (err) {
      showToast(formatErrorForUser("一括削除に失敗しました", err), "error");
    }
  }, [selectedIds, deleteTask, restoreTask, currentUserId, clearSelection, visibleIdsRef]);

  // 選んだタスクを別のプロジェクトへ移す（v3.156）。対象（子の連れ方・親から外れる子）は planProjectMove が決める。
  // section_id は null（移動先PJのグループではない）。task_projects（追加PJ）は触らない。
  // Undo は「Undo 時点の最新タスク」に旧 project_id・section_id・parent_task_id・display_order を当て直す
  const bulkMoveToProject = useCallback(async (projectId: string, projectName: string, orderedIds: string[] = []) => {
    const plan = planProjectMove(allTasks, selectedIds, projectId, orderedIds);
    if (plan.total === 0) {
      showToast(`選んだタスクはすべて「${projectName}」にあります`, "info");
      return;
    }
    const hidden = countHiddenTargets(allTasks.filter(t => selectedIds.has(t.id)).map(t => t.id), visibleIdsRef?.current);
    const ok = await confirmDialog(withHiddenNote(projectMoveConfirmMessage(plan, projectName), hidden), {
      tone: "neutral", confirmLabel: "移す",
    });
    if (!ok) return;
    try {
      const latestOf = (id: string) => useAppStore.getState().tasks.find(x => x.id === id);
      await Promise.all(plan.moves.map(({ id, patch }) => {
        const t = latestOf(id);
        return t ? saveTask({ ...t, ...patch, updated_by: currentUserId }) : Promise.resolve();
      }));
      showToast(`${plan.total}件を「${projectName}」へ移しました`, "success", {
        label: "元に戻す",
        isUndo: true,
        onClick: () => {
          const tasksNow = useAppStore.getState().tasks;
          void settleUndoSaves(plan.moves.map(({ id, prev }) => {
            const t = tasksNow.find(x => x.id === id);
            return t ? saveTask({ ...t, ...prev, updated_by: currentUserId }) : Promise.resolve();
          }));
        },
      });
      clearSelection();
    } catch (err) {
      showToast(formatErrorForUser("プロジェクトの移動に失敗しました", err), "error");
    }
  }, [allTasks, selectedIds, saveTask, currentUserId, clearSelection, visibleIdsRef]);

  // 選んだタスクの日程を暦日でずらす（v3.156）。実処理・B3の自動リスケ・Undoは bulkShiftTasks（ガントと同じ）。
  // 期日の無い・完了/中止のタスクはずらせない（computeBulkMoveShifts の既存ルール）ので、件数を先に伝える
  const bulkShift = useCallback(async (deltaDays: number) => {
    if (!Number.isInteger(deltaDays) || deltaDays === 0) return;
    const targets = allTasks.filter(t => selectedIds.has(t.id));
    const shiftable = computeBulkMoveShifts(targets, deltaDays).length;
    const skipped = targets.length - shiftable;
    if (shiftable === 0) {
      showToast("期日があり未完了のタスクが選ばれていないため、日程をずらせませんでした", "info");
      return;
    }
    if (skipped > 0) {
      showToast(`${skipped}件は期日が無い・完了済みのためずらしません`, "info");
    }
    if (!await confirmHiddenIncluded(
      `選んだタスクの日程を ${Math.abs(deltaDays)} 日${deltaDays > 0 ? "後ろへ" : "前へ"}ずらします。`,
      countHiddenTargets(targets.map(t => t.id), visibleIdsRef?.current),
    )) return;
    try {
      await bulkShiftTasks(targets.map(t => t.id), deltaDays, currentUserId);
      clearSelection();
    } catch (err) {
      showToast(formatErrorForUser("日程のずらしに失敗しました", err), "error");
    }
  }, [allTasks, selectedIds, bulkShiftTasks, currentUserId, clearSelection, visibleIdsRef]);

  return { bulkUpdateStatus, bulkUpdatePriority, bulkUpdateAssignee, bulkDelete, bulkMoveToProject, bulkShift };
}
