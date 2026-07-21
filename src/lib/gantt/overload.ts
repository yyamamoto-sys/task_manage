// src/lib/gantt/overload.ts
//
// 【設計意図】人別ガントビューの過負荷（オーバーアロケーション）可視化。
// あるメンバーが同時に抱えるアクティブ（todo/in_progress。done・cancelled・on_holdは除く）
// タスクの数が閾値を超える日を「過負荷日」とし、
// 連続する過負荷日をひとつの区間にまとめて返す。工数（estimated_hours）は入力が疎なため、
// 件数ベース（同時に重なっているタスク数）を判定の主軸にする（CLAUDE.md方針）。
//
// 対象タスクは呼び出し側で「そのメンバーのアクティブ（done以外）タスク」に絞り込み済みであること
// （src/lib/workload/computeWorkload.ts の getMemberActiveTasks と同じ判定基準を共有する想定）。

import type { Task } from "../localData/types";
import { toDate, toDateStr, addDays } from "../date";
import { isActiveTaskStatus } from "../taskMeta";

/** 既定の過負荷閾値：同時アクティブタスク数がこれを超えたら過負荷（4件以上で過負荷＝3件以下は許容）。 */
export const OVERLOAD_THRESHOLD_DEFAULT = 3;

export interface OverloadRange {
  /** 過負荷区間の開始日（YYYY-MM-DD、含む） */
  start: string;
  /** 過負荷区間の終了日（YYYY-MM-DD、含む） */
  end: string;
}

/**
 * メンバーのアクティブタスク一覧から、同時アクティブタスク数が threshold を超える日を求め、
 * 連続する日をひとつの区間にまとめて返す（純粋関数）。
 * - タスクは start_date〜due_date の期間その日を占有する。開始日が無い（期日のみ）タスクは
 *   due_date の1日だけ占有する。
 * - start_date > due_date の不整合データは due_date の1日だけ占有する扱い（calcTaskBar と同じフォールバック）。
 * - due_date が無いタスクは対象外（占有日を定義できない）。
 * - rangeStart/rangeEnd の外に出る占有日はクランプする（表示範囲外の走査・過去の異常に長い期間を
 *   持つタスクでの無用なループを避けるため）。
 */
export function computeOverloadRanges(
  memberActiveTasks: Task[],
  rangeStart: Date,
  rangeEnd: Date,
  threshold: number = OVERLOAD_THRESHOLD_DEFAULT,
): OverloadRange[] {
  const clampedStart = new Date(rangeStart);
  clampedStart.setHours(0, 0, 0, 0);
  const clampedEnd = new Date(rangeEnd);
  clampedEnd.setHours(0, 0, 0, 0);
  if (clampedStart > clampedEnd) return [];

  const dayCounts = new Map<string, number>();
  for (const task of memberActiveTasks) {
    if (task.is_deleted || !isActiveTaskStatus(task.status)) continue;
    const due = toDate(task.due_date ?? null);
    if (!due) continue;
    const start = toDate(task.start_date ?? null);
    const occStart = (start && start <= due) ? start : due;
    const s = occStart < clampedStart ? clampedStart : occStart;
    const e = due > clampedEnd ? clampedEnd : due;
    if (s > e) continue;
    let cur = new Date(s);
    while (cur <= e) {
      const key = toDateStr(cur);
      dayCounts.set(key, (dayCounts.get(key) ?? 0) + 1);
      cur = addDays(cur, 1);
    }
  }

  const ranges: OverloadRange[] = [];
  let rangeStartStr: string | null = null;
  let prevStr: string | null = null;
  let cur = new Date(clampedStart);
  while (cur <= clampedEnd) {
    const key = toDateStr(cur);
    const isOverloaded = (dayCounts.get(key) ?? 0) > threshold;
    if (isOverloaded) {
      if (rangeStartStr === null) rangeStartStr = key;
      prevStr = key;
    } else if (rangeStartStr !== null && prevStr !== null) {
      ranges.push({ start: rangeStartStr, end: prevStr });
      rangeStartStr = null;
      prevStr = null;
    }
    cur = addDays(cur, 1);
  }
  if (rangeStartStr !== null && prevStr !== null) {
    ranges.push({ start: rangeStartStr, end: prevStr });
  }
  return ranges;
}
