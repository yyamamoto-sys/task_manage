import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Task } from "../localData/types";
import { computeKpiInProgressCount, computeKpiWeekCompletion } from "../dashboardKpi";

const task = (over: Partial<Task>): Task => ({
  id: "t", name: "x", project_id: "p", todo_ids: [], assignee_member_id: "m", assignee_member_ids: ["m"],
  status: "todo", priority: null, start_date: null, due_date: null, estimated_hours: null, comment: "",
  is_deleted: false, display_order: 0, ...over,
} as Task);

describe("KPIは葉タスク基準（M79）", () => {
  // 親は子から自動で進行中・完了になる。親と子が同じ週に期限を持つと二重に数えていた
  const all = [
    task({ id: "parent", status: "in_progress", due_date: "2026-10-26" }),
    task({ id: "c1", parent_task_id: "parent", status: "in_progress", due_date: "2026-10-26" }),
    task({ id: "c2", parent_task_id: "parent", status: "done", due_date: "2026-10-27" }),
    task({ id: "leaf", status: "in_progress", due_date: "2026-10-28" }),
  ];

  it("進行中：子を持つ親は数えない", () => {
    expect(computeKpiInProgressCount(all, all)).toBe(2);
  });
  it("今週の完了率：親を分母・分子から外す（完了1／3件）", () => {
    const r = computeKpiWeekCompletion(all, all, "2026-10-23", "2026-10-30");
    expect(r.total).toBe(3);
    expect(r.done).toBe(1);
  });
  it("親判定は絞り込み前の全タスクで行う（子だけが絞り込みで外れても親を数えない）", () => {
    const filtered = all.filter(t => t.id !== "c1" && t.id !== "c2");
    expect(computeKpiInProgressCount(filtered, all)).toBe(1);
  });
  it("削除済みの子しか持たない親は葉として数える", () => {
    const a = [task({ id: "p", status: "in_progress" }), task({ id: "k", parent_task_id: "p", is_deleted: true })];
    expect(computeKpiInProgressCount(a, a)).toBe(1);
  });
  it("中止・保留は分母から外す（従来どおり）", () => {
    const a = [task({ id: "a", status: "done", due_date: "2026-10-24" }), task({ id: "b", status: "on_hold", due_date: "2026-10-24" })];
    expect(computeKpiWeekCompletion(a, a, "2026-10-23", "2026-10-30")).toMatchObject({ total: 1, done: 1, pct: 100 });
  });
  it("DashboardView はこの関数を通す", () => {
    const src = readFileSync(resolve(__dirname, "../../components/dashboard/DashboardView.tsx"), "utf-8");
    expect(src).toContain("computeKpiInProgressCount(");
    expect(src).toContain("computeKpiWeekCompletion(");
  });
});
