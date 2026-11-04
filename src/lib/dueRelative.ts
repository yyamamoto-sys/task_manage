// src/lib/dueRelative.ts
// 一覧の期日列の相対表示（v3.199）。日付計算は lib/date.ts（ローカル日付基準）を再利用する。
import { diffDays, formatMDWithWeekday, toDate } from "./date";
import type { Task } from "./localData/types";

export type DueTone = "overdue" | "today" | "soon" | "normal" | "muted";

export interface DueRelative {
  label: string;
  tone: DueTone;
}

/** 完了・中止は相対表示せず MM/DD を灰色にする。保留は相対表示するが赤・強調にはしない。 */
export function formatDueRelative(due: string, status: Task["status"], today: string): DueRelative {
  const md = due.slice(5).replace("-", "/");
  if (status === "done" || status === "cancelled") return { label: md, tone: "muted" };
  const n = diffDays(today, due);
  const paused = status === "on_hold";
  if (n < 0) return { label: `${-n}日超過`, tone: paused ? "normal" : "overdue" };
  if (n === 0) return { label: "今日", tone: paused ? "normal" : "today" };
  if (n === 1) return { label: "明日", tone: "normal" };
  if (n <= 6) return { label: `あと${n}日`, tone: "normal" };
  return { label: md, tone: "normal" };
}

/** ツールチップ用の実日付 YYYY/MM/DD(曜) */
export function formatFullDateWithWeekday(due: string): string {
  const d = toDate(due);
  if (!d) return due;
  const w = formatMDWithWeekday(d).match(/\((.)\)$/)?.[1] ?? "";
  return `${due.slice(0, 4)}/${due.slice(5, 7)}/${due.slice(8, 10)}(${w})`;
}
