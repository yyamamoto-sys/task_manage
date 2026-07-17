import { describe, it, expect } from "vitest";
import { calcGhostBar, computeDelayDays, formatDelayLabel } from "../ganttUtils";
import type { Task } from "../../../lib/localData/types";

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

const rangeStart = new Date(2026, 6, 1); // 2026-07-01
const dayWidth = 28;

describe("calcGhostBar", () => {
  it("ベースラインが両方揃っていれば座標を返す", () => {
    const task = makeTask({ id: "t1", baseline_start_date: "2026-07-05", baseline_due_date: "2026-07-10" });
    const bar = calcGhostBar(task, rangeStart, dayWidth);
    expect(bar).not.toBeNull();
    expect(bar!.barX).toBe(4 * dayWidth);
  });

  it("ベースライン未凍結（両方null）ならnull", () => {
    const task = makeTask({ id: "t1" });
    expect(calcGhostBar(task, rangeStart, dayWidth)).toBeNull();
  });

  it("ベースラインが片方だけならnull", () => {
    const task = makeTask({ id: "t1", baseline_start_date: "2026-07-05", baseline_due_date: null });
    expect(calcGhostBar(task, rangeStart, dayWidth)).toBeNull();
  });
});

describe("computeDelayDays", () => {
  it("期日が後ろ倒しになったら正の値（遅延）", () => {
    const task = makeTask({ id: "t1", baseline_due_date: "2026-07-10", due_date: "2026-07-15" });
    expect(computeDelayDays(task)).toBe(5);
  });

  it("期日が前倒しになったら負の値", () => {
    const task = makeTask({ id: "t1", baseline_due_date: "2026-07-10", due_date: "2026-07-08" });
    expect(computeDelayDays(task)).toBe(-2);
  });

  it("差分ゼロなら0", () => {
    const task = makeTask({ id: "t1", baseline_due_date: "2026-07-10", due_date: "2026-07-10" });
    expect(computeDelayDays(task)).toBe(0);
  });

  it("ベースライン未凍結ならnull", () => {
    const task = makeTask({ id: "t1", due_date: "2026-07-10" });
    expect(computeDelayDays(task)).toBeNull();
  });

  it("現在の期日が未設定ならnull", () => {
    const task = makeTask({ id: "t1", baseline_due_date: "2026-07-10", due_date: null });
    expect(computeDelayDays(task)).toBeNull();
  });
});

describe("formatDelayLabel", () => {
  it("正の値は「遅延◯日」", () => {
    expect(formatDelayLabel(5)).toBe("遅延5日");
  });

  it("負の値は「◯日前倒し」", () => {
    expect(formatDelayLabel(-3)).toBe("3日前倒し");
  });

  it("0はnull（非表示）", () => {
    expect(formatDelayLabel(0)).toBeNull();
  });

  it("nullはnull", () => {
    expect(formatDelayLabel(null)).toBeNull();
  });
});
