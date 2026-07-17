import { describe, it, expect } from "vitest";
import { getIncompletePredecessors, formatBlockerNames } from "../gate";
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

describe("getIncompletePredecessors", () => {
  it("先行タスクが無ければ空配列", () => {
    const tasks = [makeTask({ id: "t1" })];
    expect(getIncompletePredecessors("t1", tasks, [])).toEqual([]);
  });

  it("未完了の先行タスクを返す", () => {
    const pred = makeTask({ id: "pred", name: "先行", status: "in_progress" });
    const succ = makeTask({ id: "succ", name: "後続" });
    const dep = makeDep({ predecessor_task_id: "pred", successor_task_id: "succ" });
    const result = getIncompletePredecessors("succ", [pred, succ], [dep]);
    expect(result.map(t => t.id)).toEqual(["pred"]);
  });

  it("先行タスクが done なら除外する", () => {
    const pred = makeTask({ id: "pred", status: "done" });
    const succ = makeTask({ id: "succ" });
    const dep = makeDep({ predecessor_task_id: "pred", successor_task_id: "succ" });
    expect(getIncompletePredecessors("succ", [pred, succ], [dep])).toEqual([]);
  });

  it("依存自体が論理削除されていれば無視する", () => {
    const pred = makeTask({ id: "pred", status: "todo" });
    const succ = makeTask({ id: "succ" });
    const dep = makeDep({ predecessor_task_id: "pred", successor_task_id: "succ", is_deleted: true });
    expect(getIncompletePredecessors("succ", [pred, succ], [dep])).toEqual([]);
  });

  it("先行タスク自体が論理削除されていれば無視する", () => {
    const pred = makeTask({ id: "pred", status: "todo", is_deleted: true });
    const succ = makeTask({ id: "succ" });
    const dep = makeDep({ predecessor_task_id: "pred", successor_task_id: "succ" });
    expect(getIncompletePredecessors("succ", [pred, succ], [dep])).toEqual([]);
  });

  it("複数の先行タスクのうち未完了のものだけ返す", () => {
    const pred1 = makeTask({ id: "p1", status: "todo" });
    const pred2 = makeTask({ id: "p2", status: "done" });
    const succ  = makeTask({ id: "succ" });
    const deps = [
      makeDep({ predecessor_task_id: "p1", successor_task_id: "succ" }),
      makeDep({ predecessor_task_id: "p2", successor_task_id: "succ" }),
    ];
    const result = getIncompletePredecessors("succ", [pred1, pred2, succ], deps);
    expect(result.map(t => t.id)).toEqual(["p1"]);
  });
});

describe("formatBlockerNames", () => {
  it("タスク名を「」で連結する", () => {
    const blockers = [makeTask({ id: "a", name: "設計" }), makeTask({ id: "b", name: "レビュー" })];
    expect(formatBlockerNames(blockers)).toBe("「設計」、「レビュー」");
  });

  it("空配列なら空文字", () => {
    expect(formatBlockerNames([])).toBe("");
  });
});
