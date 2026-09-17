import { describe, it, expect } from "vitest";
import type { Task } from "../../localData/types";
import { addTaskWithChildren, removeTaskWithChildren, toggleTaskWithChildren } from "../selectionWithChildren";

function makeTask(over: Partial<Task>): Task {
  return {
    id: "t-1", name: "タスク", project_id: "pj-1", todo_ids: [],
    assignee_member_id: "m-1", assignee_member_ids: ["m-1"], status: "todo", priority: null,
    start_date: null, due_date: null, estimated_hours: null, comment: "", is_deleted: false,
    ...over,
  };
}

describe("addTaskWithChildren", () => {
  it("子を持たない単独タスクは自分だけ選択に加わる", () => {
    const parent = makeTask({ id: "p1" });
    const result = addTaskWithChildren(new Set(), "p1", [parent]);
    expect(result).toEqual(new Set(["p1"]));
  });

  it("子を持つ親タスクを選択すると、直下の子も一緒に選択に加わる", () => {
    const parent = makeTask({ id: "p1" });
    const child1 = makeTask({ id: "c1", parent_task_id: "p1" });
    const child2 = makeTask({ id: "c2", parent_task_id: "p1" });
    const result = addTaskWithChildren(new Set(), "p1", [parent, child1, child2]);
    expect(result).toEqual(new Set(["p1", "c1", "c2"]));
  });

  it("既に選択済みのSetに追加しても既存の選択は保たれる", () => {
    const parent = makeTask({ id: "p1" });
    const child1 = makeTask({ id: "c1", parent_task_id: "p1" });
    const other = makeTask({ id: "other" });
    const result = addTaskWithChildren(new Set(["other"]), "p1", [parent, child1, other]);
    expect(result).toEqual(new Set(["other", "p1", "c1"]));
  });

  it("既に子だけ選択済みの状態で親を選択すると、親が加わり子の選択は保たれる", () => {
    const parent = makeTask({ id: "p1" });
    const child1 = makeTask({ id: "c1", parent_task_id: "p1" });
    const child2 = makeTask({ id: "c2", parent_task_id: "p1" });
    const result = addTaskWithChildren(new Set(["c1"]), "p1", [parent, child1, child2]);
    expect(result).toEqual(new Set(["c1", "p1", "c2"]));
  });

  it("論理削除済みの子は選択に加えない", () => {
    const parent = makeTask({ id: "p1" });
    const child = makeTask({ id: "c1", parent_task_id: "p1", is_deleted: true });
    const result = addTaskWithChildren(new Set(), "p1", [parent, child]);
    expect(result).toEqual(new Set(["p1"]));
  });

  it("元のSetは変更しない（新しいSetを返す）", () => {
    const original = new Set(["x"]);
    const parent = makeTask({ id: "p1" });
    addTaskWithChildren(original, "p1", [parent]);
    expect(original).toEqual(new Set(["x"]));
  });
});

describe("removeTaskWithChildren", () => {
  it("子を持たない単独タスクは自分だけ選択から外れる", () => {
    const parent = makeTask({ id: "p1" });
    const result = removeTaskWithChildren(new Set(["p1", "other"]), "p1", [parent]);
    expect(result).toEqual(new Set(["other"]));
  });

  it("子を持つ親を解除すると、直下の子も一緒に選択から外れる", () => {
    const parent = makeTask({ id: "p1" });
    const child1 = makeTask({ id: "c1", parent_task_id: "p1" });
    const child2 = makeTask({ id: "c2", parent_task_id: "p1" });
    const result = removeTaskWithChildren(new Set(["p1", "c1", "c2", "other"]), "p1", [parent, child1, child2]);
    expect(result).toEqual(new Set(["other"]));
  });

  it("子が一部しか選択されていなくても、親解除でその子も外れる", () => {
    const parent = makeTask({ id: "p1" });
    const child1 = makeTask({ id: "c1", parent_task_id: "p1" });
    const child2 = makeTask({ id: "c2", parent_task_id: "p1" });
    // c2は元々選択されていない（片方だけ選択されていた状態）
    const result = removeTaskWithChildren(new Set(["p1", "c1"]), "p1", [parent, child1, child2]);
    expect(result).toEqual(new Set());
  });

  it("元のSetは変更しない（新しいSetを返す）", () => {
    const original = new Set(["p1"]);
    const parent = makeTask({ id: "p1" });
    removeTaskWithChildren(original, "p1", [parent]);
    expect(original).toEqual(new Set(["p1"]));
  });
});

describe("toggleTaskWithChildren（親をクリック→子も付け外し、子は個別に自由）", () => {
  it("未選択の親をトグル→選択（子も加わる）", () => {
    const parent = makeTask({ id: "p1" });
    const child = makeTask({ id: "c1", parent_task_id: "p1" });
    const result = toggleTaskWithChildren(new Set(), "p1", [parent, child]);
    expect(result).toEqual(new Set(["p1", "c1"]));
  });

  it("選択済みの親をトグル→解除（子も外れる）", () => {
    const parent = makeTask({ id: "p1" });
    const child = makeTask({ id: "c1", parent_task_id: "p1" });
    const result = toggleTaskWithChildren(new Set(["p1", "c1"]), "p1", [parent, child]);
    expect(result).toEqual(new Set());
  });

  it("子タスクを個別にトグルしても、親の選択状態には影響しない（自由に付け外しできる）", () => {
    const parent = makeTask({ id: "p1" });
    const child1 = makeTask({ id: "c1", parent_task_id: "p1" });
    const child2 = makeTask({ id: "c2", parent_task_id: "p1" });
    // 親と子1が選択済みの状態で、子2だけを追加選択
    const afterAdd = toggleTaskWithChildren(new Set(["p1", "c1"]), "c2", [parent, child1, child2]);
    expect(afterAdd).toEqual(new Set(["p1", "c1", "c2"]));
    // 続けて子1だけを解除（親はそのまま残る）
    const afterRemove = toggleTaskWithChildren(afterAdd, "c1", [parent, child1, child2]);
    expect(afterRemove).toEqual(new Set(["p1", "c2"]));
  });
});
