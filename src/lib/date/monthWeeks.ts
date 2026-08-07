// src/lib/date/monthWeeks.ts
//
// 【設計意図】
// 「月 → 週セグメント（week_index / week_start / week_end）」の共有ロジック。
// 元々 src/components/gantt/ganttUtils.ts（v3.09）にガント専用コードとして実装されていた
// カレンダー週計算のうち、DOM描画・座標計算に依存しない純粋な部分だけをここへ抽出した
// （docs/dev/okr-redesign-plan.md §3-3。個人OKRの週レーンが同じ週の区切り方＝
// 「W1＝月初〜その月で最初の日曜、以後は毎週月曜区切り、月が変わったらW1から数え直す」を
// 必要としたため。週計算を二度書かないこと＝CLAUDE.md okr-redesign-plan.md の明示ルール）。
//
// 【挙動不変の保証】calendarWeekNumber はganttUtils.tsから1文字も変えずに移動しただけの関数。
// ganttUtils.ts はこのファイルから re-export して使う（ganttUtils.test.ts の既存テストは
// 全てcomputeWeekBlocks経由でこの関数を間接的に検証しており、移動後も同じ結果を返す）。

import { getDaysInRange } from "../date";

/** 月内の1週間分のセグメント。week_index は1始まり（W1, W2, ...）。 */
export interface MonthWeekSegment {
  weekIndex: number;
  weekStart: Date;
  weekEnd: Date;
}

/**
 * 日付 → その月内でのカレンダー週番号（1始まり・月曜始まり週で数える）。
 * 月の1日の曜日から「月頭の半端な週（W1）の長さ」を求め（1日が日曜なら1日、それ以外は
 * 次の日曜までの日数）、以降は7日ずつのMon-Sun週として数える。
 * （ganttUtils.ts から移動。元のロジックを一切変更していない）
 */
export function calendarWeekNumber(d: Date): number {
  const day = d.getDate();
  const firstDow = new Date(d.getFullYear(), d.getMonth(), 1).getDay(); // 0=日〜6=土
  const firstWeekLen = firstDow === 0 ? 1 : 8 - firstDow;
  if (day <= firstWeekLen) return 1;
  return 2 + Math.floor((day - firstWeekLen - 1) / 7);
}

/**
 * 指定の月（monthStart＝その月の1日を表す Date。時刻・日は無視し年月だけを見る）の
 * 全日を週セグメントに分割する。
 *
 * W1＝月初〜その月で最初の日曜（1日が日曜ならW1は1日だけ）。以後は月曜始まり7日間。
 * 月末が週の途中で終わる場合は最後のセグメントがその日数だけになる（5週になる月も
 * 自然に生成される＝ハードコードした週数上限は無い）。
 *
 * 【実装方針】calendarWeekNumber を月内の全日に適用し、値が変わるところでセグメントを
 * 区切る（同じアルゴリズムを二重実装しない。1日ずつ判定するため月境界・曜日境界の
 * 特殊ケースを個別に書く必要が無い＝ganttUtils.computeWeekBlocksと結果が食い違う余地がない）。
 */
export function computeMonthWeekSegments(monthStart: Date): MonthWeekSegment[] {
  const year = monthStart.getFullYear();
  const month = monthStart.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0); // 月の最終日
  const days = getDaysInRange(firstDay, lastDay);

  const segments: MonthWeekSegment[] = [];
  for (const d of days) {
    const weekIndex = calendarWeekNumber(d);
    const last = segments[segments.length - 1];
    if (last && last.weekIndex === weekIndex) {
      last.weekEnd = d;
    } else {
      segments.push({ weekIndex, weekStart: d, weekEnd: d });
    }
  }
  return segments;
}
