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
 * 「アクティブ（作業中）」ステータスかどうか。todo・in_progress のみ true。
 * done（完了）・cancelled（中止）・on_hold（保留）は false。
 * ワークロード集計・過負荷計算・クリティカルパスのノード除外・期限アラートの対象判定で
 * 共有する「アクティブ」の単一の定義（CLAUDE.md 2026-07-21 ステータス拡張）。
 */
export function isActiveTaskStatus(status: Task["status"]): boolean {
  return status === "todo" || status === "in_progress";
}

/** 中止・保留（＝実質的に動いていない仕事）かどうか。done は含まない（done判定は別途行うこと）。 */
export function isPausedOrCancelledStatus(status: Task["status"]): boolean {
  return status === "cancelled" || status === "on_hold";
}

/**
 * 期限超過の赤字強調を抑制すべきステータスか（完了・中止・保留）。
 * 中止・保留になったタスクを「期限超過」として騒がせないための共通判定。
 */
export function suppressOverdue(status: Task["status"]): boolean {
  return status === "done" || isPausedOrCancelledStatus(status);
}

/**
 * 進捗%集計（分子側）で「完了扱い」とみなすステータスか。
 * done はもちろん、cancelled（実施しないと決めて終わった）も「もう動かない」= 完了扱いに含める。
 * on_hold は「まだ動く可能性がある」ため引き続き未完了扱い（分子に含めない）。
 * これは taskHierarchy.ts の allChildrenTerminal（親タスク自動完了・v2.75）と同じ判定基準を、
 * 進捗%集計（分母にon_hold/cancelledを含めたまま分子だけstatus==="done"限定にしていた非対称＝
 * M33）を解消するために切り出したもの（CLAUDE.md 2026-07-22）。
 * GanttView（PJ別/ToDo別グループ進捗%）・DashboardView（pjProgress/krProgress/tfTaskStats/
 * todoProgress）・groupSummary.computeGroupSummary（ListView/Kanbanのグループ見出し集計）の
 * 4箇所で共有する。
 */
export function isCompletedForProgress(status: Task["status"]): boolean {
  return status === "done" || status === "cancelled";
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
  on_hold:     "保留",
  cancelled:   "中止",
};

export const TASK_STATUS_STYLE: Record<Task["status"], { bg: string; color: string; border: string }> = {
  todo:        { bg: "var(--color-bg-tertiary)",   color: "var(--color-text-secondary)", border: "var(--color-border-primary)" },
  in_progress: { bg: "var(--color-bg-info)",       color: "var(--color-text-info)",      border: "var(--color-border-info)" },
  done:        { bg: "var(--color-bg-success)",    color: "var(--color-text-success)",   border: "var(--color-border-success)" },
  // 保留＝オレンジ（警告系。doneの緑・in_progressの青と混同しない）
  on_hold:     { bg: "var(--color-bg-warning)",    color: "var(--color-text-warning)",   border: "var(--color-border-warning)" },
  // 中止＝グレー（無彩色。todoのグレーより一段沈んだtertiaryトークンで見分ける・UI側で取り消し線も併用）
  cancelled:   { bg: "var(--color-bg-secondary)",  color: "var(--color-text-tertiary)",  border: "var(--color-border-secondary)" },
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
