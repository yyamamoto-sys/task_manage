// src/lib/personalOkr/aheadTaskStats.ts
//
// 【設計意図】
// 「これから」ブロックの機械計算のうち、当月の週に紐づくタスクの状況（遅延・停滞・先行待ち）を
// 集計する。🔴 既存ロジックを再実装しない（docs/dev/okr-redesign-plan.md §5-1・§7の指示）：
// ベースライン差分は computeDelayDays（B4）、先行待ちは getIncompletePredecessors（B1）、
// 停滞は isTaskStagnant（既存判定関数。CLAUDE.md Section 3-6・AlertTasksWidget.tsxと同じ流儀）を
// そのまま使う。新しい判定基準は一切作らない。

import type { Task, TaskDependency } from "../localData/types";
import { computeDelayDays, isTaskStagnant } from "../../components/gantt/ganttUtils";
import { getIncompletePredecessors } from "../dependencies/gate";

export interface LinkedTaskStatusSummary {
  /** ベースライン差分が遅延側（computeDelayDays > 0）のタスク件数 */
  delayedCount: number;
  /** isTaskStagnant（in_progressのまま5日以上更新なし）のタスク件数 */
  stagnantCount: number;
  /** 未完了の先行タスクが1件以上あるタスク件数 */
  blockedCount: number;
}

/**
 * linkedTasks は重複を含まない前提（呼び出し側が週をまたいだタスクIDをユニーク化してから渡す）。
 * allTasks・taskDependencies は先行判定（getIncompletePredecessors）に必要な全体データ。
 */
export function summarizeLinkedTaskStatus(
  linkedTasks: Task[],
  allTasks: Task[],
  taskDependencies: TaskDependency[],
): LinkedTaskStatusSummary {
  let delayedCount = 0;
  let stagnantCount = 0;
  let blockedCount = 0;

  for (const task of linkedTasks) {
    const delay = computeDelayDays(task);
    if (delay !== null && delay > 0) delayedCount++;
    if (isTaskStagnant(task)) stagnantCount++;
    if (getIncompletePredecessors(task.id, allTasks, taskDependencies).length > 0) blockedCount++;
  }

  return { delayedCount, stagnantCount, blockedCount };
}
