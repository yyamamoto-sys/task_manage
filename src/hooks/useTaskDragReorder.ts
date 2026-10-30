// src/hooks/useTaskDragReorder.ts
//
// リスト/ガント共通のタスク・ドラッグ並べ替えロジック（兄弟の並び替え・親子付け替え・
// 見出しへのドロップによる親解除）。元は ListView.tsx 内にあった handleTaskDrop /
// handleUnparentDrop をそのままこのフックへ移し、GanttView（PJ別ビューのラベル列）にも
// 同じロジックを持たせるために共有する（useBulkTaskActions.ts と同じ抽出パターン。
// CLAUDE.md v3.01「ガントのタスク並べ替えD&D」）。
//
// 選択・ドラッグ中IDの状態（draggingId/dropZone）はこのフックが一元的に持つ
// （ListView/GanttViewともに同じ形の state を個別管理していた重複を解消）。
// 「並べ替えが成功した直後」の副作用（ListViewの並び順を「手動」に切り替える等、呼び出し側
// 固有のUI状態）は onReordered コールバックで呼び出し側に委譲する（GanttViewは常に
// 依存関係考慮の階層表示のため「手動ソートモード」という概念が無く、渡さなくてよい）。

import { useState, useCallback } from "react";
import { useAppStore } from "../stores/appStore";
import type { Task } from "../lib/localData/types";
import { isParentTask, wouldCreateParentCycle } from "../lib/taskHierarchy";
import { computeSiblingReorderIds, type DropZone } from "../lib/dragReorder";
import { computeMultiReorder, type MultiDropPosition } from "../lib/task/multiReorder";
import { showToast } from "../components/common/Toast";
import { formatErrorForUser } from "../lib/errorMessage";
import { settleUndoSaves } from "../lib/task/settleSaves";

export function useTaskDragReorder(
  allTasks: Task[],
  currentUserId: string,
  onReordered?: () => void,
) {
  const saveTask = useAppStore(s => s.saveTask);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropZone, setDropZone] = useState<{ id: string; zone: DropZone } | null>(null);

  // タスクをドロップ先タスクの行の「どこ」に落としたかで挙動を分ける：
  // - 上端/下端（before/after）：ドロップ先と同じ階層（同じ親、または両方最上位）の並びに挿入。
  //   ドロップ先が最上位で dragged が子だった場合はここで最上位に昇格する（＝子→親）。
  //   ドロップ先が子で dragged が最上位だった場合はここでその子の兄弟になる（＝親→子）
  // - 中央（nest）：ドロップ先の子にする（呼び出し側がこのゾーンを提供する場合のみ発生。
  //   GanttViewは常に allowNest=false でゾーンを算出するため実質発生しない）
  // 親→子の変更（子持ちタスクを子にする）は2階層固定と矛盾するため拒否する。
  const handleTaskDrop = useCallback(async (
    draggedId: string,
    targetId: string,
    zone: DropZone,
    visibleTasks: Task[],
  ) => {
    if (draggedId === targetId) return;
    const dragged = allTasks.find(t => t.id === draggedId);
    const target  = allTasks.find(t => t.id === targetId);
    if (!dragged || !target) return;

    if (zone === "nest") {
      if (target.parent_task_id === dragged.id) return; // 自分の子には入れない（循環防止）
      if (dragged.parent_task_id === target.id) return; // 既に子
      if (isParentTask(dragged, allTasks)) {
        showToast("子タスクを持つタスクは子にできません（先に子タスクを別の親に移動するか、解除してください）", "error");
        return;
      }
      // 祖先全体をたどった循環防止（自分の子孫の下へは入れない）
      if (wouldCreateParentCycle(allTasks, dragged.id, target.id)) return;
      try {
        await saveTask({ ...dragged, parent_task_id: target.id, project_id: target.project_id, updated_by: currentUserId });
        onReordered?.();
      } catch (err) {
        showToast(formatErrorForUser("親子変更に失敗しました", err), "error");
      }
      return;
    }

    const newParentId = target.parent_task_id ?? null;
    const newProjectId = target.project_id ?? null;
    if (newParentId && isParentTask(dragged, allTasks)) {
      showToast("子タスクを持つタスクは子にできません（先に子タスクを別の親に移動するか、解除してください）", "error");
      return;
    }
    if (wouldCreateParentCycle(allTasks, draggedId, newParentId)) return;
    const ids = computeSiblingReorderIds(allTasks, visibleTasks, draggedId, targetId, zone);
    if (!ids) return;
    // グループ（v3.149）：最上位として並ぶときはドロップ先と同じグループへ移る。子として並ぶときは親のグループ
    // （saveTask の normalizeTaskSection が揃える）。値が変わるときだけキーを足す（列が無い DB でも落ちない）
    const targetSection = target.section_id ?? null;
    const sectionPatch = !newParentId && (dragged.section_id ?? null) !== targetSection
      ? { section_id: targetSection } : {};
    try {
      await Promise.all(ids.map((id, idx) => {
        if (id === draggedId) {
          if ((dragged.display_order ?? 0) === idx && (dragged.parent_task_id ?? null) === newParentId && (dragged.project_id ?? null) === newProjectId
            && Object.keys(sectionPatch).length === 0) return Promise.resolve();
          return saveTask({ ...dragged, ...sectionPatch, parent_task_id: newParentId, project_id: newProjectId, display_order: idx, updated_by: currentUserId });
        }
        const t = allTasks.find(x => x.id === id);
        if (!t || (t.display_order ?? 0) === idx) return Promise.resolve();
        return saveTask({ ...t, display_order: idx, updated_by: currentUserId });
      }));
      onReordered?.();
    } catch (err) {
      showToast(formatErrorForUser("並べ替えに失敗しました", err), "error");
    }
  }, [allTasks, saveTask, currentUserId, onReordered]);

  // PJ見出しへのドロップ＝親を解除して指定PJの最上位タスクの末尾に追加する（子→親）。
  const handleUnparentDrop = useCallback(async (draggedId: string, projectId: string) => {
    const dragged = allTasks.find(t => t.id === draggedId);
    if (!dragged) return;
    if (!dragged.parent_task_id && (dragged.project_id ?? null) === projectId) return; // 変化なし
    const isTop = (t: Task) => !t.parent_task_id && (t.project_id ?? null) === projectId;
    const maxOrder = allTasks.filter(isTop).reduce((m, t) => Math.max(m, t.display_order ?? 0), -1);
    try {
      await saveTask({ ...dragged, parent_task_id: null, project_id: projectId, display_order: maxOrder + 1, updated_by: currentUserId });
      onReordered?.();
    } catch (err) {
      showToast(formatErrorForUser("親の解除に失敗しました", err), "error");
    }
  }, [allTasks, saveTask, currentUserId, onReordered]);

  // グループ見出しへのドロップ＝そのPJのそのグループ（sectionId=null は未分類）の末尾の最上位タスクにする。
  // 子タスクは親と同じグループなので、子だけを別グループへは移せない（親をドラッグする）。
  const handleSectionDrop = useCallback(async (draggedId: string, projectId: string, sectionId: string | null) => {
    const dragged = allTasks.find(t => t.id === draggedId);
    if (!dragged) return;
    if (dragged.parent_task_id) {
      showToast("子タスクは親タスクと同じグループです。親タスクをドラッグして移してください", "info");
      return;
    }
    if ((dragged.project_id ?? null) === projectId && (dragged.section_id ?? null) === sectionId) return;
    const isTop = (t: Task) => !t.parent_task_id && (t.project_id ?? null) === projectId;
    const maxOrder = allTasks.filter(isTop).reduce((m, t) => Math.max(m, t.display_order ?? 0), -1);
    try {
      await saveTask({ ...dragged, project_id: projectId, section_id: sectionId, display_order: maxOrder + 1, updated_by: currentUserId });
      onReordered?.();
    } catch (err) {
      showToast(formatErrorForUser("グループの移動に失敗しました", err), "error");
    }
  }, [allTasks, saveTask, currentUserId, onReordered]);

  // 選択中の複数タスクをドロップ位置へまとめて移す（v3.156）。採番・拒否の規則は computeMultiReorder に集約。
  // Undo は「Undo 時点の最新タスク」に旧値だけを当て直す（古いスナップショット全体の保存は楽観ロックと衝突するため）
  const handleMultiTaskDrop = useCallback(async (
    orderedSelectedIds: string[],
    targetId: string,
    zone: DropZone,
    visibleTasks: Task[],
  ) => {
    const position: MultiDropPosition = zone === "nest"
      ? { kind: "nest", parentId: targetId }
      : { kind: zone, targetId };
    const result = computeMultiReorder(allTasks, visibleTasks, orderedSelectedIds, position);
    if (!result.ok) {
      if (result.reason) showToast(result.reason, "error");
      return;
    }
    if (result.patches.length === 0) return;
    try {
      const latestOf = (id: string) => useAppStore.getState().tasks.find(x => x.id === id);
      await Promise.all(result.patches.map(({ id, patch }) => {
        const t = latestOf(id);
        return t ? saveTask({ ...t, ...patch, updated_by: currentUserId }) : Promise.resolve();
      }));
      onReordered?.();
      showToast(`${result.movedCount}件のタスクをまとめて移動しました`, "success", {
        label: "元に戻す",
        isUndo: true,
        onClick: () => {
          const tasksNow = useAppStore.getState().tasks;
          void settleUndoSaves(result.patches.map(({ id, prev }) => {
            const t = tasksNow.find(x => x.id === id);
            return t ? saveTask({ ...t, ...prev, updated_by: currentUserId }) : Promise.resolve();
          }));
        },
      });
    } catch (err) {
      showToast(formatErrorForUser("まとめての並べ替えに失敗しました", err), "error");
    }
  }, [allTasks, saveTask, currentUserId, onReordered]);

  return { draggingId, setDraggingId, dropZone, setDropZone, handleTaskDrop, handleMultiTaskDrop, handleUnparentDrop, handleSectionDrop };
}
