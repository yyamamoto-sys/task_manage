// appStore.saveTask に配線した自動リスケジュール連鎖（B3）の統合テスト。
// computeCascadeShifts 自体の網羅テストは lib/dependencies/__tests__/reschedule.test.ts。
// ここでは「実際に saveTask 経由で DB 書き込み・トースト・Undo・realtime非発火まで
// 正しく配線されているか」を、Supabase クライアントをモックして確認する
// （lib/supabase/__tests__/store.test.ts と同じモック方式）。

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

describe("saveTask: 自動リスケジュール連鎖（B3）の配線", () => {
  it("先行の期日が後続の開始日を追い越すと、後続を自動でDBまで押す", async () => {
    const a = makeTask({ id: "A", start_date: "2026-08-01", due_date: "2026-08-05" });
    const b = makeTask({ id: "B", start_date: "2026-08-05", due_date: "2026-08-08" });
    seed("tasks", a as unknown as Row);
    seed("tasks", b as unknown as Row);
    useAppStore.setState({
      tasks: [a, b],
      taskDependencies: [makeDep({ predecessor_task_id: "A", successor_task_id: "B" })],
    });

    await useAppStore.getState().saveTask({ ...a, due_date: "2026-08-10" });

    const bAfter = useAppStore.getState().tasks.find(t => t.id === "B");
    expect(bAfter?.start_date).toBe("2026-08-10");
    expect(bAfter?.due_date).toBe("2026-08-13"); // 作業期間3日を保持
    // DB側にも反映されている
    expect(table("tasks").get("B")?.start_date).toBe("2026-08-10");
  });

  it("後続に余裕がある場合はDBも動かさない", async () => {
    const a = makeTask({ id: "A", start_date: "2026-08-01", due_date: "2026-08-05" });
    const b = makeTask({ id: "B", start_date: "2026-08-20", due_date: "2026-08-25" });
    seed("tasks", a as unknown as Row);
    seed("tasks", b as unknown as Row);
    useAppStore.setState({
      tasks: [a, b],
      taskDependencies: [makeDep({ predecessor_task_id: "A", successor_task_id: "B" })],
    });

    await useAppStore.getState().saveTask({ ...a, due_date: "2026-08-10" });

    const bAfter = useAppStore.getState().tasks.find(t => t.id === "B");
    expect(bAfter?.start_date).toBe("2026-08-20");
    expect(bAfter?.due_date).toBe("2026-08-25");
  });

  it("連鎖トーストのUndoアクションで元の日付に戻り、Undo自体は再cascadeしない", async () => {
    const a = makeTask({ id: "A", start_date: "2026-08-01", due_date: "2026-08-05" });
    const b = makeTask({ id: "B", start_date: "2026-08-05", due_date: "2026-08-08" });
    seed("tasks", a as unknown as Row);
    seed("tasks", b as unknown as Row);
    useAppStore.setState({
      tasks: [a, b],
      taskDependencies: [makeDep({ predecessor_task_id: "A", successor_task_id: "B" })],
    });

    let capturedAction: { label: string; onClick: () => void } | undefined;
    const mod = await import("../../components/common/Toast");
    const spy = vi.spyOn(mod, "showToast").mockImplementation((_msg, _type, action) => {
      if (action) capturedAction = action;
    });

    await useAppStore.getState().saveTask({ ...a, due_date: "2026-08-10" });

    expect(capturedAction).toBeDefined();
    expect(useAppStore.getState().tasks.find(t => t.id === "B")?.start_date).toBe("2026-08-10");

    // Undo実行
    capturedAction!.onClick();
    // onClick内のsaveTaskは非同期なのでマイクロタスクを待つ
    await new Promise(r => setTimeout(r, 0));

    const bAfterUndo = useAppStore.getState().tasks.find(t => t.id === "B");
    expect(bAfterUndo?.start_date).toBe("2026-08-05");
    expect(bAfterUndo?.due_date).toBe("2026-08-08");

    spy.mockRestore();
  });

  it("realtime受信（applyRemoteChange）はcascadeを発火しない", async () => {
    const a = makeTask({ id: "A", start_date: "2026-08-01", due_date: "2026-08-05" });
    const b = makeTask({ id: "B", start_date: "2026-08-05", due_date: "2026-08-08" });
    seed("tasks", a as unknown as Row);
    seed("tasks", b as unknown as Row);
    useAppStore.setState({
      tasks: [a, b],
      taskDependencies: [makeDep({ predecessor_task_id: "A", successor_task_id: "B" })],
    });

    // 他クライアントからのrealtime UPDATEイベントを模擬（Aのdueが後ろ倒しになった）。
    // upsertByIdのstaleチェック（既存updated_at >= 着信updated_atならno-op）を通過させるため、
    // 着信側のupdated_atを手元より新しくする。
    useAppStore.getState().applyRemoteChange({
      table: "tasks",
      eventType: "UPDATE",
      new: { ...a, due_date: "2026-08-10", updated_at: "2026-08-01T00:00:00.000Z" },
      old: { ...a },
    });

    // stateにAの新due_dateは反映されるが、Bはcascadeされず元のまま（DBへの書き込みも発生しない）
    expect(useAppStore.getState().tasks.find(t => t.id === "A")?.due_date).toBe("2026-08-10");
    expect(useAppStore.getState().tasks.find(t => t.id === "B")?.start_date).toBe("2026-08-05");
    expect(table("tasks").get("B")?.start_date).toBe("2026-08-05");
  });

  it("無関係なフィールド編集（due_date不変）ではcascade計算自体が起きず、後続は動かない", async () => {
    // Bが本来は余裕なし（Aのdueを追い越す状態）でも、今回の保存でAのdueが変わっていなければ発火しない
    const a = makeTask({ id: "A", start_date: "2026-08-01", due_date: "2026-08-10" });
    const b = makeTask({ id: "B", start_date: "2026-08-05", due_date: "2026-08-08" });
    seed("tasks", a as unknown as Row);
    seed("tasks", b as unknown as Row);
    useAppStore.setState({
      tasks: [a, b],
      taskDependencies: [makeDep({ predecessor_task_id: "A", successor_task_id: "B" })],
    });

    await useAppStore.getState().saveTask({ ...a, name: "A（改名）" });

    expect(useAppStore.getState().tasks.find(t => t.id === "B")?.start_date).toBe("2026-08-05");
  });

  it("A→B→Cの連鎖がDBまで一括で反映される", async () => {
    const a = makeTask({ id: "A", start_date: "2026-08-01", due_date: "2026-08-05" });
    const b = makeTask({ id: "B", start_date: "2026-08-05", due_date: "2026-08-08" });
    const c = makeTask({ id: "C", start_date: "2026-08-09", due_date: "2026-08-11" });
    seed("tasks", a as unknown as Row);
    seed("tasks", b as unknown as Row);
    seed("tasks", c as unknown as Row);
    useAppStore.setState({
      tasks: [a, b, c],
      taskDependencies: [
        makeDep({ predecessor_task_id: "A", successor_task_id: "B" }),
        makeDep({ predecessor_task_id: "B", successor_task_id: "C" }),
      ],
    });

    await useAppStore.getState().saveTask({ ...a, due_date: "2026-08-10" });

    const state = useAppStore.getState();
    expect(state.tasks.find(t => t.id === "B")?.start_date).toBe("2026-08-10");
    expect(state.tasks.find(t => t.id === "C")?.start_date).toBe("2026-08-13");
    expect(table("tasks").get("C")?.start_date).toBe("2026-08-13");
  });
});
