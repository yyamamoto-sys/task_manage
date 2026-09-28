import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakePostgrest, makeRows } from "./fakePostgrest";

// 本物の PostgREST と同じく、1回の応答を max_rows=1000 で黙って打ち切る偽サーバ。
const fake = vi.hoisted(() => ({ current: null as null | { supabase: unknown; requests: unknown[] } }));

vi.mock("../client", () => ({
  get supabase() { return fake.current!.supabase; },
  isMisconfigured: false,
}));

import { fetchCriticalData, fetchOkrData, fetchAiUsageLogs } from "../store";

beforeEach(() => {
  fake.current = createFakePostgrest({
    members: makeRows(3),
    projects: makeRows(2),
    tasks: [...makeRows(1001), ...makeRows(5, () => ({ is_deleted: true })).map((r, i) => ({ ...r, id: `deleted${i}` }))],
    task_projects: Array.from({ length: 1001 }, (_, i) => ({ task_id: `r${String(i).padStart(6, "0")}`, project_id: "p1" })),
    milestones: [],
    member_tags: [],
    member_tag_members: [],
    task_dependencies: [],
    objectives: [],
    key_results: [],
    task_forces: [],
    todos: makeRows(1200),
    project_task_forces: [],
    task_task_forces: Array.from({ length: 1500 }, (_, i) => ({ task_id: `t${i}`, tf_id: "tf1" })),
    ai_usage_logs: makeRows(1716, i => ({ called_at: `2026-09-${String(1 + (i % 28)).padStart(2, "0")}` })),
  }, 1000);
});

describe("🔴 初期ロードは PostgREST の1000行上限で欠けない（v3.116）", () => {
  it("tasks が1001件あれば1001件とも読む（削除済みは除く）", async () => {
    const data = await fetchCriticalData();
    expect(data.tasks).toHaveLength(1001);
    expect(data.tasks.some(t => t.id === "r001000")).toBe(true);
    expect(data.taskProjects).toHaveLength(1001);
  });

  it("ページ間で並びが揺れないよう、作成順→主キー順で並べて取る", async () => {
    await fetchCriticalData();
    const req = (fake.current as unknown as { requests: Array<{ table: string; orders: Array<{ column: string }> }> })
      .requests.find(r => r.table === "tasks");
    expect(req?.orders.map(o => o.column)).toEqual(["created_at", "id"]);
  });

  it("OKR系も1000件を超えて読む", async () => {
    const data = await fetchOkrData();
    expect(data.todos).toHaveLength(1200);
    expect(data.taskTaskForces).toHaveLength(1500);
  });

  it("AI使用量ログも1000件を超えて読む", async () => {
    const logs = await fetchAiUsageLogs();
    expect(logs).toHaveLength(1716);
  });
});
