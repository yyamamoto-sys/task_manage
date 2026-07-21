import { describe, it, expect, afterEach, vi } from "vitest";
import { computeMemberWorkloadRows } from "../computeWorkload";
import type { Member, Task } from "../../localData/types";

function makeMember(over: Partial<Member> = {}): Member {
  return {
    id: "m1",
    display_name: "山本",
    short_name: "山本",
    initials: "YY",
    teams_account: "",
    color_bg: "#fff",
    color_text: "#000",
    is_deleted: false,
    ...over,
  };
}

function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    name: "タスク1",
    project_id: "pj-1",
    todo_ids: [],
    assignee_member_id: "m1",
    assignee_member_ids: ["m1"],
    status: "todo",
    priority: null,
    start_date: null,
    due_date: null,
    estimated_hours: null,
    comment: "",
    is_deleted: false,
    ...over,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("computeMemberWorkloadRows — 件数集計", () => {
  it("todo/in_progress をカウントし done は active_count に含めない", () => {
    const rows = computeMemberWorkloadRows(
      [makeMember({ id: "m1" })],
      [
        makeTask({ id: "t1", status: "todo", assignee_member_id: "m1" }),
        makeTask({ id: "t2", status: "in_progress", assignee_member_id: "m1" }),
        makeTask({ id: "t3", status: "done", assignee_member_id: "m1" }),
      ],
    );
    const row = rows[0];
    expect(row.todo_count).toBe(1);
    expect(row.in_progress_count).toBe(1);
    expect(row.active_count).toBe(2);
  });

  it("複数担当者（assignee_member_ids）は各担当者の負荷にそれぞれ積む", () => {
    const rows = computeMemberWorkloadRows(
      [makeMember({ id: "m1", short_name: "山本" }), makeMember({ id: "m2", short_name: "田中" })],
      [
        makeTask({ id: "t1", assignee_member_id: "m1", assignee_member_ids: ["m1", "m2"], status: "in_progress" }),
        makeTask({ id: "t2", assignee_member_id: "m2", assignee_member_ids: ["m2"], status: "todo" }),
      ],
    );
    const m1 = rows.find(r => r.short_name === "山本")!;
    const m2 = rows.find(r => r.short_name === "田中")!;
    expect(m1.active_count).toBe(1);
    expect(m2.active_count).toBe(2);
  });

  it("cancelled/on_hold は active_count に含めない（2026-07-21 ステータス拡張）", () => {
    const rows = computeMemberWorkloadRows(
      [makeMember({ id: "m1" })],
      [
        makeTask({ id: "t1", status: "todo", assignee_member_id: "m1" }),
        makeTask({ id: "t2", status: "cancelled", assignee_member_id: "m1" }),
        makeTask({ id: "t3", status: "on_hold", assignee_member_id: "m1" }),
      ],
    );
    const row = rows[0];
    expect(row.todo_count).toBe(1);
    expect(row.active_count).toBe(1);
  });

  it("is_deleted なタスク・メンバーは除外する", () => {
    const rows = computeMemberWorkloadRows(
      [makeMember({ id: "m1" }), makeMember({ id: "m2", is_deleted: true })],
      [
        makeTask({ id: "t1", assignee_member_id: "m1", status: "todo" }),
        makeTask({ id: "t2", assignee_member_id: "m1", status: "todo", is_deleted: true }),
      ],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].todo_count).toBe(1);
  });
});

describe("computeMemberWorkloadRows — 工数合計の境界（未入力を0扱いしない）", () => {
  it("estimated_hours=null のタスクは合計から除外し、tasks_without_estimate でカウントする", () => {
    const rows = computeMemberWorkloadRows(
      [makeMember({ id: "m1" })],
      [
        makeTask({ id: "t1", status: "todo", estimated_hours: 4 }),
        makeTask({ id: "t2", status: "todo", estimated_hours: null }),
        makeTask({ id: "t3", status: "todo", estimated_hours: 2 }),
      ],
    );
    const row = rows[0];
    expect(row.total_estimated_hours).toBe(6);
    expect(row.tasks_with_estimate).toBe(2);
    expect(row.tasks_without_estimate).toBe(1);
  });

  it("全タスクが未入力なら total_estimated_hours は 0 ではなく null", () => {
    const rows = computeMemberWorkloadRows(
      [makeMember({ id: "m1" })],
      [makeTask({ id: "t1", status: "todo", estimated_hours: null })],
    );
    expect(rows[0].total_estimated_hours).toBeNull();
    expect(rows[0].tasks_without_estimate).toBe(1);
  });
});

describe("computeMemberWorkloadRows — 期限超過カウント", () => {
  it("アクティブタスクで期日が過去のものだけを overdue_count に数える", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T09:00:00+09:00"));
    const rows = computeMemberWorkloadRows(
      [makeMember({ id: "m1" })],
      [
        makeTask({ id: "t1", status: "todo", due_date: "2026-07-10" }),        // 過去→超過
        makeTask({ id: "t2", status: "in_progress", due_date: "2026-07-17" }), // 今日→超過ではない
        makeTask({ id: "t3", status: "todo", due_date: "2026-08-01" }),        // 未来→超過ではない
        makeTask({ id: "t4", status: "done", due_date: "2026-01-01" }),        // done→対象外
        makeTask({ id: "t5", status: "todo", due_date: null }),                // 期日なし→対象外
      ],
    );
    expect(rows[0].overdue_count).toBe(1);
  });
});
