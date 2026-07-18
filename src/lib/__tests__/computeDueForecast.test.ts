import { describe, it, expect } from "vitest";
import type { Task } from "../localData/types";
import { computeDueForecast } from "../computeDueForecast";

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

// 基準日：2026-07-20（月）。土日は 7/25(土)・7/26(日)
const TODAY = "2026-07-20";

describe("computeDueForecast", () => {
  it("超過（today より前・未完了）を先頭バケットに集計する", () => {
    const tasks: Task[] = [
      mk({ id: "t1", due_date: "2026-07-18" }), // 2日前
      mk({ id: "t2", due_date: "2026-07-19" }), // 1日前
      mk({ id: "t3", due_date: "2026-07-15" }), // 5日前
    ];
    const buckets = computeDueForecast(tasks, TODAY);
    expect(buckets[0]).toMatchObject({ kind: "overdue", date: null, count: 3 });
  });

  it("当日（today）は kind='today' の先頭日別バケットになる", () => {
    const tasks: Task[] = [mk({ id: "t1", due_date: TODAY })];
    const buckets = computeDueForecast(tasks, TODAY);
    const todayBucket = buckets[1];
    expect(todayBucket.date).toBe(TODAY);
    expect(todayBucket.kind).toBe("today");
    expect(todayBucket.count).toBe(1);
  });

  it("土日は kind='weekend' になる（today 自身は除く）", () => {
    const tasks: Task[] = [];
    const buckets = computeDueForecast(tasks, TODAY);
    const sat = buckets.find(b => b.date === "2026-07-25");
    const sun = buckets.find(b => b.date === "2026-07-26");
    expect(sat?.kind).toBe("weekend");
    expect(sun?.kind).toBe("weekend");
    const mon = buckets.find(b => b.date === "2026-07-27");
    expect(mon?.kind).toBe("weekday");
  });

  it("期日なしタスクは集計から除外される", () => {
    const tasks: Task[] = [
      mk({ id: "t1", due_date: null }),
      mk({ id: "t2", due_date: TODAY }),
    ];
    const buckets = computeDueForecast(tasks, TODAY);
    const total = buckets.reduce((sum, b) => sum + b.count, 0);
    expect(total).toBe(1);
  });

  it("完了済み(done)タスクは集計から除外される", () => {
    const tasks: Task[] = [
      mk({ id: "t1", due_date: TODAY, status: "done" }),
      mk({ id: "t2", due_date: "2026-07-18", status: "done" }), // 超過だが完了済み
    ];
    const buckets = computeDueForecast(tasks, TODAY);
    const total = buckets.reduce((sum, b) => sum + b.count, 0);
    expect(total).toBe(0);
  });

  it("論理削除(is_deleted)タスクは集計から除外される", () => {
    const tasks: Task[] = [mk({ id: "t1", due_date: TODAY, is_deleted: true })];
    const buckets = computeDueForecast(tasks, TODAY);
    const total = buckets.reduce((sum, b) => sum + b.count, 0);
    expect(total).toBe(0);
  });

  it("既定は超過1件＋今日〜13日後の14件＝計15バケット", () => {
    const buckets = computeDueForecast([], TODAY);
    expect(buckets).toHaveLength(15);
    expect(buckets[buckets.length - 1].date).toBe("2026-08-02"); // today+13
  });
});
