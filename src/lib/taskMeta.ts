// src/lib/taskMeta.ts
// タスクのステータス・優先度に関する定数と、タスク派生情報のヘルパー。
import type { Task, TaskForce, KeyResult } from "./localData/types";

/**
 * タスクの担当者ID配列を正規化して返す。
 * 旧設計の単数 assignee_member_id と新設計の assignee_member_ids 配列の両対応。
 */
export function getAssigneeIds(t: Pick<Task, "assignee_member_id" | "assignee_member_ids">): string[] {
  if (t.assignee_member_ids?.length) return t.assignee_member_ids;
  if (t.assignee_member_id) return [t.assignee_member_id];
  return [];
}

/** タスクの担当者に指定メンバーが含まれるか */
export function isAssignedTo(
  t: Pick<Task, "assignee_member_id" | "assignee_member_ids">,
  memberId: string,
): boolean {
  return getAssigneeIds(t).includes(memberId);
}

/**
 * TF.id → "TF{KR index+1}-{tf_number}" 形式のラベルマップ。
 * 例：KR1 配下の TF番号 1 → "TF1-1"
 */
export function buildTfLabelMap(taskForces: TaskForce[], keyResults: KeyResult[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const tf of taskForces) {
    const krIdx = keyResults.findIndex(k => k.id === tf.kr_id);
    const krLabel = krIdx >= 0 ? `${krIdx + 1}` : "?";
    map.set(tf.id, `TF${krLabel}-${tf.tf_number || "?"}`);
  }
  return map;
}

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

/** カンバンカード左端の優先度ストライプ色（カード全体の視認性重視で既存の text-* トークンを流用）。
 *  優先度未設定は border-primary（無彩色）にフォールバックする。 */
export const TASK_PRIORITY_STRIPE_COLOR: Record<string, string> = {
  high: "var(--color-text-danger)",
  mid:  "var(--color-text-warning)",
  low:  "var(--color-text-info)",
};
