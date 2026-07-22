import { describe, it, expect } from "vitest";
import type { Task } from "../localData/types";
import { buildTaskUpdatePayload, type TaskEditFormState } from "../taskEditPayload";

// テスト用の最小 Task ファクトリ（taskHierarchy.test.ts と同じ流儀）
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
    tags: partial.tags,
  };
}

function mkForm(partial: Partial<TaskEditFormState> = {}): TaskEditFormState {
  return {
    name: "タスクA",
    status: "todo",
    priority: "",
    assignee_member_ids: [],
    project_id: "pj1",
    parent_task_id: null,
    start_date: "",
    due_date: "",
    estimated_hours: "",
    comment: "",
    tags: [],
    ...partial,
  };
}

describe("buildTaskUpdatePayload", () => {
  it("フォームの各フィールドを Task にマッピングする", () => {
    const original = mk({ id: "t1", project_id: "pj1" });
    const form = mkForm({
      name: "  改題後  ",
      status: "in_progress",
      priority: "high",
      assignee_member_ids: ["m1", "m2"],
      start_date: "2026-07-01",
      due_date: "2026-07-10",
      estimated_hours: "2.5",
      comment: "メモ",
      tags: ["a", "b"],
    });
    const result = buildTaskUpdatePayload(original, form, null, "me");

    expect(result.name).toBe("改題後"); // trim される
    expect(result.status).toBe("in_progress");
    expect(result.priority).toBe("high");
    expect(result.assignee_member_ids).toEqual(["m1", "m2"]);
    expect(result.assignee_member_id).toBe("m1"); // 先頭が単数フィールドにも入る
    expect(result.project_id).toBe("pj1");
    expect(result.start_date).toBe("2026-07-01");
    expect(result.due_date).toBe("2026-07-10");
    expect(result.estimated_hours).toBe(2.5);
    expect(result.comment).toBe("メモ");
    expect(result.tags).toEqual(["a", "b"]);
    expect(result.updated_by).toBe("me");
  });

  it("名前が空文字（trim後）なら originalTask.name を維持する", () => {
    const original = mk({ id: "t1", name: "元の名前" });
    const form = mkForm({ name: "   " });
    const result = buildTaskUpdatePayload(original, form, null, "me");
    expect(result.name).toBe("元の名前");
  });

  it("親タスクが設定されている場合、project_id は親のPJに揃える", () => {
    const original = mk({ id: "t1", project_id: "pj1" });
    const parent = mk({ id: "parent1", project_id: "pj2" });
    const form = mkForm({ project_id: "pj1", parent_task_id: "parent1" });
    const result = buildTaskUpdatePayload(original, form, parent, "me");
    expect(result.project_id).toBe("pj2");
    expect(result.parent_task_id).toBe("parent1");
  });

  it("親を持たない場合はフォームの project_id をそのまま使う（空文字は null）", () => {
    const original = mk({ id: "t1", project_id: "pj1" });
    const form = mkForm({ project_id: "" });
    const result = buildTaskUpdatePayload(original, form, null, "me");
    expect(result.project_id).toBeNull();
  });

  it("estimated_hours が数値変換できない場合は null にする", () => {
    const original = mk({ id: "t1" });
    const form = mkForm({ estimated_hours: "" });
    const result = buildTaskUpdatePayload(original, form, null, "me");
    expect(result.estimated_hours).toBeNull();
  });

  it("priority が空文字なら null にする", () => {
    const original = mk({ id: "t1" });
    const form = mkForm({ priority: "" });
    const result = buildTaskUpdatePayload(original, form, null, "me");
    expect(result.priority).toBeNull();
  });

  it("担当者0人なら assignee_member_id は空文字", () => {
    const original = mk({ id: "t1" });
    const form = mkForm({ assignee_member_ids: [] });
    const result = buildTaskUpdatePayload(original, form, null, "me");
    expect(result.assignee_member_id).toBe("");
  });

  it("form.tags が省略されている場合（TaskSidePanel にはタグUIが無い）originalTask.tags を維持する", () => {
    const original = mk({ id: "t1", tags: ["既存タグ"] });
    const { tags: _omit, ...formWithoutTags } = mkForm();
    const result = buildTaskUpdatePayload(original, formWithoutTags, null, "me");
    expect(result.tags).toEqual(["既存タグ"]);
  });
});
