import { describe, it, expect } from "vitest";
import type { Task, Project } from "../../localData/types";
import { computeTaskDiff, computeProjectDiff, TASK_TRACKED_FIELDS, PROJECT_TRACKED_FIELDS } from "../changeDiff";

// テスト用の最小 Task ファクトリ（taskEditPayload.test.ts と同じ流儀）
function mkTask(partial: Partial<Task> & { id: string }): Task {
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
    updated_by: partial.updated_by,
    display_order: partial.display_order,
    parent_task_id: partial.parent_task_id,
    tags: partial.tags,
    group_id: partial.group_id,
  };
}

function mkProject(partial: Partial<Project> & { id: string }): Project {
  return {
    id: partial.id,
    name: partial.name ?? partial.id,
    purpose: partial.purpose ?? "",
    contribution_memo: partial.contribution_memo ?? "",
    owner_member_id: partial.owner_member_id ?? "",
    owner_member_ids: partial.owner_member_ids ?? [],
    status: partial.status ?? "active",
    color_tag: partial.color_tag ?? "#000000",
    start_date: partial.start_date ?? "",
    end_date: partial.end_date ?? "",
    is_deleted: partial.is_deleted ?? false,
    updated_by: partial.updated_by,
    group_id: partial.group_id,
  };
}

describe("computeTaskDiff", () => {
  it("対象フィールドのみを拾う（trackedでないフィールドは無視する）", () => {
    const before = mkTask({ id: "t1", name: "A", display_order: 1, updated_by: "u1" });
    const after = mkTask({ id: "t1", name: "A", display_order: 99, updated_by: "u2" });
    const diff = computeTaskDiff(before, after);
    expect(diff).toEqual({});
  });

  it("変更なしなら空を返す", () => {
    const before = mkTask({ id: "t1", name: "A", status: "todo" });
    const after = mkTask({ id: "t1", name: "A", status: "todo" });
    expect(computeTaskDiff(before, after)).toEqual({});
  });

  it("nameの変更を検出する", () => {
    const before = mkTask({ id: "t1", name: "A" });
    const after = mkTask({ id: "t1", name: "B" });
    const diff = computeTaskDiff(before, after);
    expect(diff.name).toEqual({ before: "A", after: "B" });
    expect(Object.keys(diff)).toEqual(["name"]);
  });

  it("複数フィールドの変更を同時に検出する", () => {
    const before = mkTask({ id: "t1", name: "A", status: "todo", priority: "low" });
    const after = mkTask({ id: "t1", name: "A", status: "done", priority: "high" });
    const diff = computeTaskDiff(before, after);
    expect(diff.status).toEqual({ before: "todo", after: "done" });
    expect(diff.priority).toEqual({ before: "low", after: "high" });
    expect(diff.name).toBeUndefined();
  });

  it("配列（assignee_member_ids）は順序を無視した集合比較にする", () => {
    const before = mkTask({ id: "t1", assignee_member_ids: ["a", "b"] });
    const after = mkTask({ id: "t1", assignee_member_ids: ["b", "a"] });
    expect(computeTaskDiff(before, after)).toEqual({});
  });

  it("配列（assignee_member_ids）の実質的な変更は検出する", () => {
    const before = mkTask({ id: "t1", assignee_member_ids: ["a", "b"] });
    const after = mkTask({ id: "t1", assignee_member_ids: ["a", "c"] });
    const diff = computeTaskDiff(before, after);
    expect(diff.assignee_member_ids).toEqual({ before: ["a", "b"], after: ["a", "c"] });
  });

  it("配列（todo_ids）の順序無視比較・実質変更検出", () => {
    const before = mkTask({ id: "t1", todo_ids: ["x", "y"] });
    const sameOrderChanged = mkTask({ id: "t1", todo_ids: ["y", "x"] });
    expect(computeTaskDiff(before, sameOrderChanged)).toEqual({});

    const changed = mkTask({ id: "t1", todo_ids: ["x"] });
    const diff = computeTaskDiff(before, changed);
    expect(diff.todo_ids).toEqual({ before: ["x", "y"], after: ["x"] });
  });

  it("nullとundefinedを同一視する", () => {
    const before = mkTask({ id: "t1", priority: null });
    const after = mkTask({ id: "t1" });
    (after as unknown as { priority?: unknown }).priority = undefined;
    expect(computeTaskDiff(before, after)).toEqual({});
  });

  it("beforeがundefined（新規作成相当）でも例外を投げず、afterの実値との差分を返す", () => {
    const after = mkTask({ id: "t1", name: "新規タスク" });
    const diff = computeTaskDiff(undefined, after);
    expect(diff.name).toEqual({ before: null, after: "新規タスク" });
  });

  it("is_deletedの変化を検出する（delete/restoreアクションで使う）", () => {
    const before = mkTask({ id: "t1", is_deleted: false });
    const after = mkTask({ id: "t1", is_deleted: true });
    expect(computeTaskDiff(before, after)).toEqual({ is_deleted: { before: false, after: true } });
  });

  it("除外フィールド（display_order/updated_at/updated_by/group_id/tags等）は無視する", () => {
    const before = mkTask({ id: "t1", updated_at: "2026-01-01", group_id: "g1", tags: ["x"] });
    const after = mkTask({ id: "t1", updated_at: "2026-02-01", group_id: "g2", tags: ["y"] });
    expect(computeTaskDiff(before, after)).toEqual({});
  });
});

describe("computeProjectDiff", () => {
  it("PJ名・目的の変更を検出する", () => {
    const before = mkProject({ id: "p1", name: "旧PJ", purpose: "旧目的" });
    const after = mkProject({ id: "p1", name: "新PJ", purpose: "新目的" });
    const diff = computeProjectDiff(before, after);
    expect(diff.name).toEqual({ before: "旧PJ", after: "新PJ" });
    expect(diff.purpose).toEqual({ before: "旧目的", after: "新目的" });
  });

  it("変更なしなら空を返す", () => {
    const before = mkProject({ id: "p1" });
    const after = mkProject({ id: "p1" });
    expect(computeProjectDiff(before, after)).toEqual({});
  });

  it("group_id/group_idsは対象外", () => {
    const before = mkProject({ id: "p1", group_id: "g1" });
    const after = mkProject({ id: "p1", group_id: "g2" });
    expect(computeProjectDiff(before, after)).toEqual({});
  });
});

describe("TASK_TRACKED_FIELDS / PROJECT_TRACKED_FIELDS", () => {
  it("除外指定のフィールドを含んでいない", () => {
    const excluded = ["display_order", "updated_at", "updated_by", "created_at", "group_id", "group_ids", "baseline_start_date", "baseline_due_date", "finalized_mentions"];
    for (const f of excluded) {
      expect(TASK_TRACKED_FIELDS).not.toContain(f);
      expect(PROJECT_TRACKED_FIELDS).not.toContain(f);
    }
  });
});
