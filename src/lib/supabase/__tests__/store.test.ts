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

describe("saveWithLock — 多人数運用対応（expectedUpdatedAt 明示）", () => {
  it("expectedUpdatedAt を渡すとフォーム時点の値で WHERE 句のロックを書く", async () => {
    const formLoadedAt = "2026-05-12T01:00:00.000Z"; // フォーム表示時に読んだ値
    const dbCurrent    = "2026-05-12T01:00:00.000Z"; // DB の現在値（他者書き込みなし）

    queueResult("tasks", "select", { data: { id: "task-1", updated_at: dbCurrent }, error: null });
    queueResult("tasks", "update", { data: [{ id: "task-1" }], error: null });

    // expectedUpdatedAt を明示的に渡す（zustand の saveX が必ずやる）
    await upsertTask(makeTask(), formLoadedAt);

    const updateCall = mockState.calls.find(c => c.op === "update");
    const lockFilter = updateCall!.filters.find(f => f.args[0] === "updated_at");
    expect(lockFilter!.args[1]).toBe(formLoadedAt);
  });

  it("expectedUpdatedAt と DB の値が違えば ConflictError（他者がフォーム開けっぱの間に更新したケース）", async () => {
    const formLoadedAt = "2026-05-12T01:00:00.000Z"; // ユーザーAがロードした時の値
    const dbCurrent    = "2026-05-12T02:30:00.000Z"; // ユーザーBがその後更新した値

    queueResult("tasks", "select", { data: { id: "task-1", updated_at: dbCurrent }, error: null });
    // UPDATE は 0 行（WHERE updated_at = formLoadedAt にマッチしないので）
    queueResult("tasks", "update", { data: [], error: null });

    await expect(upsertTask(makeTask(), formLoadedAt)).rejects.toBeInstanceOf(ConflictError);
  });

  it("【重要】DB の BEFORE UPDATE トリガーが updated_at を上書きする場合、その実値を返す", async () => {
    // 本番の Postgres schema には trg_tasks_updated_at が貼られており、
    // クライアントが送った updated_at はトリガーで NOW() に上書きされる。
    // saveWithLock は .select("id,updated_at") でその実値を取って return する必要がある。
    // （旧コードはクライアント生成値を return していたため、次の保存で
    //   expectedUpdatedAt が DB と数 μs ずれて 100% ConflictError になっていた）
    const triggerOverrideValue = "2026-05-12T05:30:00.123456+00:00";

    queueResult("tasks", "select", {
      data: { id: "task-1", updated_at: "2026-05-12T01:00:00.000Z" },
      error: null,
    });
    queueResult("tasks", "update", {
      data: [{ id: "task-1", updated_at: triggerOverrideValue }],
      error: null,
    });

    const returned = await upsertTask(makeTask(), "2026-05-12T01:00:00.000Z");

    // ★ クライアントが送った時刻ではなく、DB から返ってきた trigger 適用後の値
    expect(returned).toBe(triggerOverrideValue);
  });
});

describe("saveWithLock — expectedUpdatedAt 省略時のフォールバック（自動更新・realtime sync 用途）", () => {
  it("expectedUpdatedAt なし + クライアントが garbage な row.updated_at → DB-fetched 値でロック", async () => {
    const dbUpdatedAt = "2026-05-12T01:00:00.000Z";
    const clientGarbageUpdatedAt = new Date().toISOString();

    queueResult("tasks", "select", { data: { id: "task-1", updated_at: dbUpdatedAt }, error: null });
    queueResult("tasks", "update", { data: [{ id: "task-1" }], error: null });

    // expectedUpdatedAt を渡さず、row.updated_at に garbage が入っているケース
    await upsertTask(makeTask({ updated_at: clientGarbageUpdatedAt }));

    const updateCall = mockState.calls.find(c => c.op === "update");
    const lockFilter = updateCall!.filters.find(f => f.args[0] === "updated_at");
    // 引数省略時は DB の SELECT 結果を使う TOCTOU フォールバック
    expect(lockFilter!.args[1]).toBe(dbUpdatedAt);
    expect(lockFilter!.args[1]).not.toBe(clientGarbageUpdatedAt);
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
