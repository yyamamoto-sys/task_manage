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
