import { describe, it, expect } from "vitest";
import { sortByDueDateStable } from "../kanbanOrder";

describe("sortByDueDateStable", () => {
  it("期日の昇順・期日なしは末尾・同日は元の順", () => {
    const tasks = [
      { id: "a", due_date: null },
      { id: "b", due_date: "2026-11-10" },
      { id: "c", due_date: "2026-11-05" },
      { id: "d", due_date: "2026-11-10" },
      { id: "e", due_date: null },
    ];
    expect(sortByDueDateStable(tasks).map(t => t.id)).toEqual(["c", "b", "d", "a", "e"]);
  });
  it("元の配列を変えない", () => {
    const tasks = [{ id: "a", due_date: "2026-11-10" }, { id: "b", due_date: "2026-11-01" }];
    sortByDueDateStable(tasks);
    expect(tasks.map(t => t.id)).toEqual(["a", "b"]);
  });
});
