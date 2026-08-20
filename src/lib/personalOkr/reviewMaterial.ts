// src/lib/personalOkr/reviewMaterial.ts
//
// 【設計意図】
// 月末の振り返り下書き（Phase 4・docs/dev/okr-redesign-plan.md §8）の「材料」＝
// 機械計算・ゼロトークンの集計。①画面に即時描画する②AIへ渡す文脈にも含める、の
// 両方で使う唯一の集計元にする（YAGNIな二重実装を避ける）。
//
// 🔴 既存の aheadCompute.ts / aheadTaskStats.ts を再利用し、同じ計算を書き直さない
// （山本さんの指示）。週の◯／△／✕の内訳・未評価週数は computeAheadFacts（Phase 3前半）を
// そのまま使い、タスクの遅延／停滞／先行待ちは summarizeLinkedTaskStatus をそのまま使う。
// このファイルで新規に足すのは「紐づくタスクの完了/未完了件数」（既存の集計関数には
// 無い切り口）だけ。

import type { MonthWeekSegment } from "../date/monthWeeks";
import type { PersonalKrWeek, Task, TaskDependency } from "../localData/types";
import { computeAheadFacts, type WeekRatingCounts } from "./aheadCompute";
import { summarizeLinkedTaskStatus, type LinkedTaskStatusSummary } from "./aheadTaskStats";

export interface ReviewMaterial {
  /** 対象月の週の総数（computeMonthWeekSegmentsが返すセグメント数） */
  weeksTotal: number;
  /** 週の自己評価の内訳（◯／△／✕の件数） */
  ratingCounts: WeekRatingCounts;
  /** 目標状態(goal_state)が設定済みの週数 */
  weeksWithGoalSet: number;
  /** 自己評価が未評価の週数（weeksTotal - (o+t+x)の件数） */
  unratedWeekCount: number;
  /** 紐づくタスクの総数（ユニーク・週をまたいだ重複は除く） */
  linkedTaskCount: number;
  /** 紐づくタスクのうちstatus==="done"の件数 */
  completedTaskCount: number;
  /** 紐づくタスクのうち未完了の件数（linkedTaskCount - completedTaskCount） */
  incompleteTaskCount: number;
  /** 遅延・停滞・先行待ちの件数（既存のaheadTaskStats.tsをそのまま再利用） */
  taskStats: LinkedTaskStatusSummary;
}

/**
 * 対象月の振り返り材料を組む。segments・existingWeeksは対象月のもの（過去月でもよい）。
 * linkedTasksは週をまたいだ重複を除いたユニークなタスク配列（呼び出し側が用意する。
 * PersonalKrPanel.tsxのmonthLinkedTasksと同じ組み立て方）。
 */
export function computeReviewMaterial(
  segments: MonthWeekSegment[],
  existingWeeks: PersonalKrWeek[],
  linkedTasks: Task[],
  allTasks: Task[],
  taskDependencies: TaskDependency[],
  today: Date = new Date(),
): ReviewMaterial {
  const facts = computeAheadFacts(segments, existingWeeks, today);
  const weeksTotal = segments.length;
  const ratedCount = facts.ratingCounts.o + facts.ratingCounts.t + facts.ratingCounts.x;
  const weeksWithGoalSet = Math.max(0, weeksTotal - facts.unsetGoalWeekLabels.length);
  const unratedWeekCount = Math.max(0, weeksTotal - ratedCount);
  const taskStats = summarizeLinkedTaskStatus(linkedTasks, allTasks, taskDependencies);
  const completedTaskCount = linkedTasks.filter(t => t.status === "done").length;
  const incompleteTaskCount = linkedTasks.length - completedTaskCount;

  return {
    weeksTotal,
    ratingCounts: facts.ratingCounts,
    weeksWithGoalSet,
    unratedWeekCount,
    linkedTaskCount: linkedTasks.length,
    completedTaskCount,
    incompleteTaskCount,
    taskStats,
  };
}

/**
 * 生成ボタンの非活性判定（D3）：「その月の週の目標状態が0本」かつ「自己評価が全て未評価」
 * なら材料が無いとみなす。どちらか一方でも材料があれば下書きは生成できる
 * （目標状態だけ書いてあれば「計画はしたが未達だった」という振り返りが書けるため）。
 */
export function isReviewMaterialEmpty(material: ReviewMaterial): boolean {
  const ratedCount = material.ratingCounts.o + material.ratingCounts.t + material.ratingCounts.x;
  return material.weeksWithGoalSet === 0 && ratedCount === 0;
}
