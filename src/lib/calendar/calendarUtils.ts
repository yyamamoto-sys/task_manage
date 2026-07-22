// src/lib/calendar/calendarUtils.ts
//
// 【設計意図】
// CalendarLabView（ラボ機能・刷新第2弾）の座標計算・純粋ロジックをコンポーネントから分離する。
// ガントの ganttUtils.ts（computeMilestoneBands 等）と同じ流儀：DOM実測は行わず、
// CSS Grid の列幅が均等であることを前提に % 計算のみで座標を出す。
//
// 対象：
//  ④ 週表示：cells（Date[]）を7日ずつの週配列に分割する chunkIntoWeeks
//  ⑤ 期間バー：start_date〜due_date を持つタスクに、重ならない表示レーンを割り当てる
//     assignBarLanes と、1週間分の座標（left%/width%）を出す computeWeekBarSegments

import { toDate, diffDays } from "../date";

/** cells（週の先頭=日曜始まりで7の倍数個並んだ日付配列）を7日ずつの週配列に分割する */
export function chunkIntoWeeks(cells: Date[]): Date[][] {
  const weeks: Date[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }
  return weeks;
}

export interface CalendarBarTask {
  id: string;
  start_date: string | null | undefined;
  due_date: string | null | undefined;
}

/**
 * 開始日・期日の両方を持つタスク群に、重ならない表示レーン番号（0始まり）を割り当てる。
 * 区間スケジューリングの貪欲法：開始日が早い順に、既に使われているレーンのうち
 * 「そのタスクの開始日より前に前のタスクが終わっている」最小番号のレーンへ割り当てる。
 * レーン番号はタスク単位でグローバルに1つに決まるため、複数週にわたって描画しても
 * 同じタスクが週ごとに段（縦位置）がずれることはない。
 *
 * 開始日・期日のいずれかが無い／開始日が期日より後（無効な範囲）のタスクは対象外（レーンを持たない＝Mapに現れない）。
 */
export function assignBarLanes(tasks: CalendarBarTask[]): Map<string, number> {
  const valid = tasks
    .map(t => ({ id: t.id, start: toDate(t.start_date), due: toDate(t.due_date) }))
    .filter((t): t is { id: string; start: Date; due: Date } => !!t.start && !!t.due && t.start <= t.due)
    .sort((a, b) => a.start.getTime() - b.start.getTime() || a.due.getTime() - b.due.getTime());

  const laneEnds: Date[] = []; // laneEnds[i] = そのレーンに最後に置いたタスクの期日
  const result = new Map<string, number>();
  for (const t of valid) {
    let lane = laneEnds.findIndex(end => end < t.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(t.due);
    } else {
      laneEnds[lane] = t.due;
    }
    result.set(t.id, lane);
  }
  return result;
}

export interface WeekBarSegment {
  taskId: string;
  lane: number;
  /** 週の左端からの位置（0〜100の%） */
  leftPct: number;
  /** バーの幅（0〜100の%） */
  widthPct: number;
}

/**
 * 1週間分（日曜始まり7日、weekStart〜weekEnd）の期間バー座標を計算する。
 * 週をまたぐタスクは、この関数を週ごとに呼び出すことで自然に分割される
 * （各呼び出しは対象週との重なり区間だけを切り出して % 化するため、月の端で切れるケースも
 * 追加ロジックなしで扱える＝weekStart/weekEndの範囲内にクランプされるだけ）。
 * lanes は assignBarLanes で算出したグローバルなレーン番号をそのまま渡す（この関数内では計算しない）。
 */
export function computeWeekBarSegments(
  weekStart: Date,
  weekEnd: Date,
  tasks: CalendarBarTask[],
  lanes: Map<string, number>,
): WeekBarSegment[] {
  const segments: WeekBarSegment[] = [];
  for (const t of tasks) {
    const start = toDate(t.start_date);
    const due = toDate(t.due_date);
    if (!start || !due || start > due) continue;
    const lane = lanes.get(t.id);
    if (lane === undefined) continue;

    const segStart = start > weekStart ? start : weekStart;
    const segEnd = due < weekEnd ? due : weekEnd;
    if (segStart > segEnd) continue; // この週とは重ならない

    const dayIndexStart = diffDays(weekStart, segStart);
    const daysCount = diffDays(segStart, segEnd) + 1;
    segments.push({
      taskId: t.id,
      lane,
      leftPct: (dayIndexStart / 7) * 100,
      widthPct: (daysCount / 7) * 100,
    });
  }
  return segments;
}
