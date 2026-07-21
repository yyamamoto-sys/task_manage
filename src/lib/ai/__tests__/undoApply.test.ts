import { describe, it, expect, beforeEach, vi } from "vitest";
import type { UndoSnapshot } from "../../../hooks/useUndoStack";

// ===== Supabase クライアントモック（applyProposal.test.ts と同じキュー方式） =====

interface MockResult {
  data?: unknown;
  error?: { message: string } | null;
}
interface MockCall {
  table: string;
  op: "select" | "update" | "insert" | "delete";
  payload?: unknown;
  filters: Array<{ method: string; args: unknown[] }>;
}

const mockState = {
  queue: new Map<string, MockResult[]>(),
  calls: [] as MockCall[],
  physicalDeleteAttempts: 0,
};

function queueResult(table: string, op: "update", result: MockResult) {
  const key = `${table}:${op}`;
  if (!mockState.queue.has(key)) mockState.queue.set(key, []);
  mockState.queue.get(key)!.push(result);
}

function popResult(table: string, op: string): MockResult {
  const key = `${table}:${op}`;
  const q = mockState.queue.get(key);
  return q?.shift() ?? { data: null, error: null };
}

function resetMock() {
  mockState.queue.clear();
  mockState.calls = [];
  mockState.physicalDeleteAttempts = 0;
}

vi.mock("../../supabase/client", () => {
  function makeBuilder(table: string, op: "select" | "update" | "insert" | "delete", payload?: unknown) {
    const call: MockCall = { table, op, payload, filters: [] };
    mockState.calls.push(call);

    if (op === "delete") {
      mockState.physicalDeleteAttempts++;
    }

    const builder: Record<string, unknown> = {};
    builder.eq = (...args: unknown[]) => {
      call.filters.push({ method: "eq", args });
      return builder;
    };
    builder.single = () => Promise.resolve(popResult(table, op));
    // thenable: await で resolve できるようにする
    builder.then = (onResolve: (v: MockResult) => unknown, onReject?: (e: unknown) => unknown) =>
      Promise.resolve(popResult(table, op)).then(onResolve, onReject);
    return builder;
  }

  const supabase = {
    from: (table: string) => ({
      select: (..._cols: unknown[]) => makeBuilder(table, "select"),
      update: (payload: unknown) => makeBuilder(table, "update", payload),
      insert: (payload: unknown) => makeBuilder(table, "insert", payload),
      delete: () => makeBuilder(table, "delete"),
    }),
  };
  return { supabase, isMisconfigured: false };
});

import { applyUndo } from "../undoApply";

beforeEach(() => {
  resetMock();
});

function makeSnapshot(operations: UndoSnapshot["operations"]): UndoSnapshot {
  return {
    id: "snap-1",
    label: "テスト",
    appliedAt: "2026-07-21T00:00:00Z",
    operations,
  };
}

describe("applyUndo — 物理削除しないこと（最重要）", () => {
  it("いずれの operation タイプでも .delete() は呼ばれない", async () => {
    const snapshot = makeSnapshot([
      { type: "task_field", taskId: "t-1", field: "due_date", oldValue: "2026-05-01" },
      { type: "task_restore", taskId: "t-2" },
      { type: "task_delete", taskId: "t-3" },
      { type: "pj_field", pjId: "pj-1", field: "end_date", oldValue: "2026-06-01" },
      { type: "pj_restore", pjId: "pj-2" },
      { type: "pj_delete", pjId: "pj-3" },
    ]);
    const result = await applyUndo(snapshot, "user-1");
    expect(result.type).toBe("success");
    expect(mockState.physicalDeleteAttempts).toBe(0);
  });
});

describe("applyUndo — 各operationタイプの実処理", () => {
  it("task_field: 指定フィールドをoldValueに戻すUPDATEを発行する", async () => {
    const snapshot = makeSnapshot([
      { type: "task_field", taskId: "t-1", field: "due_date", oldValue: "2026-05-01" },
    ]);
    await applyUndo(snapshot, "user-1");

    const call = mockState.calls.find(c => c.table === "tasks" && c.op === "update");
    expect(call).toBeDefined();
    const payload = call!.payload as Record<string, unknown>;
    expect(payload.due_date).toBe("2026-05-01");
    expect(payload.updated_by).toBe("user-1");
    expect(call!.filters.some(f => f.args[0] === "id" && f.args[1] === "t-1")).toBe(true);
  });

  it("task_restore: is_deleted=falseに戻す", async () => {
    const snapshot = makeSnapshot([{ type: "task_restore", taskId: "t-2" }]);
    await applyUndo(snapshot, "user-1");

    const call = mockState.calls.find(c => c.table === "tasks" && c.op === "update");
    const payload = call!.payload as Record<string, unknown>;
    expect(payload.is_deleted).toBe(false);
    expect(payload.deleted_at).toBeNull();
  });

  it("task_delete: is_deleted=trueにする（add_taskのUndo）", async () => {
    const snapshot = makeSnapshot([{ type: "task_delete", taskId: "t-3" }]);
    await applyUndo(snapshot, "user-1");

    const call = mockState.calls.find(c => c.table === "tasks" && c.op === "update");
    const payload = call!.payload as Record<string, unknown>;
    expect(payload.is_deleted).toBe(true);
    expect(payload.deleted_by).toBe("user-1");
  });

  it("pj_field: PJの指定フィールドをoldValueに戻すUPDATEをprojectsテーブルへ発行する（バグ修正の回帰テスト）", async () => {
    const snapshot = makeSnapshot([
      { type: "pj_field", pjId: "pj-1", field: "end_date", oldValue: "2026-06-01" },
    ]);
    await applyUndo(snapshot, "user-1");

    const call = mockState.calls.find(c => c.table === "projects" && c.op === "update");
    expect(call).toBeDefined();
    const payload = call!.payload as Record<string, unknown>;
    expect(payload.end_date).toBe("2026-06-01");
    expect(payload.updated_by).toBe("user-1");
    expect(call!.filters.some(f => f.args[0] === "id" && f.args[1] === "pj-1")).toBe(true);
  });

  it("pj_restore: PJ配下の全タスク→PJ本体の順にis_deleted=falseへ復元する", async () => {
    const snapshot = makeSnapshot([{ type: "pj_restore", pjId: "pj-2" }]);
    await applyUndo(snapshot, "user-1");

    const tasksCall = mockState.calls.find(c => c.table === "tasks" && c.op === "update");
    const pjCall = mockState.calls.find(c => c.table === "projects" && c.op === "update");
    expect((tasksCall!.payload as Record<string, unknown>).is_deleted).toBe(false);
    expect((pjCall!.payload as Record<string, unknown>).is_deleted).toBe(false);
    expect(tasksCall!.filters.some(f => f.args[0] === "project_id" && f.args[1] === "pj-2")).toBe(true);
  });

  it("pj_delete: PJ配下の全タスク→PJ本体の順にis_deleted=trueにする（add_projectのUndo）", async () => {
    const snapshot = makeSnapshot([{ type: "pj_delete", pjId: "pj-3" }]);
    await applyUndo(snapshot, "user-1");

    const tasksCall = mockState.calls.find(c => c.table === "tasks" && c.op === "update");
    const pjCall = mockState.calls.find(c => c.table === "projects" && c.op === "update");
    expect((tasksCall!.payload as Record<string, unknown>).is_deleted).toBe(true);
    expect((pjCall!.payload as Record<string, unknown>).is_deleted).toBe(true);
  });

  it("operations配列は逆順（後に実行した操作から）に適用する", async () => {
    const snapshot = makeSnapshot([
      { type: "task_field", taskId: "t-1", field: "due_date", oldValue: "2026-05-01" },
      { type: "pj_field", pjId: "pj-1", field: "end_date", oldValue: "2026-06-01" },
    ]);
    await applyUndo(snapshot, "user-1");

    const updateCalls = mockState.calls.filter(c => c.op === "update");
    expect(updateCalls[0].table).toBe("projects"); // pj_field（配列2番目）が先に適用される
    expect(updateCalls[1].table).toBe("tasks");    // task_field（配列1番目）が後に適用される
  });
});

describe("applyUndo — エラー処理", () => {
  it("UPDATEがerrorを返した場合、formatErrorForUser経由のメッセージでtype:errorを返す", async () => {
    queueResult("tasks", "update", { data: null, error: { message: "boom" } });

    const snapshot = makeSnapshot([
      { type: "task_field", taskId: "t-1", field: "due_date", oldValue: "2026-05-01" },
    ]);
    const result = await applyUndo(snapshot, "user-1");

    expect(result.type).toBe("error");
    if (result.type !== "error") return;
    expect(result.message).toContain("元に戻す処理に失敗しました");
    expect(result.message).toContain("boom");
  });

  it("pj_fieldのUPDATEがerrorを返した場合もtype:errorを返す", async () => {
    queueResult("projects", "update", { data: null, error: { message: "pj boom" } });

    const snapshot = makeSnapshot([
      { type: "pj_field", pjId: "pj-1", field: "end_date", oldValue: "2026-06-01" },
    ]);
    const result = await applyUndo(snapshot, "user-1");

    expect(result.type).toBe("error");
    if (result.type !== "error") return;
    expect(result.message).toContain("PJフィールド復元エラー");
  });
});
