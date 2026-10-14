import { describe, expect, it } from "vitest";
import type { Task } from "../../localData/types";
import { nextDisplayOrder, prepareNewTask, validateTaskDateRange } from "../newTask";

const base = (over: Partial<Task>): Task => ({
  id: "t", name: "n", project_id: null, todo_ids: [], assignee_member_id: "", assignee_member_ids: [],
  status: "todo", priority: null, start_date: null, due_date: null, estimated_hours: null,
  comment: "", is_deleted: false, parent_task_id: null, display_order: 0, ...over,
});

const input = {
  name: "  新規  ", projectId: "p1", parentId: null as string | null, todoIds: [] as string[],
  assigneeIds: [] as string[], status: "todo" as Task["status"], priority: null as Task["priority"],
  startDate: "", dueDate: "", comment: "", updatedBy: "u1",
};

describe("nextDisplayOrder", () => {
  it("同じPJ・同じ親の非削除タスクの最大+1。無ければ0", () => {
    const tasks = [
      base({ id: "a", project_id: "p1", display_order: 3 }),
      base({ id: "b", project_id: "p1", display_order: 7, is_deleted: true }),
      base({ id: "c", project_id: "p2", display_order: 9 }),
      base({ id: "d", project_id: "p1", parent_task_id: "a", display_order: 20 }),
    ];
    expect(nextDisplayOrder(tasks, "p1", null)).toBe(4);
    expect(nextDisplayOrder(tasks, "p3", null)).toBe(0);
    expect(nextDisplayOrder(tasks, "p1", "a")).toBe(21);
  });
  it("PJ未設定同士も兄弟として数える", () => {
    expect(nextDisplayOrder([base({ id: "a", project_id: null, display_order: 1 })], null, null)).toBe(2);
  });
});

describe("prepareNewTask", () => {
  it("名前をtrimし、トップレベル・採番・担当者・更新者を組み立てる", () => {
    const tasks = [base({ id: "a", project_id: "p1", display_order: 5 })];
    const t = prepareNewTask({ ...input, assigneeIds: ["m1", "m2"] }, tasks);
    expect(t.name).toBe("新規");
    expect(t.project_id).toBe("p1");
    expect(t.parent_task_id).toBeNull();
    expect(t.display_order).toBe(6);
    expect(t.assignee_member_id).toBe("m1");
    expect(t.assignee_member_ids).toEqual(["m1", "m2"]);
    expect(t.updated_by).toBe("u1");
    expect(t.is_deleted).toBe(false);
    expect(t.start_date).toBeNull();
    expect(t.due_date).toBeNull();
  });
  it("担当者なしは空文字・空配列", () => {
    const t = prepareNewTask(input, []);
    expect(t.assignee_member_id).toBe("");
    expect(t.assignee_member_ids).toEqual([]);
  });
  it("親を指定するとproject_idは親のPJに揃い、兄弟は親の子から数える", () => {
    const tasks = [
      base({ id: "par", project_id: "p9", display_order: 0 }),
      base({ id: "kid", project_id: "p9", parent_task_id: "par", display_order: 2 }),
    ];
    const t = prepareNewTask({ ...input, projectId: "p1", parentId: "par" }, tasks);
    expect(t.project_id).toBe("p9");
    expect(t.parent_task_id).toBe("par");
    expect(t.display_order).toBe(3);
  });
  it("tags は指定があるときだけ付く（無指定のタスクの形を変えない）", () => {
    expect("tags" in prepareNewTask(input, [])).toBe(false);
    expect(prepareNewTask({ ...input, tags: ["x"] }, []).tags).toEqual(["x"]);
  });
  it("finalized_mentions を必ず確定する", () => {
    const t = prepareNewTask(input, []);
    expect(t.finalized_mentions).toEqual([]);
  });
  it("日付は空文字ならnull、あればそのまま", () => {
    const t = prepareNewTask({ ...input, startDate: "2026-10-01", dueDate: "2026-10-05" }, []);
    expect(t.start_date).toBe("2026-10-01");
    expect(t.due_date).toBe("2026-10-05");
  });
});

describe("validateTaskDateRange", () => {
  it("開始日が期日より後ならメッセージを返す。同日・片方だけ・空は通す", () => {
    expect(validateTaskDateRange("2026-10-06", "2026-10-05")).toMatch(/開始日/);
    expect(validateTaskDateRange("2026-10-05", "2026-10-05")).toBeNull();
    expect(validateTaskDateRange("2026-10-05", "")).toBeNull();
    expect(validateTaskDateRange("", "2026-10-05")).toBeNull();
    expect(validateTaskDateRange(null, null)).toBeNull();
  });
});
