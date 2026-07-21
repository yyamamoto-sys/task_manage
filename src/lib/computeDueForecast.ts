// src/lib/computeDueForecast.ts
//
// 【設計意図】
// ダッシュボード「締切の見通し」棒グラフ用の集計（純粋関数）。
// 未完了タスクを due_date で日別集計する。先頭に「超過」（today より前・未完了）の
// 合計を1件、続けて today から days-1 日後までの各日の件数を1件ずつ返す。
// 期日なしタスクは除外・done/cancelled/on_hold タスクは除外（中止・保留は期限超過として
// 騒がない）。today は呼び出し側から渡す（テスト容易性のため Date.now() に依存しない）。

import type { Task } from "./localData/types";
import { toDate, toDateStr, addDays, formatMD } from "./date";
import { suppressOverdue } from "./taskMeta";

export interface DueForecastBucket {
  /** 表示ラベル。超過バケットは "超過"、日別バケットは "M/D" */
  label: string;
  /** YYYY-MM-DD。超過バケットのみ null */
  date: string | null;
  count: number;
  kind: "overdue" | "today" | "weekend" | "weekday";
}

const FORECAST_DAYS = 14;

/**
 * 未完了タスクを due_date で日別集計する。
 * @param tasks スコープ済みタスク（PJ選択/自分のみを尊重した呼び出し側の filteredTasks を渡す想定）
 * @param today YYYY-MM-DD（基準日）
 * @param days today を含む日別バケット数（既定14＝今日〜13日後）
 */
export function computeDueForecast(tasks: Task[], today: string, days: number = FORECAST_DAYS): DueForecastBucket[] {
  const incomplete = tasks.filter(t => !t.is_deleted && !suppressOverdue(t.status) && t.due_date != null);

  const overdueCount = incomplete.filter(t => (t.due_date as string) < today).length;
  const buckets: DueForecastBucket[] = [
    { label: "超過", date: null, count: overdueCount, kind: "overdue" },
  ];

  const baseDate = toDate(today) ?? new Date(today);
  for (let i = 0; i < days; i++) {
    const d = addDays(baseDate, i);
    const dateStr = toDateStr(d);
    const count = incomplete.filter(t => t.due_date === dateStr).length;
    const dow = d.getDay(); // 0=日, 6=土
    const kind: DueForecastBucket["kind"] = i === 0 ? "today" : (dow === 0 || dow === 6) ? "weekend" : "weekday";
    buckets.push({ label: formatMD(dateStr), date: dateStr, count, kind });
  }

  return buckets;
}
