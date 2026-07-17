// src/components/gantt/ganttUtils.ts
// ガントビュー共通の定数・型・純粋関数

import type { Task } from "../../lib/localData/types";
import { toDate, diffDays } from "../../lib/date";

export const DAY_WIDTH_DEFAULT = 28;
export const ZOOM_LEVELS = [14, 20, 28, 36, 48] as const;
export const STAGNANT_THRESHOLD_DAYS = 5;
export const TODO_COLOR = "#6ee7b7";
export const MS_COLOR   = "#f59e0b";
export const MS_BORDER  = "#d97706";

export type GanttSortOrder = "date" | "name";

export function isTaskStagnant(task: Task, now = Date.now()): boolean {
  if (task.status !== "in_progress" || !task.updated_at) return false;
  const diffMs = now - new Date(task.updated_at).getTime();
  return diffMs / (1000 * 60 * 60 * 24) >= STAGNANT_THRESHOLD_DAYS;
}

export function calcTaskBar(task: Task, rangeStart: Date, dayWidth: number): { barX: number; barWidth: number } | null {
  const due = toDate(task.due_date);
  if (!due) return null;
  const start = toDate(task.start_date ?? null);
  if (start && start <= due) {
    const barX = diffDays(rangeStart, start) * dayWidth;
    const barWidth = Math.max((diffDays(start, due) + 1) * dayWidth - 4, dayWidth - 4);
    return { barX, barWidth };
  }
  return { barX: diffDays(rangeStart, due) * dayWidth, barWidth: dayWidth - 4 };
}

// ===== B4：ベースライン（当初計画）差分 =====

/**
 * タスクのベースライン（baseline_start_date/baseline_due_date）の位置を計算する。
 * calcTaskBar を「ベースライン日付を差し込んだ仮タスク」で呼ぶだけ（座標計算ロジックの二重化を避ける）。
 * ベースライン未凍結（片方または両方 null）なら null。
 */
export function calcGhostBar(task: Task, rangeStart: Date, dayWidth: number): { barX: number; barWidth: number } | null {
  if (!task.baseline_start_date || !task.baseline_due_date) return null;
  return calcTaskBar({ ...task, start_date: task.baseline_start_date, due_date: task.baseline_due_date }, rangeStart, dayWidth);
}

/**
 * 現在の期日 − 当初計画（baseline）の期日（暦日）。正=遅延、負=前倒し。
 * ベースライン未凍結、または現在の期日が未設定なら null。
 */
export function computeDelayDays(task: Task): number | null {
  if (!task.baseline_due_date || !task.due_date) return null;
  return diffDays(task.baseline_due_date, task.due_date);
}

/** 遅延日数 → 表示ラベル。0（差分なし）は非表示（null）。 */
export function formatDelayLabel(delayDays: number | null): string | null {
  if (delayDays === null || delayDays === 0) return null;
  return delayDays > 0 ? `遅延${delayDays}日` : `${Math.abs(delayDays)}日前倒し`;
}
