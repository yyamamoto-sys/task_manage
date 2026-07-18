import { describe, it, expect } from "vitest";
import type { Task } from "../localData/types";
import { computeWeeklyVelocity } from "../computeWeeklyVelocity";

// テスト用の最小 Task ファクトリ
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

// 基準日：2026-07-20（月）。今週の月曜=2026-07-20、先週の月曜=2026-07-13
const TODAY = "2026-07-20";

describe("computeWeeklyVelocity", () => {
  it("既定は直近8週分を古い週→今週の順で返す", () => {
    const buckets = computeWeeklyVelocity([], TODAY);
    expect(buckets).toHaveLength(8);
    expect(buckets[buckets.length - 1].weekStart).toBe("2026-07-20"); // 今週の月曜
    expect(buckets[0].weekStart).toBe("2026-06-01"); // 7週前の月曜
  });

  it("週境界：週内(月〜日)の completed_at は同じ週バケットに集計される", () => {
    const tasks: Task[] = [
      mk({ id: "t1", status: "done", completed_at: "2026-07-13T01:00:00.000Z" }), // 先週月曜
      mk({ id: "t2", status: "done", completed_at: "2026-07-19T23:59:59.000Z" }), // 先週日曜
    ];
    const buckets = computeWeeklyVelocity(tasks, TODAY);
    const lastWeek = buckets.find(b => b.weekStart === "2026-07-13");
    expect(lastWeek?.count).toBe(2);
  });

  it("週境界：週の切れ目（月曜0時）をまたぐと別バケットに分かれる", () => {
    const tasks: Task[] = [
      mk({ id: "t1", status: "done", completed_at: "2026-07-19T23:59:59.000Z" }), // 先週日曜（先週バケット）
      mk({ id: "t2", status: "done", completed_at: "2026-07-20T00:00:01.000Z" }), // 今週月曜（今週バケット）
    ];
    const buckets = computeWeeklyVelocity(tasks, TODAY);
    const lastWeek = buckets.find(b => b.weekStart === "2026-07-13");
    const thisWeek = buckets.find(b => b.weekStart === "2026-07-20");
    expect(lastWeek?.count).toBe(1);
    expect(thisWeek?.count).toBe(1);
  });

  it("completed_at が未設定の done タスクは除外される（クラッシュしない）", () => {
    const tasks: Task[] = [
      mk({ id: "t1", status: "done", completed_at: null }),
      mk({ id: "t2", status: "done", completed_at: "2026-07-20T03:00:00.000Z" }),
    ];
    const buckets = computeWeeklyVelocity(tasks, TODAY);
    const total = buckets.reduce((sum, b) => sum + b.count, 0);
    expect(total).toBe(1);
  });

  it("集計範囲（直近8週）より前の completed_at は除外される", () => {
    const tasks: Task[] = [
      mk({ id: "t1", status: "done", completed_at: "2026-01-01T00:00:00.000Z" }),
    ];
    const buckets = computeWeeklyVelocity(tasks, TODAY);
    const total = buckets.reduce((sum, b) => sum + b.count, 0);
    expect(total).toBe(0);
  });

  it("未完了(done以外)タスクは completed_at があっても除外される", () => {
    const tasks: Task[] = [
      mk({ id: "t1", status: "in_progress", completed_at: "2026-07-20T03:00:00.000Z" }),
    ];
    const buckets = computeWeeklyVelocity(tasks, TODAY);
    const total = buckets.reduce((sum, b) => sum + b.count, 0);
    expect(total).toBe(0);
  });

  it("論理削除(is_deleted)タスクは除外される", () => {
    const tasks: Task[] = [
      mk({ id: "t1", status: "done", completed_at: "2026-07-20T03:00:00.000Z", is_deleted: true }),
    ];
    const buckets = computeWeeklyVelocity(tasks, TODAY);
    const total = buckets.reduce((sum, b) => sum + b.count, 0);
    expect(total).toBe(0);
  });
});
