// src/lib/personalOkr/weekLayout.ts
//
// 【設計意図】
// 月→週セグメント（src/lib/date/monthWeeks.ts）と、DBに保存済みの週レコード
// （personal_kr_weeks）を突き合わせ、画面の週カード用データを作る純粋関数。
// 🔴 セグメント数をそのまま使い、5列に切り詰めない・6列に打ち切らない（週は月初の曜日次第で
// 5にも6にもなる。docs/dev/okr-redesign-plan.md §3-3・CLAUDE.md Section 24）。
// 空の週レコードを事前に一括作成しない設計のため、レコードが無いセグメントは
// existing:null（未設定）を返すだけで、ここではINSERTしない（呼び出し側が
// goal_state/self_ratingを書いた時点で初めて行を作る）。

import type { MonthWeekSegment } from "../date/monthWeeks";
import type { PersonalKrWeek } from "../localData/types";
import { toDateStr } from "../date";

export interface WeekCardData {
  weekIndex: number;
  weekStartStr: string;
  weekEndStr: string;
  existing: PersonalKrWeek | null;
}

/** セグメント数（＝週の数）をそのまま使う。5週固定・6週打ち切りにしない */
export function buildWeekCards(segments: MonthWeekSegment[], existingWeeks: PersonalKrWeek[]): WeekCardData[] {
  const byIndex = new Map(existingWeeks.map(w => [w.week_index, w]));
  return segments.map(seg => ({
    weekIndex: seg.weekIndex,
    weekStartStr: toDateStr(seg.weekStart),
    weekEndStr: toDateStr(seg.weekEnd),
    existing: byIndex.get(seg.weekIndex) ?? null,
  }));
}
