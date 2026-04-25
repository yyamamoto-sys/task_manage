// src/lib/taskMeta.ts
// タスクのステータス・優先度に関する定数。全Viewで共有する。
import type { Task } from "./localData/types";

export const TASK_STATUS_LABEL: Record<Task["status"], string> = {
  todo:        "ToDo",
  in_progress: "進行中",
  done:        "完了",
};

export const TASK_STATUS_STYLE: Record<Task["status"], { bg: string; color: string; border: string }> = {
  todo:        { bg: "var(--color-bg-tertiary)",  color: "var(--color-text-secondary)", border: "var(--color-border-primary)" },
  in_progress: { bg: "var(--color-bg-info)",      color: "var(--color-text-info)",      border: "var(--color-border-info)" },
  done:        { bg: "var(--color-bg-success)",   color: "var(--color-text-success)",   border: "var(--color-border-success)" },
};

export const TASK_PRIORITY_LABEL: Record<string, string> = {
  high: "高",
  mid:  "中",
  low:  "低",
};

export const TASK_PRIORITY_STYLE: Record<string, { bg: string; color: string }> = {
  high: { bg: "var(--color-bg-danger)",  color: "var(--color-text-danger)"  },
  mid:  { bg: "var(--color-bg-warning)", color: "var(--color-text-warning)" },
  low:  { bg: "var(--color-bg-success)", color: "var(--color-text-success)" },
};
