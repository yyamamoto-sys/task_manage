import { describe, it, expect } from "vitest";
import { summarizeLinkedTaskStatus } from "../aheadTaskStats";
import type { Task, TaskDependency } from "../../localData/types";

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    name: "task",
    project_id: null,
    todo_ids: [],
    assignee_member_id: "",
    assignee_member_ids: [],
    status: "todo",
    priority: null,
    start_date: null,
    due_date: null,
    estimated_hours: null,
    comment: "",
    is_deleted: false,
    ...overrides,
  };
}

function makeDep(overrides: Partial<TaskDependency> & { predecessor_task_id: string; successor_task_id: string }): TaskDependency {
  return {
    id: `${overrides.predecessor_task_id}->${overrides.successor_task_id}`,
    is_deleted: false,
    ...overrides,
  };
}

const TEN_DAYS_AGO = new Date(Date.now() - 10 * 86400000).toISOString();

describe("summarizeLinkedTaskStatus", () => {
  it("紐づくタスクが無ければ全て0", () => {
    expect(summarizeLinkedTaskStatus([], [], [])).toEqual({ delayedCount: 0, stagnantCount: 0, blockedCount: 0 });
  });

  it("ベースラインより遅延しているタスクをdelayedCountに数える（computeDelayDaysをそのまま使う）", () => {
    const t = makeTask({ id: "t1", baseline_due_date: "2026-07-10", due_date: "2026-07-15" });
    const result = summarizeLinkedTaskStatus([t], [t], []);
    expect(result.delayedCount).toBe(1);
  });

  it("前倒し（負の遅延）はdelayedCountに数えない", () => {
    const t = makeTask({ id: "t1", baseline_due_date: "2026-07-10", due_date: "2026-07-05" });
    const result = summarizeLinkedTaskStatus([t], [t], []);
    expect(result.delayedCount).toBe(0);
  });

  it("ベースライン未凍結（computeDelayDaysがnull）はdelayedCountに数えない", () => {
    const t = makeTask({ id: "t1", due_date: "2026-07-15" });
    const result = summarizeLinkedTaskStatus([t], [t], []);
    expect(result.delayedCount).toBe(0);
  });

  it("in_progressのまま5日以上updated_atが動いていないタスクをstagnantCountに数える（isTaskStagnantをそのまま使う）", () => {
    const t = makeTask({ id: "t1", status: "in_progress", updated_at: TEN_DAYS_AGO });
    const result = summarizeLinkedTaskStatus([t], [t], []);
    expect(result.stagnantCount).toBe(1);
  });

  it("todoステータスは何日更新が無くてもstagnantCountに数えない（isTaskStagnantの既存条件どおり）", () => {
    const t = makeTask({ id: "t1", status: "todo", updated_at: TEN_DAYS_AGO });
    const result = summarizeLinkedTaskStatus([t], [t], []);
    expect(result.stagnantCount).toBe(0);
  });

  it("未完了の先行タスクがあるタスクをblockedCountに数える（getIncompletePredecessorsをそのまま使う）", () => {
    const pred = makeTask({ id: "pred", status: "in_progress" });
    const succ = makeTask({ id: "succ" });
    const dep = makeDep({ predecessor_task_id: "pred", successor_task_id: "succ" });
    const result = summarizeLinkedTaskStatus([succ], [pred, succ], [dep]);
    expect(result.blockedCount).toBe(1);
  });

  it("先行タスクが完了済みならblockedCountに数えない", () => {
    const pred = makeTask({ id: "pred", status: "done" });
    const succ = makeTask({ id: "succ" });
    const dep = makeDep({ predecessor_task_id: "pred", successor_task_id: "succ" });
    const result = summarizeLinkedTaskStatus([succ], [pred, succ], [dep]);
    expect(result.blockedCount).toBe(0);
  });

  it("複数のタスクを正しく合算する（同じタスクが遅延かつ先行待ちの両方に該当してもよい）", () => {
    const pred = makeTask({ id: "pred", status: "in_progress" });
    const succ = makeTask({
      id: "succ", baseline_due_date: "2026-07-10", due_date: "2026-07-20", status: "in_progress", updated_at: TEN_DAYS_AGO,
    });
    const other = makeTask({ id: "other" });
    const dep = makeDep({ predecessor_task_id: "pred", successor_task_id: "succ" });
    const result = summarizeLinkedTaskStatus([succ, other], [pred, succ, other], [dep]);
    expect(result.delayedCount).toBe(1);
    expect(result.stagnantCount).toBe(1);
    expect(result.blockedCount).toBe(1);
  });
});
