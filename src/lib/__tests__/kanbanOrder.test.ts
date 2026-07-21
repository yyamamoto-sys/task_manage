import { describe, it, expect } from "vitest";
import { computeKanbanOrderedIds } from "../kanbanOrder";

describe("computeKanbanOrderedIds", () => {
  const tasks = [
    { id: "t1", status: "todo" as const },
    { id: "t2", status: "in_progress" as const },
    { id: "t3", status: "todo" as const },
    { id: "t4", status: "done" as const },
    { id: "t5", status: "in_progress" as const },
  ];

  it("列を todo→in_progress→done の順、各列内は配列順でフラット化する", () => {
    expect(computeKanbanOrderedIds(tasks, false)).toEqual(["t1", "t3", "t2", "t5", "t4"]);
  });

  it("hideDone=true のときは done列を対象から除外する", () => {
    expect(computeKanbanOrderedIds(tasks, true)).toEqual(["t1", "t3", "t2", "t5"]);
  });

  it("空配列を渡すと空配列を返す", () => {
    expect(computeKanbanOrderedIds([], false)).toEqual([]);
  });

  it("全て同じ列でも配列順を保つ", () => {
    const same = [
      { id: "a", status: "done" as const },
      { id: "b", status: "done" as const },
    ];
    expect(computeKanbanOrderedIds(same, false)).toEqual(["a", "b"]);
  });

  it("showPaused=false（既定）では on_hold/cancelled を対象から除外する", () => {
    const withPaused = [
      ...tasks,
      { id: "t6", status: "on_hold" as const },
      { id: "t7", status: "cancelled" as const },
    ];
    expect(computeKanbanOrderedIds(withPaused, false)).toEqual(["t1", "t3", "t2", "t5", "t4"]);
  });

  it("showPaused=true では todo→in_progress→done→on_hold→cancelled の順で対象に含める", () => {
    const withPaused = [
      ...tasks,
      { id: "t6", status: "on_hold" as const },
      { id: "t7", status: "cancelled" as const },
    ];
    expect(computeKanbanOrderedIds(withPaused, false, true)).toEqual(["t1", "t3", "t2", "t5", "t4", "t6", "t7"]);
  });
});
