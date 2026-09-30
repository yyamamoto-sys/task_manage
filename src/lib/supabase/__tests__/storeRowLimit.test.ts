import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakePostgrest, makeRows } from "./fakePostgrest";

// 本物の PostgREST と同じく、1回の応答を max_rows=1000 で黙って打ち切る偽サーバ。
const fake = vi.hoisted(() => ({ current: null as null | { supabase: unknown; requests: unknown[] } }));

vi.mock("../client", () => ({
  get supabase() { return fake.current!.supabase; },
  isMisconfigured: false,
}));

import { fetchCriticalData, fetchOkrData, fetchAiUsageLogs } from "../store";

// 複数テストで共有するベースデータセット（呼び出しごとに新しいオブジェクトを返す）。
function baseTables() {
  return {
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
  };
}

beforeEach(() => {
  fake.current = createFakePostgrest(baseTables(), 1000);
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

describe("🔴 M41是正：構造表の失敗はthrow・周辺表の失敗は続行して部分失敗を返す（v3.122）", () => {
  it("task_dependencies が失敗したら例外を投げる（B1依存ゲートが黙って無効化されるのを防ぐ）", async () => {
    fake.current = createFakePostgrest(baseTables(), 1000, {
      task_dependencies: { code: "500", message: "boom" },
    });
    await expect(fetchCriticalData()).rejects.toThrow(/タスクの依存関係/);
  });

  it("task_projects が失敗したら例外を投げる", async () => {
    fake.current = createFakePostgrest(baseTables(), 1000, {
      task_projects: { code: "500", message: "boom" },
    });
    await expect(fetchCriticalData()).rejects.toThrow(/タスクとプロジェクトの紐づけ/);
  });

  it("members / projects / tasks が失敗したら従来どおり例外を投げる", async () => {
    fake.current = createFakePostgrest(baseTables(), 1000, { members: { code: "500", message: "boom" } });
    await expect(fetchCriticalData()).rejects.toThrow(/メンバー/);
  });

  it("member_tags が失敗しても例外にならず、部分失敗として返り他の表は取得できる", async () => {
    fake.current = createFakePostgrest(baseTables(), 1000, {
      member_tags: { code: "42501", message: "permission denied" },
    });
    const data = await fetchCriticalData();
    expect(data.partialFailures).toEqual(["メンバータグ"]);
    expect(data.memberTags).toEqual([]);
    // 他の表は影響を受けず取得できている
    expect(data.members).toHaveLength(3);
    expect(data.tasks).toHaveLength(1001);
  });

  it("milestones と member_tag_members が同時に失敗しても両方が部分失敗リストに入り、起動は続く", async () => {
    fake.current = createFakePostgrest(baseTables(), 1000, {
      milestones: { code: "500", message: "boom" },
      member_tag_members: { code: "500", message: "boom" },
    });
    const data = await fetchCriticalData();
    expect(data.partialFailures).toEqual(["マイルストーン", "メンバーとタグの紐づけ"]);
    expect(data.milestones).toEqual([]);
    expect(data.memberTagMembers).toEqual([]);
  });

  it("全表が正常なら partialFailures は空配列", async () => {
    const data = await fetchCriticalData();
    expect(data.partialFailures).toEqual([]);
  });
});

describe("🔴 M42是正：fetchOkrData（Phase 2）は6表すべて失敗してもthrowせず部分失敗を返す（v3.123）", () => {
  it("key_results が失敗しても例外にならず、部分失敗一覧に入り他5表のデータは返る", async () => {
    fake.current = createFakePostgrest(baseTables(), 1000, {
      key_results: { code: "500", message: "boom" },
    });
    const data = await fetchOkrData();
    expect(data.partialFailures).toEqual(["KR（重要な成果）"]);
    expect(data.keyResults).toEqual([]);
    // 他の表は影響を受けず取得できている
    expect(data.todos).toHaveLength(1200);
    expect(data.taskTaskForces).toHaveLength(1500);
  });

  it("全表が正常なら partialFailures は空配列", async () => {
    const data = await fetchOkrData();
    expect(data.partialFailures).toEqual([]);
  });

  it("複数表が同時に失敗しても全て部分失敗リストに入り、起動（取得）は続く", async () => {
    fake.current = createFakePostgrest(baseTables(), 1000, {
      objectives: { code: "500", message: "boom" },
      task_task_forces: { code: "500", message: "boom" },
    });
    const data = await fetchOkrData();
    expect(data.partialFailures).toEqual(["Objective（目標）", "タスクとタスクフォースの紐づけ"]);
    expect(data.objectives).toEqual([]);
    expect(data.taskTaskForces).toEqual([]);
    expect(data.todos).toHaveLength(1200);
  });
});
