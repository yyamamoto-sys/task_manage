// src/lib/okr/eligibleTaskForces.ts
//
// タスクの期日が属する四半期に紐づく TF だけを返すヘルパー。
// TaskSidePanel / TaskEditModal の「＋ タスクフォースを追加」セレクトで使う。
// 過去クォーターで運用していた TF を誤って追加できないようにする目的。

import type { Objective, QuarterlyObjective, QuarterlyKrTaskForce, Task } from "../localData/types";
import { dateToQuarter, currentQuarter } from "../date";

/**
 * 判定優先順位：
 *   1. task.due_date → その四半期
 *   2. なければ task.start_date → その四半期
 *   3. どちらもなければ「今日の四半期」
 *
 * 戻り値：
 *   - Set<string>：対象四半期に紐づく TF id 集合（空でもありうる）
 *   - null：タスクや Objective が未設定で絞り込み不可（呼び出し側で「全TF」扱い）
 */
export function getEligibleTfIds(
  task: Pick<Task, "due_date" | "start_date"> | null | undefined,
  objective: Objective | null,
  quarterlyObjectives: QuarterlyObjective[],
  quarterlyKrTaskForces: QuarterlyKrTaskForce[],
): Set<string> | null {
  if (!task || !objective) return null;
  const quarter = dateToQuarter(task.due_date)
               ?? dateToQuarter(task.start_date)
               ?? currentQuarter();
  const targetQObjIds = new Set(
    quarterlyObjectives
      .filter(qo => !qo.is_deleted && qo.objective_id === objective.id && qo.quarter === quarter)
      .map(qo => qo.id),
  );
  if (targetQObjIds.size === 0) return new Set();
  return new Set(
    quarterlyKrTaskForces
      .filter(q => targetQObjIds.has(q.quarterly_objective_id))
      .map(q => q.tf_id),
  );
}
