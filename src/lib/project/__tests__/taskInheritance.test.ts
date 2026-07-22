import { describe, it, expect } from "vitest";
import type { Task, TaskDependency } from "../../localData/types";
import { defaultCheckedTaskIds, buildInheritedTasks, buildInheritedDependencies } from "../taskInheritance";

// テスト用の最小 Task ファクトリ（src/lib/__tests__/taskHierarchy.test.ts の mk と同型）
function mk(partial: Partial<Task> & { id: string }): Task {
  return {
    id: partial.id,
    name: partial.name ?? partial.id,
    project_id: partial.project_id ?? "origin-pj",
    todo_ids: partial.todo_ids ?? [],
    assignee_member_id: partial.assignee_member_id ?? "",
    assignee_member_ids: partial.assignee_member_ids ?? [],
    status: partial.status ?? "todo",
    priority: partial.priority ?? null,
    start_date: partial.start_date ?? null,
    due_date: partial.due_date ?? null,
    estimated_hours: partial.estimated_hours ?? null,
    comment: partial.comment ?? "",
    is_deleted: partial.is_deleted ?? false,
    created_at: partial.created_at,
    updated_at: partial.updated_at,
    completed_at: partial.completed_at ?? null,
    parent_task_id: partial.parent_task_id,
    display_order: partial.display_order,
    tags: partial.tags,
  };
}

function mkDep(partial: Partial<TaskDependency> & { id: string; predecessor_task_id: string; successor_task_id: string }): TaskDependency {
  return {
    id: partial.id,
    predecessor_task_id: partial.predecessor_task_id,
    successor_task_id: partial.successor_task_id,
    is_deleted: partial.is_deleted ?? false,
  };
}

/** テスト用の決定的なID採番（new-1, new-2, ...） */
function makeIdGenerator(): () => string {
  let n = 0;
  return () => `new-${++n}`;
}

describe("defaultCheckedTaskIds", () => {
  it("done・cancelled は既定でチェックOFF、それ以外はON", () => {
    const tasks = [
      mk({ id: "a", status: "todo" }),
      mk({ id: "b", status: "in_progress" }),
      mk({ id: "c", status: "done" }),
      mk({ id: "d", status: "cancelled" }),
      mk({ id: "e", status: "on_hold" }),
    ];
    const result = defaultCheckedTaskIds(tasks);
    expect(result.has("a")).toBe(true);
    expect(result.has("b")).toBe(true);
    expect(result.has("c")).toBe(false);
    expect(result.has("d")).toBe(false);
    expect(result.has("e")).toBe(true);
  });
});

describe("buildInheritedTasks", () => {
  const baseParams = {
    newProjectId: "new-pj",
    newProjectStartDate: "2026-03-01",
    originProjectStartDate: "2026-01-01" as string | null,
    createdBy: "member-1",
    now: "2026-03-01T00:00:00.000Z",
  };

  it("単一タスク（親なし）を新PJ用に複製し、日付をスライドし、ステータスをtodoにリセットする", () => {
    const originTasks = [mk({
      id: "t1", name: "要件整理", status: "done", priority: "high",
      start_date: "2026-01-04", due_date: "2026-01-08",
      assignee_member_id: "m1", assignee_member_ids: ["m1"],
      estimated_hours: 3, comment: "メモ", tags: ["設計"],
      completed_at: "2026-01-08T00:00:00.000Z",
    })];
    const { tasks, idMap } = buildInheritedTasks({
      ...baseParams,
      originTasks,
      checkedTaskIds: new Set(["t1"]),
      generateId: makeIdGenerator(),
    });
    expect(tasks).toHaveLength(1);
    const t = tasks[0];
    expect(t.id).toBe("new-1");
    expect(idMap.get("t1")).toBe("new-1");
    expect(t.project_id).toBe("new-pj");
    expect(t.status).toBe("todo");
    expect(t.start_date).toBe("2026-03-04");
    expect(t.due_date).toBe("2026-03-08");
    expect(t.priority).toBe("high");
    expect(t.assignee_member_id).toBe("m1");
    expect(t.assignee_member_ids).toEqual(["m1"]);
    expect(t.estimated_hours).toBe(3);
    expect(t.comment).toBe("メモ");
    expect(t.tags).toEqual(["設計"]);
    expect(t.parent_task_id).toBeNull();
    expect(t.todo_ids).toEqual([]);
    // 明示的にコピーしないフィールド
    expect(t.baseline_start_date).toBeUndefined();
    expect(t.baseline_due_date).toBeUndefined();
    expect(t.finalized_mentions).toBeUndefined();
    expect(t.completed_at).toBeUndefined();
  });

  it("チェックされていないタスクは複製結果に含まれない", () => {
    const originTasks = [mk({ id: "t1" }), mk({ id: "t2" })];
    const { tasks } = buildInheritedTasks({
      ...baseParams,
      originTasks,
      checkedTaskIds: new Set(["t1"]),
      generateId: makeIdGenerator(),
    });
    expect(tasks.map(t => t.name)).toEqual(["t1"]);
  });

  it("親・子ともにチェックされていれば、子のparent_task_idは親の新IDに張り替わる", () => {
    const originTasks = [
      mk({ id: "parent", name: "親" }),
      mk({ id: "child", name: "子", parent_task_id: "parent" }),
    ];
    const { tasks, idMap } = buildInheritedTasks({
      ...baseParams,
      originTasks,
      checkedTaskIds: new Set(["parent", "child"]),
      generateId: makeIdGenerator(),
    });
    const newParentId = idMap.get("parent");
    const child = tasks.find(t => t.name === "子");
    expect(child?.parent_task_id).toBe(newParentId);
  });

  it("親が未チェックの場合、子は親なしのトップレベルタスクとして引き継がれる", () => {
    const originTasks = [
      mk({ id: "parent", name: "親" }),
      mk({ id: "child", name: "子", parent_task_id: "parent" }),
    ];
    const { tasks } = buildInheritedTasks({
      ...baseParams,
      originTasks,
      checkedTaskIds: new Set(["child"]), // 親は未チェック
      generateId: makeIdGenerator(),
    });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].parent_task_id).toBeNull();
  });

  it("親が引き継ぎ元PJの範囲外（他PJの親）の場合も、子は親なしで引き継がれる", () => {
    // originTasks に親自体が含まれない＝他PJの親を持つケースと同じ経路で処理される
    const originTasks = [
      mk({ id: "child", name: "子", parent_task_id: "cross-project-parent" }),
    ];
    const { tasks } = buildInheritedTasks({
      ...baseParams,
      originTasks,
      checkedTaskIds: new Set(["child"]),
      generateId: makeIdGenerator(),
    });
    expect(tasks[0].parent_task_id).toBeNull();
  });

  it("日付の無いタスクは日付無しのまま引き継がれる", () => {
    const originTasks = [mk({ id: "t1", start_date: null, due_date: null })];
    const { tasks } = buildInheritedTasks({
      ...baseParams,
      originTasks,
      checkedTaskIds: new Set(["t1"]),
      generateId: makeIdGenerator(),
    });
    expect(tasks[0].start_date).toBeNull();
    expect(tasks[0].due_date).toBeNull();
  });

  it("元PJに開始日が無ければ日付はスライドせずそのまま引き継がれる", () => {
    const originTasks = [mk({ id: "t1", start_date: "2026-01-04", due_date: "2026-01-08" })];
    const { tasks } = buildInheritedTasks({
      ...baseParams,
      originProjectStartDate: null,
      originTasks,
      checkedTaskIds: new Set(["t1"]),
      generateId: makeIdGenerator(),
    });
    expect(tasks[0].start_date).toBe("2026-01-04");
    expect(tasks[0].due_date).toBe("2026-01-08");
  });

  it("tags は元の配列とは別の配列インスタンスとしてコピーされる", () => {
    const originTags = ["A"];
    const originTasks = [mk({ id: "t1", tags: originTags })];
    const { tasks } = buildInheritedTasks({
      ...baseParams,
      originTasks,
      checkedTaskIds: new Set(["t1"]),
      generateId: makeIdGenerator(),
    });
    expect(tasks[0].tags).toEqual(["A"]);
    expect(tasks[0].tags).not.toBe(originTags);
  });
});

describe("buildInheritedDependencies", () => {
  it("先行・後続の両方がチェック済み（idMapに存在）の依存だけを新IDペアで返す", () => {
    const idMap = new Map([["a", "new-a"], ["b", "new-b"]]);
    const deps = [mkDep({ id: "d1", predecessor_task_id: "a", successor_task_id: "b" })];
    const result = buildInheritedDependencies(deps, idMap);
    expect(result).toEqual([{ predecessorTaskId: "new-a", successorTaskId: "new-b" }]);
  });

  it("片方だけチェックされている（idMapに無い）依存は引き継がない", () => {
    const idMap = new Map([["a", "new-a"]]); // b は未チェック
    const deps = [mkDep({ id: "d1", predecessor_task_id: "a", successor_task_id: "b" })];
    const result = buildInheritedDependencies(deps, idMap);
    expect(result).toEqual([]);
  });

  it("論理削除済みの依存は無視する", () => {
    const idMap = new Map([["a", "new-a"], ["b", "new-b"]]);
    const deps = [mkDep({ id: "d1", predecessor_task_id: "a", successor_task_id: "b", is_deleted: true })];
    const result = buildInheritedDependencies(deps, idMap);
    expect(result).toEqual([]);
  });

  it("複数の依存を正しく振り分ける", () => {
    const idMap = new Map([["a", "new-a"], ["b", "new-b"], ["c", "new-c"]]);
    const deps = [
      mkDep({ id: "d1", predecessor_task_id: "a", successor_task_id: "b" }),
      mkDep({ id: "d2", predecessor_task_id: "b", successor_task_id: "c" }),
      mkDep({ id: "d3", predecessor_task_id: "c", successor_task_id: "not-checked" }),
    ];
    const result = buildInheritedDependencies(deps, idMap);
    expect(result).toEqual([
      { predecessorTaskId: "new-a", successorTaskId: "new-b" },
      { predecessorTaskId: "new-b", successorTaskId: "new-c" },
    ]);
  });
});
