// src/lib/task/selectionWithChildren.ts
//
// 【設計意図】
// 「親タスクを選択したら子タスクも一括で選択に加わる」を実現する純粋関数（CLAUDE.md v3.108）。
// 階層は任意の深さ（v3.195〜）。親を選ぶと子孫すべて（子・孫…）が対象になる。
//
// - 親を選択 → 直下の子も選択に加わる（addTaskWithChildren）
// - 親を解除 → 直下の子も選択から外れる（removeTaskWithChildren）
// - 子を個別に付け外しするのはこの後も自由（子タスク自身には子が居ないため、
//   子IDを対象に呼んでもその子1件だけが増減し、親の選択状態には触れない）
//
// ListView/KanbanView/GanttViewの3画面が共有する選択state（それぞれ setSelectedIds /
// setSelectedTaskIds）の「1件をトグルする」呼び出し口（choke point）から、選択追加時は
// addTaskWithChildren・選択解除時は removeTaskWithChildren を呼ぶことで3画面共通の挙動にする。

import type { Task } from "../localData/types";
import { buildChildrenMap, descendantsOf } from "../taskHierarchy";

/** taskId の子孫（子・孫…）の、論理削除されていないタスクのidを返す（循環でも止まる） */
function childIdsOf(taskId: string, allTasks: Task[]): string[] {
  return descendantsOf(taskId, buildChildrenMap(allTasks)).map(t => t.id);
}

/**
 * taskId（と、taskId が親であればその直下の子）を選択に加えた新しい Set を返す。
 * 元の selectedIds は変更しない（新しい Set を返す）。
 */
export function addTaskWithChildren(selectedIds: Set<string>, taskId: string, allTasks: Task[]): Set<string> {
  const next = new Set(selectedIds);
  next.add(taskId);
  for (const childId of childIdsOf(taskId, allTasks)) next.add(childId);
  return next;
}

/**
 * taskId（と、taskId が親であればその直下の子）を選択から外した新しい Set を返す。
 * 元の selectedIds は変更しない（新しい Set を返す）。
 */
export function removeTaskWithChildren(selectedIds: Set<string>, taskId: string, allTasks: Task[]): Set<string> {
  const next = new Set(selectedIds);
  next.delete(taskId);
  for (const childId of childIdsOf(taskId, allTasks)) next.delete(childId);
  return next;
}

/**
 * 「選択トグル」の唯一の判断ロジック：既に選択中なら（子ごと）解除、未選択なら（子ごと）追加する。
 * ListView/KanbanView/GanttView の toggleSelect 系関数は、この関数を呼ぶだけで
 * 親子選択の挙動を共有できる（choke point）。
 */
export function toggleTaskWithChildren(selectedIds: Set<string>, taskId: string, allTasks: Task[]): Set<string> {
  return selectedIds.has(taskId)
    ? removeTaskWithChildren(selectedIds, taskId, allTasks)
    : addTaskWithChildren(selectedIds, taskId, allTasks);
}

/**
 * 選択から、いま存在しない（削除された・他の人に削除された）タスクのidを取り除く。
 * 変化が無ければ同じ Set を返す（無駄な再描画を避ける）。
 */
export function pruneSelection(selectedIds: Set<string>, allTasks: Task[]): Set<string> {
  if (selectedIds.size === 0) return selectedIds;
  const alive = new Set(allTasks.map(t => t.id));
  let changed = false;
  const next = new Set<string>();
  selectedIds.forEach(id => {
    if (alive.has(id)) next.add(id);
    else changed = true;
  });
  return changed ? next : selectedIds;
}
