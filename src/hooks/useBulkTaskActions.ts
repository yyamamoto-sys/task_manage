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

export function useBulkTaskActions(
  allTasks: Task[],
  members: Member[],
  selectedIds: Set<string>,
  currentUserId: string,
  clearSelection: () => void,
) {
  const saveTask = useAppStore(s => s.saveTask);
  const deleteTask = useAppStore(s => s.deleteTask);
  const restoreTask = useAppStore(s => s.restoreTask);

  // 一括ステータス変更
  const bulkUpdateStatus = useCallback(async (status: Task["status"]) => {
    const targets = allTasks.filter(t => selectedIds.has(t.id));
    if (targets.length === 0) return;
    // Undo用に変更前ステータスを控える。巻き戻しは「Undo時点の最新タスク」に
    // 旧ステータスだけ適用する（古いスナップショット全体を保存すると楽観ロックと衝突するため）
    const prevStatusById = new Map(targets.map(t => [t.id, t.status]));
    try {
      await Promise.all(targets.map(t =>
        saveTask({ ...t, status, updated_by: currentUserId }),
      ));
      showToast(`${targets.length}件のステータスを「${TASK_STATUS_LABEL[status]}」に変更しました`, "success", {
        label: "元に戻す",
        isUndo: true,
        onClick: () => {
          const tasksNow = useAppStore.getState().tasks;
          prevStatusById.forEach((prevStatus, id) => {
            const t = tasksNow.find(x => x.id === id);
            if (t) saveTask({ ...t, status: prevStatus, updated_by: currentUserId });
          });
        },
      });
      clearSelection();
    } catch (err) {
      showToast(formatErrorForUser("一括変更に失敗しました", err), "error");
    }
  }, [allTasks, selectedIds, saveTask, currentUserId, clearSelection]);

  // 一括優先度変更
  const bulkUpdatePriority = useCallback(async (priority: Task["priority"]) => {
    const targets = allTasks.filter(t => selectedIds.has(t.id));
    if (targets.length === 0) return;
    // Undo用に変更前優先度を控える（方式はbulkUpdateStatusと同じ）
    const prevPriorityById = new Map(targets.map(t => [t.id, t.priority]));
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
          prevPriorityById.forEach((prevPriority, id) => {
            const t = tasksNow.find(x => x.id === id);
            if (t) saveTask({ ...t, priority: prevPriority, updated_by: currentUserId });
          });
        },
      });
      clearSelection();
    } catch (err) {
      showToast(formatErrorForUser("一括変更に失敗しました", err), "error");
    }
  }, [allTasks, selectedIds, saveTask, currentUserId, clearSelection]);

  // 一括担当者変更
  const bulkUpdateAssignee = useCallback(async (memberId: string) => {
    const targets = allTasks.filter(t => selectedIds.has(t.id));
    if (targets.length === 0) return;
    // Undo用に変更前の担当者を控える（方式はbulkUpdateStatusと同じ）
    const prevAssigneesById = new Map(targets.map(t => [
      t.id,
      { single: t.assignee_member_id, multi: t.assignee_member_ids },
    ]));
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
          prevAssigneesById.forEach((prev, id) => {
            const t = tasksNow.find(x => x.id === id);
            if (t) saveTask({
              ...t,
              assignee_member_id: prev.single,
              assignee_member_ids: prev.multi,
              updated_by: currentUserId,
            });
          });
        },
      });
      clearSelection();
    } catch (err) {
      showToast(formatErrorForUser("一括変更に失敗しました", err), "error");
    }
  }, [allTasks, selectedIds, saveTask, currentUserId, members, clearSelection]);

  // 一括削除
  const bulkDelete = useCallback(async () => {
    const count = selectedIds.size;
    if (count === 0) return;
    const ok = await confirmDialog(`選択中の ${count} 件のタスクを削除します。\n（変更履歴から復元できます）`);
    if (!ok) return;
    try {
      const ids = Array.from(selectedIds);
      await Promise.all(ids.map(id => deleteTask(id, currentUserId)));
      showToast(`${count}件のタスクを削除しました`, "info", {
        label: "元に戻す",
        isUndo: true,
        onClick: () => { ids.forEach(id => restoreTask(id)); },
      });
      clearSelection();
    } catch (err) {
      showToast(formatErrorForUser("一括削除に失敗しました", err), "error");
    }
  }, [selectedIds, deleteTask, restoreTask, currentUserId, clearSelection]);

  return { bulkUpdateStatus, bulkUpdatePriority, bulkUpdateAssignee, bulkDelete };
}
