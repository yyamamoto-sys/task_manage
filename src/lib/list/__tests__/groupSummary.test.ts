import { describe, it, expect } from "vitest";
import { computeGroupSummary } from "../groupSummary";
import type { Task } from "../../localData/types";

function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    name: "タスク1",
    project_id: "pj-1",
    todo_ids: [],
    assignee_member_id: "m1",
    assignee_member_ids: ["m1"],
    status: "todo",
    priority: null,
    start_date: null,
    due_date: null,
    estimated_hours: null,
    comment: "",
    is_deleted: false,
    ...over,
  };
}

describe("computeGroupSummary", () => {
  it("空配列なら total=0・completionRate=0・totalHours=null", () => {
    const s = computeGroupSummary([]);
    expect(s).toEqual({ total: 0, doneCount: 0, completionRate: 0, totalHours: null });
  });

  it("完了率を doneCount/total で算出する", () => {
    const tasks = [
      makeTask({ id: "1", status: "done" }),
      makeTask({ id: "2", status: "done" }),
      makeTask({ id: "3", status: "todo" }),
      makeTask({ id: "4", status: "in_progress" }),
    ];
    const s = computeGroupSummary(tasks);
    expect(s.total).toBe(4);
    expect(s.doneCount).toBe(2);
    expect(s.completionRate).toBe(0.5);
  });

  it("cancelledはdoneと同じ完了扱いでdoneCountに含める（M33解消・2026-07-22）", () => {
    const tasks = [
      makeTask({ id: "1", status: "done" }),
      makeTask({ id: "2", status: "cancelled" }),
      makeTask({ id: "3", status: "todo" }),
      makeTask({ id: "4", status: "on_hold" }),
    ];
    const s = computeGroupSummary(tasks);
    expect(s.total).toBe(4);
    expect(s.doneCount).toBe(2);
    expect(s.completionRate).toBe(0.5);
  });

  it("on_holdは引き続き未完了扱い（doneCountに含めない）", () => {
    const tasks = [
      makeTask({ id: "1", status: "on_hold" }),
      makeTask({ id: "2", status: "on_hold" }),
    ];
    const s = computeGroupSummary(tasks);
    expect(s.doneCount).toBe(0);
    expect(s.completionRate).toBe(0);
  });

  it("工数入力済みタスクのみ合算し、未入力は0扱いしない", () => {
    const tasks = [
      makeTask({ id: "1", estimated_hours: 3 }),
      makeTask({ id: "2", estimated_hours: 5.5 }),
      makeTask({ id: "3", estimated_hours: null }),
    ];
    const s = computeGroupSummary(tasks);
    expect(s.totalHours).toBe(8.5);
  });

  it("全タスクが工数未入力なら totalHours は null", () => {
    const tasks = [makeTask({ id: "1" }), makeTask({ id: "2" })];
    const s = computeGroupSummary(tasks);
    expect(s.totalHours).toBeNull();
  });
});
