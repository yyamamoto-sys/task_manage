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
import { buildChildrenMap, descendantsOf, wouldCreateParentCycle } from "../lib/taskHierarchy";
import { nextDisplayOrder } from "../lib/task/newTask";
import { computeIndent, computeOutdent } from "../lib/task/indentOutdent";
import { computeSiblingReorderIds, type DropZone } from "../lib/dragReorder";
import { computeMultiReorder, type MultiDropPosition, type MultiReorderPatch } from "../lib/task/multiReorder";
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

  // PJが変わる移動では、子孫（何段でも）も同じPJへ揃える（親子は同じPJ）。グループは外す（別PJのグループを指さない）。
  // 保存は最新のストアの値に重ねる（先に保存した親の updated_at と食い違わないように）
  const carryProjectToDescendants = useCallback(async (rootId: string, projectId: string | null) => {
    const latest = useAppStore.getState().tasks;
    const kids = descendantsOf(rootId, buildChildrenMap(latest)).filter(c => (c.project_id ?? null) !== projectId);
    for (const c of kids) {
      await saveTask({ ...c, project_id: projectId, section_id: null, updated_by: currentUserId });
    }
  }, [saveTask, currentUserId]);

  // タスクをドロップ先タスクの行の「どこ」に落としたかで挙動を分ける：
  // - 上端/下端（before/after）：ドロップ先と同じ階層（同じ親、または両方最上位）の並びに挿入。
  //   ドロップ先が最上位で dragged が子だった場合はここで最上位に昇格する（＝子→親）。
  //   ドロップ先が子で dragged が最上位だった場合はここでその子の兄弟になる（＝親→子）
  // - 中央（nest）：ドロップ先の子にする（呼び出し側がこのゾーンを提供する場合のみ発生。
  //   GanttViewは常に allowNest=false でゾーンを算出するため実質発生しない）
  // 子持ちのタスクも子にできる（子孫ごと移る）。自分の子孫の下へは入れない（循環）。
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

    const cycleToast = () => showToast("自分自身や自分の子タスクの下には移せません（循環になります）", "error");

    if (zone === "nest") {
      if (dragged.parent_task_id === target.id) return; // 既に子
      if (wouldCreateParentCycle(allTasks, dragged.id, target.id)) { cycleToast(); return; }
      try {
        await saveTask({
          ...dragged, parent_task_id: target.id, project_id: target.project_id,
          display_order: nextDisplayOrder(allTasks, target.project_id ?? null, target.id),
          updated_by: currentUserId,
        });
        await carryProjectToDescendants(dragged.id, target.project_id ?? null);
        onReordered?.();
      } catch (err) {
        showToast(formatErrorForUser("親子変更に失敗しました", err), "error");
      }
      return;
    }

    const newParentId = target.parent_task_id ?? null;
    const newProjectId = target.project_id ?? null;
    if (wouldCreateParentCycle(allTasks, draggedId, newParentId)) { cycleToast(); return; }
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
      await carryProjectToDescendants(draggedId, newProjectId);
      onReordered?.();
    } catch (err) {
      showToast(formatErrorForUser("並べ替えに失敗しました", err), "error");
    }
  }, [allTasks, saveTask, currentUserId, onReordered, carryProjectToDescendants]);

  // PJ見出しへのドロップ＝親を解除して指定PJの最上位タスクの末尾に追加する（子→親）。
  const handleUnparentDrop = useCallback(async (draggedId: string, projectId: string) => {
    const dragged = allTasks.find(t => t.id === draggedId);
    if (!dragged) return;
    if (!dragged.parent_task_id && (dragged.project_id ?? null) === projectId) return; // 変化なし
    const isTop = (t: Task) => !t.parent_task_id && (t.project_id ?? null) === projectId;
    const maxOrder = allTasks.filter(isTop).reduce((m, t) => Math.max(m, t.display_order ?? 0), -1);
    try {
      await saveTask({ ...dragged, parent_task_id: null, project_id: projectId, display_order: maxOrder + 1, updated_by: currentUserId });
      await carryProjectToDescendants(draggedId, projectId);
      onReordered?.();
    } catch (err) {
      showToast(formatErrorForUser("親の解除に失敗しました", err), "error");
    }
  }, [allTasks, saveTask, currentUserId, onReordered, carryProjectToDescendants]);

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
      await carryProjectToDescendants(draggedId, projectId);
      onReordered?.();
    } catch (err) {
      showToast(formatErrorForUser("グループの移動に失敗しました", err), "error");
    }
  }, [allTasks, saveTask, currentUserId, onReordered, carryProjectToDescendants]);

  // 親・並びの patch を最新のストアの値に重ねて保存し、「元に戻す」トーストを出す（Ctrl+Z でも戻る）。
  // Undo は「Undo 時点の最新タスク」に旧値だけを当て直す（古いスナップショット全体の保存は楽観ロックと衝突するため）
  const applyPatches = useCallback(async (patches: MultiReorderPatch[], successMessage: string, failPrefix: string) => {
    try {
      const latestOf = (id: string) => useAppStore.getState().tasks.find(x => x.id === id);
      await Promise.all(patches.map(({ id, patch }) => {
        const t = latestOf(id);
        return t ? saveTask({ ...t, ...patch, updated_by: currentUserId }) : Promise.resolve();
      }));
      onReordered?.();
      showToast(successMessage, "success", {
        label: "元に戻す",
        isUndo: true,
        onClick: () => {
          const tasksNow = useAppStore.getState().tasks;
          void settleUndoSaves(patches.map(({ id, prev }) => {
            const t = tasksNow.find(x => x.id === id);
            return t ? saveTask({ ...t, ...prev, updated_by: currentUserId }) : Promise.resolve();
          }));
        },
      });
    } catch (err) {
      showToast(formatErrorForUser(failPrefix, err), "error");
    }
  }, [saveTask, currentUserId, onReordered]);

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
    await applyPatches(result.patches, `${result.movedCount}件のタスクをまとめて移動しました`, "まとめての並べ替えに失敗しました");
  }, [allTasks, applyPatches]);

  // Tab（1段下げる）／Shift+Tab（1段上げる）。targetIds＝選択中のタスク（無ければ注目中の1件）。
  // 戻り値＝キー操作を引き受けたか（false ならブラウザ標準の Tab を奪わない）。
  // Tab で子が増えた親が折りたたまれていれば、onExpand で開いてもらう（動かしたタスクが画面から消えないように）
  const handleIndentOutdent = useCallback(async (
    dir: 1 | -1,
    targetIds: string[],
    orderedVisibleIds: string[],
    onExpand?: (parentIds: string[]) => void,
  ): Promise<boolean> => {
    const result = dir === 1
      ? computeIndent(allTasks, orderedVisibleIds, targetIds)
      : computeOutdent(allTasks, orderedVisibleIds, targetIds);
    if (result.patches.length === 0) {
      if (result.skippedCount > 0) {
        showToast(dir === 1 ? "1つ上に同じ階層のタスクが無いため、下げられません" : "最上位のタスクは上げられません", "info");
        return true;
      }
      return false;
    }
    onExpand?.(result.newParentIds);
    await applyPatches(
      result.patches,
      dir === 1 ? `${result.movedCount}件のタスクを1段下げました` : `${result.movedCount}件のタスクを1段上げました`,
      dir === 1 ? "階層を下げるのに失敗しました" : "階層を上げるのに失敗しました",
    );
    return true;
  }, [allTasks, applyPatches]);

  return { draggingId, setDraggingId, dropZone, setDropZone, handleTaskDrop, handleMultiTaskDrop, handleIndentOutdent, handleUnparentDrop, handleSectionDrop };
}
