import { describe, it, expect, vi, beforeEach } from "vitest";

// ===== Supabase クライアントモック（applyProposal.test.ts と同じ仕組み） =====

interface MockResult {
  data?: unknown;
  error?: { message: string } | null;
}
interface MockCall {
  table: string;
  op: "select" | "update" | "insert";
  payload?: unknown;
  filters: Array<{ method: string; args: unknown[] }>;
}

const mockState = {
  queue: new Map<string, MockResult[]>(),
  calls: [] as MockCall[],
};

function queueResult(table: string, op: "select" | "update" | "insert", result: MockResult) {
  const key = `${table}:${op}`;
  if (!mockState.queue.has(key)) mockState.queue.set(key, []);
  mockState.queue.get(key)!.push(result);
}

function popResult(table: string, op: string): MockResult {
  const q = mockState.queue.get(`${table}:${op}`);
  return q?.shift() ?? { data: null, error: null };
}

function resetMock() {
  mockState.queue.clear();
  mockState.calls = [];
}

vi.mock("../client", () => {
  function makeBuilder(table: string, op: "select" | "update" | "insert", payload?: unknown) {
    const call: MockCall = { table, op, payload, filters: [] };
    mockState.calls.push(call);

    const builder: Record<string, unknown> = {};
    builder.eq = (...args: unknown[]) => {
      call.filters.push({ method: "eq", args });
      return builder;
    };
    builder.select = (..._cols: unknown[]) => builder;
    builder.maybeSingle = () => Promise.resolve(popResult(table, op));
    builder.single = () => Promise.resolve(popResult(table, op));
    builder.then = (onResolve: (v: MockResult) => unknown, onReject?: (e: unknown) => unknown) =>
      Promise.resolve(popResult(table, op)).then(onResolve, onReject);
    return builder;
  }

  const supabase = {
    from: (table: string) => ({
      select: (..._cols: unknown[]) => makeBuilder(table, "select"),
      update: (payload: unknown) => makeBuilder(table, "update", payload),
      insert: (payload: unknown) => makeBuilder(table, "insert", payload),
    }),
  };
  return { supabase, isMisconfigured: false };
});

// モック後に SUT を import
import { upsertTask, ConflictError } from "../store";
import type { Task } from "../../localData/types";

beforeEach(() => {
  resetMock();
});

function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    name: "T1",
    project_id: null,
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
    completed_at: null,
    ...over,
  };
}

// ===== テスト =====

describe("saveWithLock — クライアントが updated_at を上書きしてもロックが破綻しない（2026-05-12 修正）", () => {
  it("クライアントが row.updated_at を new Date() に上書きしていても DB-fetched 値でロックして更新が成功する", async () => {
    const dbUpdatedAt = "2026-05-12T01:00:00.000Z";
    const clientGarbageUpdatedAt = new Date().toISOString(); // 旧バグでクライアントが入れていた値

    // 1) SELECT 返却：DB の現在値
    queueResult("tasks", "select", { data: { id: "task-1", updated_at: dbUpdatedAt }, error: null });
    // 2) UPDATE 返却：更新成功（1行）
    queueResult("tasks", "update", { data: [{ id: "task-1" }], error: null });

    // クライアントが garbage な updated_at を渡す（旧バグ再現）
    await upsertTask(makeTask({ updated_at: clientGarbageUpdatedAt }));

    // UPDATE 文の WHERE 句に DB-fetched updated_at が使われているか
    const updateCall = mockState.calls.find(c => c.op === "update");
    expect(updateCall).toBeDefined();
    const updatedAtFilter = updateCall!.filters.find(f => f.args[0] === "updated_at");
    expect(updatedAtFilter).toBeDefined();
    // ★ クライアントの値ではなく、DB から SELECT で取った値が使われている
    expect(updatedAtFilter!.args[1]).toBe(dbUpdatedAt);
    expect(updatedAtFilter!.args[1]).not.toBe(clientGarbageUpdatedAt);
  });

  it("既存行があり、SELECT→UPDATE 間に他者が書き込んで 0 行更新になったら ConflictError", async () => {
    queueResult("tasks", "select", { data: { id: "task-1", updated_at: "2026-05-12T01:00:00.000Z" }, error: null });
    // 他者が間に書き込んで 0 行更新
    queueResult("tasks", "update", { data: [], error: null });

    await expect(upsertTask(makeTask())).rejects.toBeInstanceOf(ConflictError);
  });

  it("行が存在しない場合は INSERT 経路に入り、ロックチェックは行わない", async () => {
    queueResult("tasks", "select", { data: null, error: null });
    queueResult("tasks", "insert", { data: null, error: null });

    await upsertTask(makeTask());

    expect(mockState.calls.some(c => c.op === "insert" && c.table === "tasks")).toBe(true);
    expect(mockState.calls.some(c => c.op === "update")).toBe(false);
  });

  it("DB の updated_at が NULL なら ロックなしフォールバック（WHERE に updated_at を含めない）", async () => {
    queueResult("tasks", "select", { data: { id: "task-1", updated_at: null }, error: null });
    queueResult("tasks", "update", { data: null, error: null });

    await upsertTask(makeTask());

    const updateCall = mockState.calls.find(c => c.op === "update");
    expect(updateCall).toBeDefined();
    const updatedAtFilter = updateCall!.filters.find(f => f.args[0] === "updated_at");
    expect(updatedAtFilter).toBeUndefined(); // フォールバック経路では updated_at の eq は付かない
  });

  it("UPDATE 文には常に新しい updated_at が書き込まれる（DB トリガーが無くてもクライアントで生成）", async () => {
    queueResult("tasks", "select", { data: { id: "task-1", updated_at: "2026-05-12T01:00:00.000Z" }, error: null });
    queueResult("tasks", "update", { data: [{ id: "task-1" }], error: null });

    const before = new Date().toISOString();
    await upsertTask(makeTask());
    const after = new Date().toISOString();

    const updateCall = mockState.calls.find(c => c.op === "update");
    const payload = updateCall!.payload as Record<string, string>;
    expect(payload.updated_at).toBeDefined();
    // 新しく生成された ISO 文字列（今このテストが走った時刻の範囲内）
    expect(payload.updated_at >= before).toBe(true);
    expect(payload.updated_at <= after).toBe(true);
  });
});
