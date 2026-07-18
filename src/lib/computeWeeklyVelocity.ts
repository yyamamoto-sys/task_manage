// src/lib/computeWeeklyVelocity.ts
//
// 【設計意図】
// ダッシュボード「完了ペース」折れ線グラフ用の集計（純粋関数）。
// 完了(done)タスクを completed_at の週（月〜日）で集計する。直近 weeks 週分
// （今週を含む・古い週から順）を返す。today は呼び出し側から渡す（テスト容易性のため
// Date.now() に依存しない）。
//
// completed_at は timestamp（例 "2026-07-15T03:12:45.123Z"）。日付部分の切り出しは
// payloadBuilder.ts 等の既存コードと同じ流儀で slice(0, 10) を使う（toDate() によるローカル
// タイムゾーン変換を避け、日付跨ぎのズレを防ぐ）。

import type { Task } from "./localData/types";
import { toDate, toDateStr, addDays, formatMD } from "./date";

export interface WeeklyVelocityBucket {
  /** その週の月曜日（YYYY-MM-DD） */
  weekStart: string;
  /** 表示ラベル（"M/D"＝週の月曜日） */
  label: string;
  count: number;
}

const VELOCITY_WEEKS = 8;

/**
 * 完了(done)タスクを completed_at の週（月〜日）で日別集計する。
 * @param tasks スコープ済みタスク（PJ選択/自分のみを尊重した呼び出し側の filteredTasks を渡す想定）
 * @param today YYYY-MM-DD（基準日）
 * @param weeks 今週を含む集計週数（既定8）
 */
export function computeWeeklyVelocity(tasks: Task[], today: string, weeks: number = VELOCITY_WEEKS): WeeklyVelocityBucket[] {
  const base = toDate(today) ?? new Date(today);
  const dow = base.getDay(); // 0=日, 1=月
  const daysToMonday = dow === 0 ? -6 : 1 - dow;
  const currentMonday = addDays(base, daysToMonday);

  const buckets: WeeklyVelocityBucket[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const weekStartDate = addDays(currentMonday, -7 * i);
    const weekStart = toDateStr(weekStartDate);
    const weekEnd = toDateStr(addDays(weekStartDate, 6));

    const count = tasks.filter(t => {
      if (t.is_deleted || t.status !== "done" || !t.completed_at) return false;
      const ds = t.completed_at.slice(0, 10);
      return ds >= weekStart && ds <= weekEnd;
    }).length;

    buckets.push({ weekStart, label: formatMD(weekStart), count });
  }

  return buckets;
}
