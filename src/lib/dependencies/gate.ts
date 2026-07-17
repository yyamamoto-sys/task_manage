// src/lib/dependencies/gate.ts
//
// 【設計意図】
// 「完了」の先行タスク・ハードゲートと「着手」のソフト警告、両方が使う共通判定ロジック。
// appStore.saveTask（唯一の choke point）がこれを呼ぶことで、カンバンD&D・ステータスの
// ドロップダウン・インライン編集・ListViewの一括ステータス変更・AI提案の反映など、
// タスクを保存するあらゆる経路で同じ判定になる（UIの1箇所だけで弾く実装は禁止）。

import type { Task, TaskDependency } from "../localData/types";

/**
 * taskId の未完了（status !== "done"）かつ非削除の先行タスクを返す。
 * 依存自体が論理削除されている行（is_deleted）は無視する。
 */
export function getIncompletePredecessors(
  taskId: string,
  tasks: Task[],
  deps: TaskDependency[],
): Task[] {
  const predecessorIds = deps
    .filter(d => !d.is_deleted && d.successor_task_id === taskId)
    .map(d => d.predecessor_task_id);
  if (predecessorIds.length === 0) return [];

  const idSet = new Set(predecessorIds);
  return tasks.filter(t => idSet.has(t.id) && !t.is_deleted && t.status !== "done");
}

/** 未完了の先行タスク名を「」で連結した文字列（トースト表示用） */
export function formatBlockerNames(blockers: Task[]): string {
  return blockers.map(t => `「${t.name}」`).join("、");
}
