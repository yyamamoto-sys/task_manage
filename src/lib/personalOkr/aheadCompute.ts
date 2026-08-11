// src/lib/personalOkr/aheadCompute.ts
//
// 【設計意図】
// 個人OKRビュー「これから」ブロックのうち、AIを一切使わない機械計算パート
// （docs/dev/okr-redesign-plan.md §5-1・§8 Phase 3前半）。既存データ（週の目標状態・
// 自己評価・当月の達成目標）から即時に描画できる事実だけを純粋関数として計算する。
// 「今のままではバンド60に着地する」等の見立て・原因の推定はAIが必要な部分（Phase 3後半）
// であり、ここでは作らない。
//
// タスクの遅延・停滞・先行待ちの集計は aheadTaskStats.ts（別ファイル）に分離した
// （既存ロジック＝computeDelayDays/isTaskStagnant/getIncompletePredecessorsを再利用する側）。

import type { MonthWeekSegment } from "../date/monthWeeks";
import type { PersonalKrWeek, WeekSelfRating } from "../localData/types";
import { diffDays, toDateStr } from "../date";

export interface WeekRatingCounts {
  o: number;
  t: number;
  x: number;
}

export interface AheadFacts {
  /** 当月の残り週数（今日を含む・weekEndが今日以降のセグメント数） */
  weeksRemaining: number;
  /** 月末までの日数（今日を含む。今日が月末なら1） */
  daysUntilMonthEnd: number;
  /** 週の自己評価の積み上げ（◯△✕の件数） */
  ratingCounts: WeekRatingCounts;
  /** 目標状態(goal_state)が未設定の週のラベル一覧（例：["W4","W5"]）。全週が対象 */
  unsetGoalWeekLabels: string[];
  /** 目標状態はあるが自己評価が未評価の週のラベル一覧 */
  unratedWeekLabels: string[];
  /** 残り週（today以降・今週を含む）のうち目標状態が未設定の週のラベル一覧 */
  remainingUnsetGoalWeekLabels: string[];
  /** 上記の件数（= remainingUnsetGoalWeekLabels.length） */
  remainingUnsetGoalCount: number;
}

/**
 * 月→週セグメントとDB保存済みの週レコードから「これから」ブロックの機械計算パートを作る。
 * segments が空（想定外）の場合は全項目を0・空配列で返す（例外を投げない）。
 */
export function computeAheadFacts(
  segments: MonthWeekSegment[],
  existingWeeks: PersonalKrWeek[],
  today: Date = new Date(),
): AheadFacts {
  const byIndex = new Map(existingWeeks.map(w => [w.week_index, w]));
  const ratingCounts: WeekRatingCounts = { o: 0, t: 0, x: 0 };
  const unsetGoalWeekLabels: string[] = [];
  const unratedWeekLabels: string[] = [];
  const remainingUnsetGoalWeekLabels: string[] = [];
  let weeksRemaining = 0;

  const todayStr = toDateStr(today);

  for (const seg of segments) {
    const label = `W${seg.weekIndex}`;
    const existing = byIndex.get(seg.weekIndex) ?? null;
    const goalSet = !!existing?.goal_state && existing.goal_state.trim().length > 0;
    const rating: WeekSelfRating = existing?.self_rating ?? null;

    if (rating === "o") ratingCounts.o++;
    else if (rating === "t") ratingCounts.t++;
    else if (rating === "x") ratingCounts.x++;

    if (!goalSet) unsetGoalWeekLabels.push(label);
    else if (!rating) unratedWeekLabels.push(label);

    const weekEndStr = toDateStr(seg.weekEnd);
    if (weekEndStr >= todayStr) {
      weeksRemaining++;
      if (!goalSet) remainingUnsetGoalWeekLabels.push(label);
    }
  }

  const daysUntilMonthEnd = segments.length > 0
    ? Math.max(0, diffDays(todayStr, toDateStr(segments[segments.length - 1].weekEnd)) + 1)
    : 0;

  return {
    weeksRemaining,
    daysUntilMonthEnd,
    ratingCounts,
    unsetGoalWeekLabels,
    unratedWeekLabels,
    remainingUnsetGoalWeekLabels,
    remainingUnsetGoalCount: remainingUnsetGoalWeekLabels.length,
  };
}

/** 当月末の達成目標(target_and_evidence)が実質的に設定されているか（空白のみは未設定扱い） */
export function isTargetAndEvidenceSet(text: string | null | undefined): boolean {
  return !!text && text.trim().length > 0;
}
