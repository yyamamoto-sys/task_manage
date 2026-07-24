import { describe, it, expect } from "vitest";
import type { Task } from "../localData/types";
import { computeDropZoneFromRatio, computeSiblingReorderIds, computeInsertAfterOrder } from "../dragReorder";

// テスト用の最小 Task ファクトリ（taskHierarchy.test.ts と同じパターン）
function mk(partial: Partial<Task> & { id: string }): Task {
  return {
    id: partial.id,
    name: partial.name ?? partial.id,
    project_id: partial.project_id ?? null,
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
  };
}

describe("computeDropZoneFromRatio", () => {
  it("allowNest=false は常に50%で before/after のみ（nestを返さない）", () => {
    expect(computeDropZoneFromRatio(0.1, false)).toBe("before");
    expect(computeDropZoneFromRatio(0.49, false)).toBe("before");
    expect(computeDropZoneFromRatio(0.5, false)).toBe("after");
    expect(computeDropZoneFromRatio(0.9, false)).toBe("after");
  });

  it("allowNest=true は上30%/下30%/中央40%でnestを返す", () => {
    expect(computeDropZoneFromRatio(0.1, true)).toBe("before");
    expect(computeDropZoneFromRatio(0.5, true)).toBe("nest");
    expect(computeDropZoneFromRatio(0.9, true)).toBe("after");
    expect(computeDropZoneFromRatio(0.3, true)).toBe("nest");
    expect(computeDropZoneFromRatio(0.7, true)).toBe("nest");
  });
});

describe("computeSiblingReorderIds", () => {
  it("最上位タスク同士でbeforeに挿入すると先頭に来る", () => {
    const tasks = [
      mk({ id: "a", display_order: 0 }),
      mk({ id: "b", display_order: 1 }),
      mk({ id: "c", display_order: 2 }),
    ];
    const ids = computeSiblingReorderIds(tasks, tasks, "c", "a", "before");
    expect(ids).toEqual(["c", "a", "b"]);
  });

  it("最上位タスク同士でafterに挿入すると対象の直後に来る", () => {
    const tasks = [
      mk({ id: "a", display_order: 0 }),
      mk({ id: "b", display_order: 1 }),
      mk({ id: "c", display_order: 2 }),
    ];
    const ids = computeSiblingReorderIds(tasks, tasks, "a", "b", "after");
    expect(ids).toEqual(["b", "a", "c"]);
  });

  it("同じ親を共有する子同士だけを対象にし、他の親の子・最上位タスクは無視する", () => {
    const tasks = [
      mk({ id: "p1" }),
      mk({ id: "p2" }),
      mk({ id: "c1", parent_task_id: "p1", display_order: 0 }),
      mk({ id: "c2", parent_task_id: "p1", display_order: 1 }),
      mk({ id: "c3", parent_task_id: "p2", display_order: 0 }),
    ];
    const ids = computeSiblingReorderIds(tasks, tasks, "c2", "c1", "before");
    expect(ids).toEqual(["c2", "c1"]); // p2配下のc3・最上位のp1/p2は混ざらない
  });

  it("visibleTasksに含まれない兄弟（フィルタ等で非表示）は末尾にdisplay_order順で維持される", () => {
    const tasks = [
      mk({ id: "a", display_order: 0 }),
      mk({ id: "b", display_order: 1 }), // 非表示（例：ステータスフィルタで除外）
      mk({ id: "c", display_order: 2 }),
    ];
    const visible = tasks.filter(t => t.id !== "b");
    const ids = computeSiblingReorderIds(tasks, visible, "c", "a", "before");
    expect(ids).toEqual(["c", "a", "b"]);
  });

  it("targetIdがisSibling集合に見つからない場合はnullを返す", () => {
    const tasks = [
      mk({ id: "a", parent_task_id: "p1", display_order: 0 }),
      mk({ id: "b", parent_task_id: "p2", display_order: 0 }),
    ];
    // targetのisSibling条件（同じparent+project）にdraggedが元々含まれない状況でも、
    // targetId自体が存在しない場合はnull
    const ids = computeSiblingReorderIds(tasks, tasks, "a", "does-not-exist", "before");
    expect(ids).toBeNull();
  });

  it("project_idが異なる同名parent_task_idは別グループとして扱う（ドロップ先のPJへ移動する形でidsに挿入される）", () => {
    const tasks = [
      mk({ id: "c1", parent_task_id: "p1", project_id: "pj1", display_order: 0 }),
      mk({ id: "c2", parent_task_id: "p1", project_id: "pj2", display_order: 0 }),
    ];
    // c2（pj2配下）をc1（pj1配下）の後ろにドロップ＝ドロップ先の階層（p1/pj1）に挿入される
    // （呼び出し側=hookが返されたidsに従いproject_id/parent_task_idをtarget基準へ更新する）
    const ids = computeSiblingReorderIds(tasks, tasks, "c2", "c1", "after");
    expect(ids).toEqual(["c1", "c2"]);
  });
});

describe("computeInsertAfterOrder", () => {
  it("最上位タスクの直後に挿入される", () => {
    const tasks = [
      mk({ id: "a", display_order: 0 }),
      mk({ id: "b", display_order: 1 }),
      mk({ id: "c", display_order: 2 }),
      mk({ id: "new", display_order: 999 }), // 呼び出し側が任意の値で作成済みの想定
    ];
    const ids = computeInsertAfterOrder(tasks, "a", "new");
    expect(ids).toEqual(["a", "new", "b", "c"]);
  });

  it("末尾のタスクの直後に挿入すると最後尾になる", () => {
    const tasks = [
      mk({ id: "a", display_order: 0 }),
      mk({ id: "b", display_order: 1 }),
      mk({ id: "new", display_order: 999 }),
    ];
    const ids = computeInsertAfterOrder(tasks, "b", "new");
    expect(ids).toEqual(["a", "b", "new"]);
  });

  it("同じ親を共有する子同士だけを対象にし、他の親の子・最上位タスクは無視する", () => {
    const tasks = [
      mk({ id: "p1" }),
      mk({ id: "p2" }),
      mk({ id: "c1", parent_task_id: "p1", display_order: 0 }),
      mk({ id: "c2", parent_task_id: "p1", display_order: 1 }),
      mk({ id: "c3", parent_task_id: "p2", display_order: 0 }),
      mk({ id: "new", parent_task_id: "p1", display_order: 999 }),
    ];
    const ids = computeInsertAfterOrder(tasks, "c1", "new");
    expect(ids).toEqual(["c1", "new", "c2"]);
  });

  it("anchorIdが見つからない場合はnullを返す", () => {
    const tasks = [mk({ id: "a", display_order: 0 })];
    const ids = computeInsertAfterOrder(tasks, "does-not-exist", "new");
    expect(ids).toBeNull();
  });

  it("display_order が未整列でも並べ替えてから挿入する", () => {
    const tasks = [
      mk({ id: "a", display_order: 5 }),
      mk({ id: "b", display_order: 1 }),
      mk({ id: "c", display_order: 3 }),
      mk({ id: "new", display_order: 999 }),
    ];
    const ids = computeInsertAfterOrder(tasks, "c", "new");
    expect(ids).toEqual(["b", "c", "new", "a"]);
  });
});
