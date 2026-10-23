// ダッシュボードのKPI「進行中」「今週の完了率」の算出（M79）。
// 期限超過（alertTasks）・PJ進捗と同じ「葉タスク基準」に揃える：子を持つ親タスクは数えない。
// 親は子の状態から自動で進行中・完了になるため、親と子を両方数えると同じ仕事が二重に入る。
// 親判定は絞り込み前の allTasks で行う（filteredTasks で子だけが外れていても親を誤って残さないため）。
import type { Task } from "./localData/types";
import { isParentTask } from "./taskHierarchy";
import { isPausedOrCancelledStatus } from "./taskMeta";
import { calcProgressPct } from "./stats";

export function computeKpiInProgressCount(filteredTasks: Task[], allTasks: Task[]): number {
  return filteredTasks.filter(t => t.status === "in_progress" && !isParentTask(t, allTasks)).length;
}

/** 今週締切のタスク（完了済みも含む）のうち完了済みの割合。中止・保留は分母からも外す。 */
export function computeKpiWeekCompletion(
  filteredTasks: Task[], allTasks: Task[], todayS: string, weekLater: string,
): { done: number; total: number; pct: number } {
  const weekDue = filteredTasks.filter(t =>
    t.due_date && t.due_date >= todayS && t.due_date <= weekLater
    && !isPausedOrCancelledStatus(t.status) && !isParentTask(t, allTasks),
  );
  const done = weekDue.filter(t => t.status === "done").length;
  return { done, total: weekDue.length, pct: calcProgressPct(done, weekDue.length) };
}
