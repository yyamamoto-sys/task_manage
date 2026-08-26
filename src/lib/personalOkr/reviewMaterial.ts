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
  const taskStats = summarizeLinkedTaskStatus(linkedTasks, allTasks, taskDependencies);
  const completedTaskCount = linkedTasks.filter(t => t.status === "done").length;
  const incompleteTaskCount = linkedTasks.length - completedTaskCount;

  return {
    weeksTotal,
    ratingCounts: facts.ratingCounts,
    linkedTaskCount: linkedTasks.length,
    completedTaskCount,
    incompleteTaskCount,
    taskStats,
  };
}

/**
 * 生成ボタンの非活性判定（週次の任意化・2026-08-26。旧isReviewMaterialEmptyから改名）。
 * 週の記入がゼロでも、月の計画欄（positioning/activities/target_and_evidence/risks）に
 * 記入があるか、紐づくタスクが1件以上あるか、その月のメモが1件以上あるなら生成できる
 * （週次の記入が無いこと自体を生成不可の理由にしない＝週次は任意の補助機能のため）。
 */
export function isGenerationMaterialEmpty(
  material: ReviewMaterial,
  hasPlanContent: boolean,
  memoCount: number,
): boolean {
  const ratedCount = material.ratingCounts.o + material.ratingCounts.t + material.ratingCounts.x;
  const hasWeekData = ratedCount > 0;
  return !hasWeekData && !hasPlanContent && material.linkedTaskCount === 0 && memoCount === 0;
}
