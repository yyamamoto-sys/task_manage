// src/lib/taskHierarchy.ts
//
// 【設計意図】
// タスク階層（PJ > 大タスク > 小タスク・2階層固定）の「唯一の真実」。
// 親のステータス・進捗は子から都度算出する派生値であり、DB には保存しない
// （CLAUDE.md / docs/dev/task-hierarchy-design.md §5.5「派生値は state に保存しない」方針）。
// List・Dashboard・ProjectKarte・payloadBuilder・AI・DnD は必ずこのヘルパーを使い、
// 各所で再実装しない。進捗% は既存 stats.ts の calcProgressPct を再利用する
// （新しい進捗計算式を作らない）。
//
// 【マイグレーション未適用でも安全に動くこと】
// parent_task_id=undefined / display_order=undefined を許容する。
// - 親なし扱い（全タスク最上位） → 誰も子を持たない＝全タスクが葉
// - ソートは display_order ?? 0
// したがってフラットなデータでは「葉=全タスク」となり、進捗集計は従来と完全一致する。

import type { Task } from "./localData/types";
import { calcProgressPct } from "./stats";

/** display_order（未設定は0）→ created_at の昇順で安定ソートする内部ヘルパー */
function sortByOrder(a: Task, b: Task): number {
  const oa = a.display_order ?? 0;
  const ob = b.display_order ?? 0;
  if (oa !== ob) return oa - ob;
  return (a.created_at ?? "").localeCompare(b.created_at ?? "");
}

/** parentId の非削除の子（display_order→created_at 順） */
export function childrenOf(tasks: Task[], parentId: string): Task[] {
  return tasks
    .filter(t => !t.is_deleted && t.parent_task_id === parentId)
    .sort(sortByOrder);
}

/**
 * task が子を1件以上持つか（＝大タスク）。
 * 子0件のフラットなタスクでは false → 葉として扱われる。
 */
export function isParentTask(task: Task, tasks: Task[]): boolean {
  return tasks.some(t => !t.is_deleted && t.parent_task_id === task.id);
}

/**
 * 子を持たないタスク（進捗集計の単位＝葉）。
 * フラットデータでは誰も子を持たないので「葉=全非削除タスク」になり、
 * done/total 集計が従来と完全一致する。
 */
export function leafTasks(tasks: Task[]): Task[] {
  // 子を持つ親IDの集合を先に作る（O(n) 化）
  const parentIds = new Set<string>();
  for (const t of tasks) {
    if (!t.is_deleted && t.parent_task_id) parentIds.add(t.parent_task_id);
  }
  return tasks.filter(t => !t.is_deleted && !parentIds.has(t.id));
}

/** 最上位タスク（parent_task_id 無し・非削除） */
export function topLevelTasks(tasks: Task[]): Task[] {
  return tasks
    .filter(t => !t.is_deleted && t.parent_task_id == null)
    .sort(sortByOrder);
}

/**
 * 子から親ステータスを算出：
 * - 子0件 → そのタスク自身の status（フラット/葉タスクは従来どおり手動値）
 * - 全done → "done"
 * - 1件でも done/in_progress があり、かつ全doneでない（＝todoとの混在含む）→ "in_progress"
 * - 全todo → "todo"
 */
export function rollupStatus(task: Task, tasks: Task[]): Task["status"] {
  const children = childrenOf(tasks, task.id);
  if (children.length === 0) return task.status;
  if (children.every(c => c.status === "done")) return "done";
  if (children.every(c => c.status === "todo")) return "todo";
  // done/in_progress/todo の混在（todoとdoneだけの混在も含む）→ in_progress
  return "in_progress";
}

/** 子の完了集計（calcProgressPct 使用） */
export function parentProgress(
  tasks: Task[],
  parentId: string,
): { done: number; total: number; pct: number } {
  const children = childrenOf(tasks, parentId);
  const total = children.length;
  const done = children.filter(c => c.status === "done").length;
  return { done, total, pct: calcProgressPct(done, total) };
}

/**
 * ある task の表示用ステータス（親なら導出・子無しなら自身）。
 * rollupStatus と同義だが、呼び出し意図を明確にするための薄いラッパ。
 */
export function effectiveStatus(task: Task, tasks: Task[]): Task["status"] {
  return rollupStatus(task, tasks);
}

/**
 * PJ内で親に指定できる候補（2階層固定）。
 * - projectId が null → []（親子は同一PJ内のみ）
 * - 最上位タスク（parent_task_id 無し）のみを候補にする
 * - forTaskId（自分自身）は除外
 * - 子を持つタスクも除外しない…のではなく「孫禁止」のため、
 *   ここでは「子を持てる＝最上位」を候補に出す。小タスク（親持ち）は候補に出さない。
 *   （= forTaskId 自身と、親を持つ小タスクを除いた最上位タスク）
 */
export function eligibleParentTasks(
  tasks: Task[],
  projectId: string | null,
  forTaskId?: string,
): Task[] {
  if (projectId == null) return [];
  return tasks
    .filter(t =>
      !t.is_deleted &&
      t.project_id === projectId &&
      t.parent_task_id == null &&   // 最上位のみ（小タスクは親になれない＝孫禁止）
      t.id !== forTaskId,           // 自分自身を除外
    )
    .sort(sortByOrder);
}
