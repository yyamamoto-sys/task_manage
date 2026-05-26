// src/lib/okr/eligibleTaskForces.ts
//
// タスクの期日が属する四半期に紐づく TF だけを返すヘルパー。
// TaskSidePanel / TaskEditModal の「＋ タスクフォースを追加」セレクトで使う。
// 過去クォーターで運用していた TF を誤って追加できないようにする目的。
//
// 【2026-05-26 変更】TF→四半期の判定を quarterly_kr_task_forces(QKTF) から
// TaskForce.quarter 列ベース（effectiveTfQuarter）に統一した。

import type { Task, TaskForce } from "../localData/types";
import { dateToQuarter, currentQuarter } from "../date";
import { effectiveTfQuarter } from "./tfQuarter";

/**
 * 判定優先順位：
 *   1. task.due_date → その四半期
 *   2. なければ task.start_date → その四半期
 *   3. どちらもなければ「今日の四半期」
 *
 * 戻り値：
 *   - Set<string>：対象四半期に属する TF id 集合（tf.quarter基準。未設定legacyは今期扱い）
 *   - null：タスクが未設定で絞り込み不可（呼び出し側で「全TF」扱い）
 */
export function getEligibleTfIds(
  task: Pick<Task, "due_date" | "start_date"> | null | undefined,
  allTaskForces: TaskForce[],
): Set<string> | null {
  if (!task) return null;
  const quarter = dateToQuarter(task.due_date)
               ?? dateToQuarter(task.start_date)
               ?? currentQuarter();
  return new Set(
    allTaskForces
      .filter(tf => !tf.is_deleted && effectiveTfQuarter(tf) === quarter)
      .map(tf => tf.id),
  );
}
