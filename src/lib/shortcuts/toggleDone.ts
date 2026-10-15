// src/lib/shortcuts/toggleDone.ts
//
// 「E」キー：注目中のタスクの完了／未完了の切り替え（v3.162）。
// 保存は既存の saveTask（楽観更新・realtime・変更履歴・楽観ロックの経路）をそのまま通し、
// 一括変更（useBulkTaskActions）と同じ形の Undo トースト（isUndo:true）を出す＝Ctrl+Z で戻せる。

import type { Task } from "../localData/types";
import { TASK_STATUS_LABEL } from "../taskMeta";

export type DoneTogglePlan =
  | { kind: "set"; from: Task["status"]; to: Task["status"] }
  | { kind: "parent" }
  | { kind: "skip" };

/**
 * 子タスクを持つ親の状態は子の完了状況で決まる（rollup）ため、親は直接切り替えない。
 * 中止（cancelled）は「完了か未完了か」の二択に入らないので何もしない。
 */
export function planDoneToggle(task: Task | undefined, hasChildren: boolean): DoneTogglePlan {
  if (!task || task.is_deleted) return { kind: "skip" };
  if (hasChildren) return { kind: "parent" };
  if (task.status === "cancelled") return { kind: "skip" };
  if (task.status === "done") return { kind: "set", from: "done", to: "todo" };
  return { kind: "set", from: task.status, to: "done" };
}

export interface ToggleDoneDeps {
  getTasks: () => Task[];
  saveTask: (task: Task) => Promise<unknown> | unknown;
  showToast: (
    message: string,
    type?: "success" | "error" | "info",
    action?: { label: string; onClick: () => void; isUndo?: boolean },
  ) => void;
  userId: string;
}

export async function toggleTaskDone(taskId: string, deps: ToggleDoneDeps): Promise<void> {
  const tasks = deps.getTasks();
  const task = tasks.find(t => t.id === taskId);
  const hasChildren = tasks.some(t => t.parent_task_id === taskId && !t.is_deleted);
  const plan = planDoneToggle(task, hasChildren);
  if (plan.kind === "skip" || !task) return;
  if (plan.kind === "parent") {
    deps.showToast("親タスクの状態は、子タスクの完了状況で決まります。子タスクを切り替えてください", "info");
    return;
  }
  try {
    await deps.saveTask({ ...task, status: plan.to, updated_by: deps.userId });
  } catch {
    deps.showToast("ステータスの変更に失敗しました", "error");
    return;
  }
  deps.showToast(`「${task.name}」を「${TASK_STATUS_LABEL[plan.to]}」にしました`, "success", {
    label: "元に戻す",
    isUndo: true,
    onClick: () => {
      // Undo時点の最新タスクに旧ステータスだけ適用する（古いスナップショット全体を保存すると楽観ロックと衝突）
      const latest = deps.getTasks().find(t => t.id === taskId);
      if (latest) void deps.saveTask({ ...latest, status: plan.from, updated_by: deps.userId });
    },
  });
}
