// appStore.bulkShiftTasks（ガント複数選択の一括シフト）の統合テスト。
// computeBulkMoveShifts / computeCascadeShiftsMulti 自体の網羅テストは
// components/gantt/__tests__/ganttUtils.test.ts / lib/dependencies/__tests__/reschedule.test.ts。
// ここでは「実際に saveTask 経由で DB 書き込み・カスケード合成・トースト・Undoまで
// 正しく配線されているか」を、Supabase クライアントをモックして確認する
// （stores/__tests__/cascadeReschedule.test.ts と同じモック方式）。

import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, unknown> & { id: string };

const db = {
  tables: new Map<string, Map<string, Row>>(),
};

function table(name: string): Map<string, Row> {
  if (!db.tables.has(name)) db.tables.set(name, new Map());
  return db.tables.get(name)!;
}

function seed(tableName: string, row: Row) {
  table(tableName).set(row.id, { ...row });
}

function resetDb() {
  db.tables.clear();
}

vi.mock("../../lib/supabase/client", () => {
  function selectBuilder(tableName: string) {
    const filters: Array<{ field: string; value: unknown }> = [];
    const builder = {
      eq(field: string, value: unknown) {
        filters.push({ field, value });
        return builder;
      },
      maybeSingle() {
        const match = [...table(tableName).values()].find(r =>
          filters.every(f => r[f.field] === f.value),
        );
        return Promise.resolve({ data: match ?? null, error: null });
      },
      single() {
        const match = [...table(tableName).values()].find(r =>
          filters.every(f => r[f.field] === f.value),
        );
        return Promise.resolve({ data: match ?? null, error: null });
      },
      then(onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) {
        const rows = [...table(tableName).values()].filter(r =>
          filters.every(f => r[f.field] === f.value),
        );
        return Promise.resolve({ data: rows, error: null }).then(onF, onR);
      },
    };
    return builder;
  }

  function updateBuilder(tableName: string, payload: Record<string, unknown>) {
    const filters: Array<{ field: string; value: unknown }> = [];
    const builder = {
      eq(field: string, value: unknown) {
        filters.push({ field, value });
        return builder;
      },
      select() {
        const t = table(tableName);
        const matches = [...t.values()].filter(r => filters.every(f => r[f.field] === f.value));
        const updated = matches.map(r => {
          const merged = { ...r, ...payload };
          t.set(r.id, merged);
          return merged;
        });
        return {
          single() {
            return Promise.resolve({ data: updated[0] ?? null, error: null });
          },
          then(onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) {
            return Promise.resolve({ data: updated, error: null }).then(onF, onR);
          },
        };
      },
    };
    return builder;
  }

  const supabase = {
    from(tableName: string) {
      return {
        select: () => selectBuilder(tableName),
        insert: (payload: Record<string, unknown>) => {
          const row = { ...payload, id: (payload.id as string) ?? `gen-${Math.random()}` } as Row;
          table(tableName).set(row.id, row);
          return {
            select: () => ({
              single: () => Promise.resolve({ data: row, error: null }),
            }),
          };
        },
        update: (payload: Record<string, unknown>) => updateBuilder(tableName, payload),
      };
    },
  };
  return { supabase, isMisconfigured: false };
});

vi.mock("../../lib/guestMode", () => ({
  isGuestMode: () => false,
  GUEST_READONLY_MESSAGE: "guest",
}));

// モック後に SUT を import
import { useAppStore } from "../appStore";
import type { Task, TaskDependency } from "../../lib/localData/types";

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    name: "task",
    project_id: null,
    todo_ids: [],
    assignee_member_id: "",
    assignee_member_ids: [],
    status: "todo",
    priority: null,
    start_date: null,
    due_date: null,
    estimated_hours: null,
    comment: "",
    is_deleted: false,
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeDep(overrides: Partial<TaskDependency> & { predecessor_task_id: string; successor_task_id: string }): TaskDependency {
  return {
    id: `${overrides.predecessor_task_id}->${overrides.successor_task_id}`,
    is_deleted: false,
    ...overrides,
  };
}

beforeEach(() => {
  resetDb();
  useAppStore.setState({
    tasks: [],
    taskDependencies: [],
    currentGroupId: "grp-egg",
  });
});

describe("bulkShiftTasks: 複数選択の一括シフト", () => {
  it("選択中の全タスクを同じ日数だけDBまでシフトする", async () => {
    const a = makeTask({ id: "A", start_date: "2026-08-01", due_date: "2026-08-05" });
    const b = makeTask({ id: "B", start_date: "2026-08-10", due_date: "2026-08-12" });
    seed("tasks", a as unknown as Row);
    seed("tasks", b as unknown as Row);
    useAppStore.setState({ tasks: [a, b], taskDependencies: [] });

    await useAppStore.getState().bulkShiftTasks(["A", "B"], 3, "member-1");

    const state = useAppStore.getState();
    expect(state.tasks.find(t => t.id === "A")).toMatchObject({ start_date: "2026-08-04", due_date: "2026-08-08" });
    expect(state.tasks.find(t => t.id === "B")).toMatchObject({ start_date: "2026-08-13", due_date: "2026-08-15" });
    expect(table("tasks").get("A")?.start_date).toBe("2026-08-04");
    expect(table("tasks").get("B")?.start_date).toBe("2026-08-13");
  });

  it("完了(done)タスクは選択に含まれていてもシフトされない", async () => {
    const a = makeTask({ id: "A", start_date: "2026-08-01", due_date: "2026-08-05" });
    const done = makeTask({ id: "D", status: "done", start_date: "2026-08-01", due_date: "2026-08-05" });
    seed("tasks", a as unknown as Row);
    seed("tasks", done as unknown as Row);
    useAppStore.setState({ tasks: [a, done], taskDependencies: [] });

    await useAppStore.getState().bulkShiftTasks(["A", "D"], 3, "member-1");

    expect(useAppStore.getState().tasks.find(t => t.id === "A")?.due_date).toBe("2026-08-08");
    expect(useAppStore.getState().tasks.find(t => t.id === "D")?.due_date).toBe("2026-08-05"); // 不変
  });

  it("直接シフト後、B3カスケードが1回だけ計算され非選択の後続タスクも一括で押される", async () => {
    // A,Bを一括シフト。Bの後続Cは選択されていない → cascadeで押される
    const a = makeTask({ id: "A", start_date: "2026-08-01", due_date: "2026-08-05" });
    const b = makeTask({ id: "B", start_date: "2026-08-10", due_date: "2026-08-12" });
    const c = makeTask({ id: "C", start_date: "2026-08-12", due_date: "2026-08-14" });
    seed("tasks", a as unknown as Row);
    seed("tasks", b as unknown as Row);
    seed("tasks", c as unknown as Row);
    useAppStore.setState({
      tasks: [a, b, c],
      taskDependencies: [makeDep({ predecessor_task_id: "B", successor_task_id: "C" })],
    });

    await useAppStore.getState().bulkShiftTasks(["A", "B"], 3, "member-1");

    const state = useAppStore.getState();
    // B: 8/10〜8/12 → 8/13〜8/15（直接シフト）
    expect(state.tasks.find(t => t.id === "B")).toMatchObject({ start_date: "2026-08-13", due_date: "2026-08-15" });
    // C: Bの新期日(8/15) > C.start(8/12) なのでcascadeで押される。delta=diff(8/12,8/15)=3、newDue=8/14+3=8/17
    expect(state.tasks.find(t => t.id === "C")).toMatchObject({ start_date: "2026-08-15", due_date: "2026-08-17" });
    expect(table("tasks").get("C")?.start_date).toBe("2026-08-15");
  });

  it("選択された2件が互いに依存していても、origin同士の間ではcascadeで二重シフトしない", async () => {
    // A→B（両方選択・一括シフト）。Bはbulk側で既にAと同じdeltaだけ動いているので、
    // cascade計算はBを対象外にする（他originからの制約で二重に押されない）
    const a = makeTask({ id: "A", start_date: "2026-08-01", due_date: "2026-08-05" });
    const b = makeTask({ id: "B", start_date: "2026-08-05", due_date: "2026-08-08" });
    seed("tasks", a as unknown as Row);
    seed("tasks", b as unknown as Row);
    useAppStore.setState({
      tasks: [a, b],
      taskDependencies: [makeDep({ predecessor_task_id: "A", successor_task_id: "B" })],
    });

    await useAppStore.getState().bulkShiftTasks(["A", "B"], 3, "member-1");

    const state = useAppStore.getState();
    expect(state.tasks.find(t => t.id === "A")).toMatchObject({ start_date: "2026-08-04", due_date: "2026-08-08" });
    // Bは直接シフト分（+3日）のみ。cascadeによる追加シフトは発生しない
    expect(state.tasks.find(t => t.id === "B")).toMatchObject({ start_date: "2026-08-08", due_date: "2026-08-11" });
  });

  it("1つのトースト（直接件数＋自動調整件数）が表示され、Undoで直接分・カスケード分の両方が元に戻る", async () => {
    const a = makeTask({ id: "A", start_date: "2026-08-01", due_date: "2026-08-05" });
    const b = makeTask({ id: "B", start_date: "2026-08-10", due_date: "2026-08-12" });
    const c = makeTask({ id: "C", start_date: "2026-08-12", due_date: "2026-08-14" });
    seed("tasks", a as unknown as Row);
    seed("tasks", b as unknown as Row);
    seed("tasks", c as unknown as Row);
    useAppStore.setState({
      tasks: [a, b, c],
      taskDependencies: [makeDep({ predecessor_task_id: "B", successor_task_id: "C" })],
    });

    let capturedMessage: string | undefined;
    let capturedAction: { label: string; onClick: () => void } | undefined;
    const mod = await import("../../components/common/Toast");
    const spy = vi.spyOn(mod, "showToast").mockImplementation((msg, _type, action) => {
      capturedMessage = msg;
      if (action) capturedAction = action;
    });

    await useAppStore.getState().bulkShiftTasks(["A", "B"], 3, "member-1");

    expect(capturedMessage).toBe("2件のタスクを移動しました（＋自動調整1件）");
    expect(capturedAction).toBeDefined();

    capturedAction!.onClick();
    await new Promise(r => setTimeout(r, 0));

    const state = useAppStore.getState();
    expect(state.tasks.find(t => t.id === "A")).toMatchObject({ start_date: "2026-08-01", due_date: "2026-08-05" });
    expect(state.tasks.find(t => t.id === "B")).toMatchObject({ start_date: "2026-08-10", due_date: "2026-08-12" });
    expect(state.tasks.find(t => t.id === "C")).toMatchObject({ start_date: "2026-08-12", due_date: "2026-08-14" });

    spy.mockRestore();
  });

  it("deltaDays===0なら何もしない", async () => {
    const a = makeTask({ id: "A", start_date: "2026-08-01", due_date: "2026-08-05" });
    seed("tasks", a as unknown as Row);
    useAppStore.setState({ tasks: [a], taskDependencies: [] });

    await useAppStore.getState().bulkShiftTasks(["A"], 0, "member-1");

    expect(useAppStore.getState().tasks.find(t => t.id === "A")?.due_date).toBe("2026-08-05");
  });

  it("開始日が無い（期日のみ）タスクも期日だけ正しくシフトされる", async () => {
    const a = makeTask({ id: "A", start_date: null, due_date: "2026-08-05" });
    seed("tasks", a as unknown as Row);
    useAppStore.setState({ tasks: [a], taskDependencies: [] });

    await useAppStore.getState().bulkShiftTasks(["A"], 3, "member-1");

    const t = useAppStore.getState().tasks.find(x => x.id === "A");
    expect(t?.start_date).toBeFalsy();
    expect(t?.due_date).toBe("2026-08-08");
  });
});
