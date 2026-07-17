// src/lib/dependencies/cycleCheck.ts
//
// 【設計意図】
// タスク依存関係（先行→後続）に循環（A→B→…→A）を作らないためのクライアント側チェック。
// DB側の制約だけでは循環防止を表現できない（再帰CTEでのCHECK制約は実用的でない）ため、
// 依存を追加するあらゆる経路（UI・将来のAI機能等）は必ず canAddDependency を通すこと。

import type { TaskDependency } from "../localData/types";

type DependencyEdge = Pick<TaskDependency, "predecessor_task_id" | "successor_task_id">;

/**
 * predecessorId → successorId の辺を追加すると、既存の依存グラフに循環ができてしまうかを判定する。
 * 「successorId から predecessorId へ既に辿り着けるか」を DFS で調べる
 * （辿り着けるなら、逆向きの辺を足すと循環になる）。
 */
export function wouldCreateCycle(
  deps: DependencyEdge[],
  predecessorId: string,
  successorId: string,
): boolean {
  if (predecessorId === successorId) return true;

  const adjacency = new Map<string, string[]>();
  for (const d of deps) {
    const list = adjacency.get(d.predecessor_task_id) ?? [];
    list.push(d.successor_task_id);
    adjacency.set(d.predecessor_task_id, list);
  }

  const visited = new Set<string>();
  const stack = [successorId];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur === predecessorId) return true;
    if (visited.has(cur)) continue;
    visited.add(cur);
    for (const next of adjacency.get(cur) ?? []) stack.push(next);
  }
  return false;
}

export interface DependencyCheckResult {
  ok: boolean;
  reason?: string;
}

/**
 * 依存追加のバリデーション（自己依存・重複・循環）。
 * UIの「先行タスクを追加」操作・store の addTaskDependency は必ずこれを通す。
 */
export function canAddDependency(
  deps: DependencyEdge[],
  predecessorId: string,
  successorId: string,
): DependencyCheckResult {
  if (predecessorId === successorId) {
    return { ok: false, reason: "自分自身を先行タスクにはできません" };
  }
  const isDuplicate = deps.some(
    d => d.predecessor_task_id === predecessorId && d.successor_task_id === successorId,
  );
  if (isDuplicate) {
    return { ok: false, reason: "すでに設定済みの先行タスクです" };
  }
  if (wouldCreateCycle(deps, predecessorId, successorId)) {
    return { ok: false, reason: "この組み合わせだと依存関係が循環してしまうため設定できません" };
  }
  return { ok: true };
}
