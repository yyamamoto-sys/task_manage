// v3.207：親バーの移動ドラッグ（子孫も一緒にずらす）と、期限前の延長でのベースライン引き直しの統合テスト。
// モック方式は bulkShiftTasks.test.ts と同じ（Supabase クライアントをメモリ上の表で置き換える）。

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

// ===== v3.207 =====
// 要望1：親バーの移動ドラッグ＝ GanttView が expandWithDescendants→moveTargetsOf で対象を作り bulkShiftTasks へ渡す。
// 要望2：期限前の延長でベースラインを引き直す（saveTask 内の resolveBaselineOnSave）。Undo で戻る。

import { expandWithDescendants, moveTargetsOf } from "../../components/gantt/ganttUtils";
import { afterEach } from "vitest";

afterEach(() => {
  vi.useRealTimers();
});

function useToday(ymd: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${ymd}T09:00:00`));
}

async function captureUndo(run: () => Promise<void>): Promise<{ message?: string; undo?: () => void }> {
  const mod = await import("../../components/common/Toast");
  let message: string | undefined;
  let undo: (() => void) | undefined;
  const spy = vi.spyOn(mod, "showToast").mockImplementation((msg, _type, action) => {
    message = msg;
    if (action) undo = action.onClick;
  });
  await run();
  spy.mockRestore();
  return { message, undo };
}

const flush = () => new Promise(r => setTimeout(r, 0));

describe("v3.207 親バーの移動ドラッグ：子孫も一緒にずらす", () => {
  it("未完了の子孫は全部ずれ、完了・中止・期日未設定は動かず、外の後続は自動ずらしで1回だけ押される。Undo1回で全部戻る", async () => {
    useToday("2026-07-01");
    const p = makeTask({ id: "P", start_date: "2026-08-01", due_date: "2026-08-20" });
    const c1 = makeTask({ id: "C1", parent_task_id: "P", start_date: "2026-08-01", due_date: "2026-08-05" });
    const c2 = makeTask({ id: "C2", parent_task_id: "P", start_date: "2026-08-06", due_date: "2026-08-10" });
    const gc = makeTask({ id: "GC", parent_task_id: "C2", start_date: "2026-08-06", due_date: "2026-08-08" });
    const done = makeTask({ id: "D", parent_task_id: "P", status: "done", start_date: "2026-08-01", due_date: "2026-08-03" });
    const cancelled = makeTask({ id: "X", parent_task_id: "P", status: "cancelled", start_date: "2026-08-01", due_date: "2026-08-03" });
    const noDate = makeTask({ id: "N", parent_task_id: "P" });
    const outside = makeTask({ id: "O", start_date: "2026-08-11", due_date: "2026-08-12" });
    const all = [p, c1, c2, gc, done, cancelled, noDate, outside];
    for (const t of all) seed("tasks", t as unknown as Row);
    useAppStore.setState({
      tasks: all,
      taskDependencies: [
        makeDep({ predecessor_task_id: "C1", successor_task_id: "C2" }), // 子孫の中の依存＝一緒に動くので押されない
        makeDep({ predecessor_task_id: "C2", successor_task_id: "O" }), // 子孫の外の後続
      ],
    });

    const ids = expandWithDescendants(["P"], useAppStore.getState().tasks);
    const targets = moveTargetsOf(ids, new Map(useAppStore.getState().tasks.map(t => [t.id, t])));
    expect(targets.map(t => t.taskId).sort()).toEqual(["C1", "C2", "GC", "P"]);

    const { message, undo } = await captureUndo(() =>
      useAppStore.getState().bulkShiftTasks(targets.map(t => t.taskId), 3, "member-1"));

    const s = useAppStore.getState().tasks;
    const get = (id: string) => s.find(t => t.id === id)!;
    expect(get("P")).toMatchObject({ start_date: "2026-08-04", due_date: "2026-08-23" });
    expect(get("C1")).toMatchObject({ start_date: "2026-08-04", due_date: "2026-08-08" });
    expect(get("C2")).toMatchObject({ start_date: "2026-08-09", due_date: "2026-08-13" });
    expect(get("GC")).toMatchObject({ start_date: "2026-08-09", due_date: "2026-08-11" });
    expect(get("D")).toMatchObject({ start_date: "2026-08-01", due_date: "2026-08-03" });
    expect(get("X")).toMatchObject({ start_date: "2026-08-01", due_date: "2026-08-03" });
    expect(get("N")).toMatchObject({ start_date: null, due_date: null });
    // O は C2 の新期日 8/13 より後ろへ。押す量は C2 との食い違い分だけ（二重にずれない）
    expect(get("O")).toMatchObject({ start_date: "2026-08-13", due_date: "2026-08-14" });
    expect(message).toBe("4件のタスクを移動しました（＋自動調整1件）");

    undo!();
    await flush();
    const r = useAppStore.getState().tasks;
    for (const orig of all) {
      expect(r.find(t => t.id === orig.id)).toMatchObject({ start_date: orig.start_date, due_date: orig.due_date });
    }
  });

  it("選択中の親と子をまとめてドラッグしても、子は1回分だけずれる（二重適用しない）", async () => {
    const p = makeTask({ id: "P", start_date: "2026-08-01", due_date: "2026-08-20" });
    const c = makeTask({ id: "C", parent_task_id: "P", start_date: "2026-08-01", due_date: "2026-08-05" });
    seed("tasks", p as unknown as Row);
    seed("tasks", c as unknown as Row);
    useAppStore.setState({ tasks: [p, c], taskDependencies: [] });

    const ids = expandWithDescendants(["P", "C"], useAppStore.getState().tasks);
    expect(ids).toEqual(["P", "C"]);
    await captureUndo(() => useAppStore.getState().bulkShiftTasks(ids, 2, "member-1"));
    expect(useAppStore.getState().tasks.find(t => t.id === "C")).toMatchObject({ start_date: "2026-08-03", due_date: "2026-08-07" });
  });
});

describe("v3.207 期限前の延長は計画変更扱い（ベースラインを引き直す）", () => {
  function frozen(overrides: Partial<Task> & { id: string }): Task {
    return makeTask({
      start_date: "2026-08-01", due_date: "2026-08-10",
      baseline_start_date: "2026-08-01", baseline_due_date: "2026-08-10",
      ...overrides,
    });
  }

  it("更新前の期日が今日と同じ日（まだ期限切れでない）なら、延長でベースラインが新しい日付に揃い、Undo で元に戻る", async () => {
    useToday("2026-08-10");
    const a = frozen({ id: "A" });
    seed("tasks", a as unknown as Row);
    useAppStore.setState({ tasks: [a], taskDependencies: [] });

    const { undo } = await captureUndo(() => useAppStore.getState().bulkShiftTasks(["A"], 5, "member-1"));
    const moved = useAppStore.getState().tasks.find(t => t.id === "A")!;
    expect(moved).toMatchObject({
      start_date: "2026-08-06", due_date: "2026-08-15",
      baseline_start_date: "2026-08-06", baseline_due_date: "2026-08-15",
    });
    expect(table("tasks").get("A")?.baseline_due_date).toBe("2026-08-15");

    undo!();
    await flush();
    expect(useAppStore.getState().tasks.find(t => t.id === "A")).toMatchObject({
      start_date: "2026-08-01", due_date: "2026-08-10",
      baseline_start_date: "2026-08-01", baseline_due_date: "2026-08-10",
    });
    expect(table("tasks").get("A")?.baseline_due_date).toBe("2026-08-10");
  });

  it("期限切れ後の延長ではベースラインを変えない（遅延が出る）", async () => {
    useToday("2026-08-11");
    const a = frozen({ id: "A" });
    seed("tasks", a as unknown as Row);
    useAppStore.setState({ tasks: [a], taskDependencies: [] });
    await useAppStore.getState().saveTask({ ...a, due_date: "2026-08-15" });
    expect(useAppStore.getState().tasks.find(t => t.id === "A")).toMatchObject({
      due_date: "2026-08-15", baseline_start_date: "2026-08-01", baseline_due_date: "2026-08-10",
    });
  });

  it("前倒し・期日以外の変更ではベースラインを変えない", async () => {
    useToday("2026-07-01");
    const a = frozen({ id: "A" });
    seed("tasks", a as unknown as Row);
    useAppStore.setState({ tasks: [a], taskDependencies: [] });
    await useAppStore.getState().saveTask({ ...a, due_date: "2026-08-08" });
    await useAppStore.getState().saveTask({ ...useAppStore.getState().tasks[0], name: "改名", start_date: "2026-08-03" });
    expect(useAppStore.getState().tasks[0]).toMatchObject({ baseline_start_date: "2026-08-01", baseline_due_date: "2026-08-10" });
  });

  it("ベースライン未凍結（null）のタスクは従来どおり（両日付が揃った時点の値で凍結）", async () => {
    useToday("2026-07-01");
    const a = makeTask({ id: "A", due_date: "2026-08-10" });
    seed("tasks", a as unknown as Row);
    useAppStore.setState({ tasks: [a], taskDependencies: [] });
    await useAppStore.getState().saveTask({ ...a, due_date: "2026-08-20" });
    expect(useAppStore.getState().tasks[0]).toMatchObject({ baseline_start_date: null, baseline_due_date: null });
  });

  it("依存の自動ずらしで押された後続も、期限前ならベースラインが追従し、Undo で戻る", async () => {
    useToday("2026-07-01");
    const a = frozen({ id: "A" });
    const b = frozen({ id: "B", start_date: "2026-08-11", due_date: "2026-08-12", baseline_start_date: "2026-08-11", baseline_due_date: "2026-08-12" });
    seed("tasks", a as unknown as Row);
    seed("tasks", b as unknown as Row);
    useAppStore.setState({ tasks: [a, b], taskDependencies: [makeDep({ predecessor_task_id: "A", successor_task_id: "B" })] });

    const { undo } = await captureUndo(() => useAppStore.getState().saveTask({ ...a, due_date: "2026-08-14" }));
    const pushed = useAppStore.getState().tasks.find(t => t.id === "B")!;
    expect((pushed.due_date ?? "") > "2026-08-12").toBe(true);
    expect(pushed.baseline_due_date).toBe(pushed.due_date);

    undo!();
    await flush();
    expect(useAppStore.getState().tasks.find(t => t.id === "B")).toMatchObject({
      start_date: "2026-08-11", due_date: "2026-08-12", baseline_start_date: "2026-08-11", baseline_due_date: "2026-08-12",
    });
  });
});
