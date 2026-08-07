// src/lib/supabase/__tests__/personalOkrStore.test.ts
//
// 【設計意図】
// personalOkrStore.ts の低レベルCRUDの回帰テスト。store.test.ts と同じ
// Supabaseクライアントモック方式（.from()呼び出しを記録し、キューした結果を返す）を
// order()/delete()にも対応させて拡張した。
//
// 特に重要なのは「null を送るケース（undefinedにしていないこと）」の検証：
// self_rating/band_override 等の「一度入れた値を後から消せる」列を null でクリアする
// 操作が、実際に payload の中で null のまま（undefinedに落ちていない）であることを
// JSON.stringify の往復まで含めて確認する（CLAUDE.md：postgrest-jsはundefinedキーを
// JSON.stringifyで消してしまうため、UPDATE対象から列が抜け落ちる無反応バグの実例がある）。

import { describe, it, expect, vi, beforeEach } from "vitest";

// ===== Supabase クライアントモック（store.test.ts を order()/delete() 対応に拡張） =====

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
};

function queueResult(table: string, op: MockCall["op"], result: MockResult) {
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
  function makeBuilder(table: string, op: MockCall["op"], payload?: unknown) {
    const call: MockCall = { table, op, payload, filters: [] };
    mockState.calls.push(call);

    const builder: Record<string, unknown> = {};
    builder.eq = (...args: unknown[]) => {
      call.filters.push({ method: "eq", args });
      return builder;
    };
    builder.order = (...args: unknown[]) => {
      call.filters.push({ method: "order", args });
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
      delete: () => makeBuilder(table, "delete"),
    }),
  };
  return { supabase, isMisconfigured: false };
});

// モック後に SUT を import
import {
  fetchPersonalKrs, upsertPersonalKr, softDeletePersonalKr,
  fetchPersonalKrMonths, upsertPersonalKrMonth,
  fetchPersonalKrWeeks, upsertPersonalKrWeek,
  fetchPersonalKrWeekTasks, insertPersonalKrWeekTask, deletePersonalKrWeekTask,
  fetchPersonalKrMemos,
} from "../personalOkrStore";
import type { PersonalKr, PersonalKrMonth, PersonalKrWeek, PersonalKrMemo } from "../../localData/types";

beforeEach(() => {
  resetMock();
});

function makeKr(over: Partial<PersonalKr> = {}): PersonalKr {
  return {
    id: "pkr-1",
    member_id: "m1",
    group_id: "grp-egg",
    fiscal_year: 2026,
    quarter: "3Q",
    kr_kind: "group_kr",
    label: "エース（AAS）",
    weight_pct: 30,
    display_order: 0,
    is_deleted: false,
    ...over,
  };
}

function makeMonth(over: Partial<PersonalKrMonth> = {}): PersonalKrMonth {
  return {
    id: "pm-1",
    personal_kr_id: "pkr-1",
    month: "2026-08-01",
    month_index: 1,
    is_deleted: false,
    ...over,
  };
}

function makeWeek(over: Partial<PersonalKrWeek> = {}): PersonalKrWeek {
  return {
    id: "pw-1",
    personal_kr_id: "pkr-1",
    month: "2026-08-01",
    week_index: 1,
    week_start: "2026-08-01",
    week_end: "2026-08-02",
    self_rating: null,
    is_deleted: false,
    ...over,
  };
}

function makeMemo(over: Partial<PersonalKrMemo> = {}): PersonalKrMemo {
  return {
    id: "memo-1",
    personal_kr_id: "pkr-1",
    member_id: "m1",
    body: "今週のメモ",
    is_deleted: false,
    ...over,
  };
}

describe("fetch系：is_deleted=falseで絞り込み、配列を返す", () => {
  it("fetchPersonalKrs", async () => {
    queueResult("personal_krs", "select", { data: [makeKr()], error: null });
    const rows = await fetchPersonalKrs();
    expect(rows).toHaveLength(1);
    const call = mockState.calls.find(c => c.table === "personal_krs" && c.op === "select");
    expect(call?.filters).toContainEqual({ method: "eq", args: ["is_deleted", false] });
  });

  it("fetchPersonalKrMonths：personal_kr_idで絞り込む", async () => {
    queueResult("personal_kr_months", "select", { data: [makeMonth()], error: null });
    const rows = await fetchPersonalKrMonths("pkr-1");
    expect(rows).toHaveLength(1);
    const call = mockState.calls.find(c => c.table === "personal_kr_months" && c.op === "select");
    expect(call?.filters).toContainEqual({ method: "eq", args: ["personal_kr_id", "pkr-1"] });
  });

  it("fetchPersonalKrWeeks：month→week_indexの順でorderする", async () => {
    queueResult("personal_kr_weeks", "select", { data: [makeWeek()], error: null });
    const rows = await fetchPersonalKrWeeks("pkr-1");
    expect(rows).toHaveLength(1);
    const call = mockState.calls.find(c => c.table === "personal_kr_weeks" && c.op === "select");
    const orderCalls = call?.filters.filter(f => f.method === "order");
    expect(orderCalls).toEqual([
      { method: "order", args: ["month", { ascending: true }] },
      { method: "order", args: ["week_index", { ascending: true }] },
    ]);
  });

  it("fetchPersonalKrWeekTasks：week_idで絞り込む", async () => {
    queueResult("personal_kr_week_tasks", "select", { data: [{ week_id: "pw-1", task_id: "t1" }], error: null });
    const rows = await fetchPersonalKrWeekTasks("pw-1");
    expect(rows).toEqual([{ week_id: "pw-1", task_id: "t1" }]);
  });

  it("fetchPersonalKrMemos：作成日時の降順でorderする", async () => {
    queueResult("personal_kr_memos", "select", { data: [makeMemo()], error: null });
    await fetchPersonalKrMemos("pkr-1");
    const call = mockState.calls.find(c => c.table === "personal_kr_memos" && c.op === "select");
    expect(call?.filters).toContainEqual({ method: "order", args: ["created_at", { ascending: false }] });
  });

  it("fetchで error があれば throw する", async () => {
    queueResult("personal_krs", "select", { data: null, error: { message: "boom" } });
    await expect(fetchPersonalKrs()).rejects.toBeTruthy();
  });
});

describe("null を送るケース（undefined にしていないこと）", () => {
  it("週の自己評価をクリアする保存では self_rating に null を送る", async () => {
    queueResult("personal_kr_weeks", "select", { data: null, error: null }); // saveWithLock: 新規行
    queueResult("personal_kr_weeks", "insert", { data: { updated_at: "2026-08-07T00:00:00.000Z" }, error: null });

    await upsertPersonalKrWeek(makeWeek({ self_rating: null }));

    const insertCall = mockState.calls.find(c => c.table === "personal_kr_weeks" && c.op === "insert");
    expect(insertCall).toBeDefined();
    const payload = insertCall!.payload as Record<string, unknown>;
    expect("self_rating" in payload).toBe(true);
    expect(payload.self_rating).toBeNull();
    // JSON.stringify で undefined キーは消えるが、null は残ることを実際に確認する
    expect(JSON.parse(JSON.stringify(payload)).self_rating).toBeNull();
  });

  it("月次計画の人による決定（band_override）を解除する保存では null を送る", async () => {
    queueResult("personal_kr_months", "select", { data: null, error: null });
    queueResult("personal_kr_months", "insert", { data: { updated_at: "2026-08-07T00:00:00.000Z" }, error: null });

    await upsertPersonalKrMonth(makeMonth({ band_override: null, band_override_by: null, band_override_at: null }));

    const insertCall = mockState.calls.find(c => c.table === "personal_kr_months" && c.op === "insert");
    const payload = insertCall!.payload as Record<string, unknown>;
    expect(payload.band_override).toBeNull();
    expect(payload.band_override_by).toBeNull();
    expect(payload.band_override_at).toBeNull();
    const roundTripped = JSON.parse(JSON.stringify(payload));
    expect(roundTripped.band_override).toBeNull();
    expect(roundTripped.band_override_by).toBeNull();
    expect(roundTripped.band_override_at).toBeNull();
  });

  it("比較：undefinedにしてしまうとJSON.stringifyでキーごと消える（このバグパターンの実演）", () => {
    const bad = { self_rating: undefined as string | null | undefined };
    const roundTripped = JSON.parse(JSON.stringify(bad));
    expect("self_rating" in roundTripped).toBe(false); // ← これが「解除が反映されない」バグの正体
  });
});

describe("upsert・softDelete：saveWithLock/updateを正しく呼ぶ", () => {
  it("upsertPersonalKr：新規行はinsertされる", async () => {
    queueResult("personal_krs", "select", { data: null, error: null });
    queueResult("personal_krs", "insert", { data: { updated_at: "2026-08-07T00:00:00.000Z" }, error: null });
    const newUpdatedAt = await upsertPersonalKr(makeKr());
    expect(newUpdatedAt).toBe("2026-08-07T00:00:00.000Z");
  });

  it("softDeletePersonalKr：is_deleted/deleted_at/deleted_byをupdateする", async () => {
    queueResult("personal_krs", "update", { data: null, error: null });
    await softDeletePersonalKr("pkr-1", "m1");
    const call = mockState.calls.find(c => c.table === "personal_krs" && c.op === "update");
    const payload = call!.payload as Record<string, unknown>;
    expect(payload.is_deleted).toBe(true);
    expect(payload.deleted_by).toBe("m1");
    expect(payload.deleted_at).toBeTruthy();
    expect(call!.filters).toContainEqual({ method: "eq", args: ["id", "pkr-1"] });
  });
});

describe("personal_kr_week_tasks：物理delete/insertの中間テーブル", () => {
  it("insertPersonalKrWeekTask：そのままinsertする", async () => {
    queueResult("personal_kr_week_tasks", "insert", { data: null, error: null });
    await insertPersonalKrWeekTask({ week_id: "pw-1", task_id: "t1" });
    const call = mockState.calls.find(c => c.table === "personal_kr_week_tasks" && c.op === "insert");
    expect(call?.payload).toEqual({ week_id: "pw-1", task_id: "t1" });
  });

  it("deletePersonalKrWeekTask：week_id/task_idの複合キーで物理delete", async () => {
    queueResult("personal_kr_week_tasks", "delete", { data: null, error: null });
    await deletePersonalKrWeekTask("pw-1", "t1");
    const call = mockState.calls.find(c => c.table === "personal_kr_week_tasks" && c.op === "delete");
    expect(call?.filters).toEqual([
      { method: "eq", args: ["week_id", "pw-1"] },
      { method: "eq", args: ["task_id", "t1"] },
    ]);
  });

  it("エラー時はthrowする", async () => {
    queueResult("personal_kr_week_tasks", "delete", { data: null, error: { message: "fail" } });
    await expect(deletePersonalKrWeekTask("pw-1", "t1")).rejects.toBeTruthy();
  });
});
