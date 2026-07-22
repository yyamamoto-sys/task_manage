// src/lib/list/groupSummary.ts
//
// 【設計意図】リストビューのグループ見出し（PJ別/担当者別/状態別/タグ別）の集計。
// 工数の合算方針は computeWorkload.ts と同じ流儀に揃える：工数入力済みタスクのみを
// 合算し、未入力を0扱いしない。1件も入力が無ければ null を返し、呼び出し側で非表示にする。
// KanbanView.tsx の列ヘッダー集計とも共有（同じ関数を列タスク配列に適用している）。

import type { Task } from "../localData/types";
import { isCompletedForProgress } from "../taskMeta";

export interface GroupSummary {
  total: number;
  doneCount: number;
  /** 0〜1。totalが0のときは0 */
  completionRate: number;
  /** 工数入力済みタスクのみの合計。1件も入力が無ければ null（見出しでは非表示にする） */
  totalHours: number | null;
}

export function computeGroupSummary(tasks: Task[]): GroupSummary {
  const total = tasks.length;
  // cancelledはdoneと同じ「完了扱い」で分子に含める（M33解消・CLAUDE.md 2026-07-22）
  const doneCount = tasks.filter(t => isCompletedForProgress(t.status)).length;
  const withEstimate = tasks.filter(t => t.estimated_hours != null);
  const totalHours = withEstimate.length > 0
    ? withEstimate.reduce((sum, t) => sum + (t.estimated_hours ?? 0), 0)
    : null;
  return {
    total,
    doneCount,
    completionRate: total > 0 ? doneCount / total : 0,
    totalHours,
  };
}
