// src/lib/gantt/criticalPath.ts
//
// 【設計意図】ガントビューのクリティカルパス表示。プロジェクトごとに、FS依存グラフ上で
// タスク期間（duration = due - start、暦日、最小1日）を重みとした最長パス（longest path）を求める。
// CPM（Critical Path Method）と同じ考え方で実装する：
//   - forward[t]  = t で終わる最長パスの長さ（重み込み。＝早期終了 ef に相当）
//   - backward[t] = t から始まる最長パスの長さ（重み込み。＝末尾までの残り経路長に相当）
//   - forward[t] + backward[t] - weight[t]（t自身の重みを二重計上しないよう1回引く）が
//     プロジェクト全体の最大値（globalMax）と一致するタスクを「フロート0＝クリティカル」とする。
// 同じ長さの最長パスが複数ある場合は全ての和集合を返す（山本さん確定仕様）。
//
// 依存エッジは両端が同じプロジェクトのタスクであるものだけを使う。プロジェクトをまたぐ依存は
// どちらのプロジェクトのCP計算にも含めない。project_id が無いタスク（ToDo系タスク）はCP計算の
// 対象外（「プロジェクトごとに」という定義上、PJに属さないタスクにクリティカルパスは無い）。
// プロジェクトごとに完全に独立して計算する（フィルタ後のエッジは同一project_id内にしか存在しない
// ため、後段のグラフ探索は自然にプロジェクト単位に分解される）。
//
// 循環データが紛れ込んだ場合（B1のcanAddDependencyでは通常防止済み）は、そのプロジェクトの
// タスクだけクリティカル判定をスキップする（空集合寄与。例外は投げない。reschedule.ts の
// トポロジカルソート安全網と同じ流儀）。

import type { Task, TaskDependency } from "../localData/types";
import { toDate, diffDays } from "../date";
import { isPausedOrCancelledStatus } from "../taskMeta";

/** タスクのduration（暦日）。start/dueどちらか欠けていれば0（安全なフォールバック）。両方あれば最小1日。 */
function taskDuration(task: Task): number {
  const s = toDate(task.start_date ?? null);
  const d = toDate(task.due_date ?? null);
  if (!s || !d) return 0;
  return Math.max(1, diffDays(s, d));
}

/**
 * タスクの配列と依存関係の配列から、クリティカルパス上にあるタスクIDの集合を返す（純粋関数）。
 * is_deleted のタスク・依存は無視する。project_id が無いタスクは対象外。
 */
export function computeCriticalTaskIds(tasks: Task[], dependencies: TaskDependency[]): Set<string> {
  const critical = new Set<string>();

  // 中止(cancelled)・保留(on_hold)のタスクはクリティカルパス計算のノード集合から除外する
  // （＝依存グラフ上「無かったこと」として扱う。is_deletedと同じ扱い。done は引き続き含める＝
  // 完了済みタスクも実績としてパス長に寄与させる。2026-07-21 ステータス拡張）
  const taskById = new Map<string, Task>();
  for (const t of tasks) {
    if (!t.is_deleted && !isPausedOrCancelledStatus(t.status)) taskById.set(t.id, t);
  }
  if (taskById.size === 0) return critical;

  // タスクをプロジェクト単位でグルーピング（project_id が null のタスクは対象外）
  const tasksByProject = new Map<string, Task[]>();
  for (const t of taskById.values()) {
    if (!t.project_id) continue;
    const arr = tasksByProject.get(t.project_id) ?? [];
    arr.push(t);
    tasksByProject.set(t.project_id, arr);
  }
  if (tasksByProject.size === 0) return critical;

  // 依存エッジをプロジェクト単位でグルーピング（両端が同じプロジェクトのタスクであるものだけ採用）
  const edgesByProject = new Map<string, { pred: string; succ: string }[]>();
  for (const dep of dependencies) {
    if (dep.is_deleted) continue;
    const pred = taskById.get(dep.predecessor_task_id);
    const succ = taskById.get(dep.successor_task_id);
    if (!pred || !succ) continue;
    if (!pred.project_id || pred.project_id !== succ.project_id) continue;
    const arr = edgesByProject.get(pred.project_id) ?? [];
    arr.push({ pred: pred.id, succ: succ.id });
    edgesByProject.set(pred.project_id, arr);
  }

  for (const [projectId, projectTasks] of tasksByProject) {
    const result = computeCriticalIdsForProject(projectTasks, edgesByProject.get(projectId) ?? []);
    for (const id of result) critical.add(id);
  }

  return critical;
}

function computeCriticalIdsForProject(
  projectTasks: Task[],
  edges: { pred: string; succ: string }[],
): Set<string> {
  const ids = new Set(projectTasks.map(t => t.id));
  const weight = new Map<string, number>();
  for (const t of projectTasks) weight.set(t.id, taskDuration(t));

  const successorsOf = new Map<string, string[]>();
  const predecessorsOf = new Map<string, string[]>();
  for (const { pred, succ } of edges) {
    successorsOf.set(pred, [...(successorsOf.get(pred) ?? []), succ]);
    predecessorsOf.set(succ, [...(predecessorsOf.get(succ) ?? []), pred]);
  }

  // Kahnのアルゴリズムでトポロジカル順を求める（reschedule.ts と同じ安全網の流儀）。
  // 循環が紛れ込んでいた場合、全ノードを網羅できず topoOrder.length < ids.size となるため、
  // このプロジェクトのクリティカル判定はスキップして空集合を返す（例外は投げない）。
  const inDegree = new Map<string, number>();
  for (const id of ids) inDegree.set(id, (predecessorsOf.get(id) ?? []).length);
  const queue: string[] = [];
  for (const id of ids) if ((inDegree.get(id) ?? 0) === 0) queue.push(id);
  const topoOrder: string[] = [];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    topoOrder.push(cur);
    for (const succ of successorsOf.get(cur) ?? []) {
      if (!ids.has(succ)) continue;
      const next = (inDegree.get(succ) ?? 0) - 1;
      inDegree.set(succ, next);
      if (next === 0) queue.push(succ);
    }
  }
  if (topoOrder.length < ids.size) return new Set(); // 循環フォールバック（空＝強調なし）

  // forward[t]：t で終わる最長パスの長さ（重み込み）。トポロジカル順に前から計算する。
  const forward = new Map<string, number>();
  for (const id of topoOrder) {
    const w = weight.get(id) ?? 0;
    let best = 0;
    for (const p of predecessorsOf.get(id) ?? []) best = Math.max(best, forward.get(p) ?? 0);
    forward.set(id, w + best);
  }

  // backward[t]：t から始まる最長パスの長さ（重み込み）。トポロジカル順の逆順で計算する。
  const backward = new Map<string, number>();
  for (let i = topoOrder.length - 1; i >= 0; i--) {
    const id = topoOrder[i];
    const w = weight.get(id) ?? 0;
    let best = 0;
    for (const s of successorsOf.get(id) ?? []) best = Math.max(best, backward.get(s) ?? 0);
    backward.set(id, w + best);
  }

  const globalMax = topoOrder.reduce((max, id) => Math.max(max, forward.get(id) ?? 0), 0);
  const result = new Set<string>();
  // 全タスクのdurationが0（日付が全て欠けている等）の場合、全タスクが同率0で「クリティカル」に
  // なってしまいノイズにしかならないため、何も強調しない（実務上「意味のある最長パスが無い」状態）。
  if (globalMax === 0) return result;

  for (const id of topoOrder) {
    const f = forward.get(id) ?? 0;
    const b = backward.get(id) ?? 0;
    const w = weight.get(id) ?? 0;
    if (f + b - w === globalMax) result.add(id);
  }
  return result;
}
