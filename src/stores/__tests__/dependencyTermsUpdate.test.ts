// 依存の種類・ずらし日数の更新と Undo（v3.197）。
// 低レベルCRUD（lib/supabase/store）はモックし、書き込みの内容・Undoでの復元・旧データの扱いを確かめる。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setGuestMode } from "../../lib/guestMode";
import { peekLastUndoAction, clearLastUndoAction } from "../../lib/lastUndoStore";
import type { Task, TaskDependency } from "../../lib/localData/types";

const storeMock = vi.hoisted(() => ({
  insertTaskDependency: vi.fn(),
  softDeleteTaskDependency: vi.fn(),
  updateTaskDependencyTerms: vi.fn(),
}));
vi.mock("../../lib/supabase/store", async importOriginal => ({
  ...(await importOriginal<typeof import("../../lib/supabase/store")>()),
  ...storeMock,
}));

import { useAppStore } from "../appStore";

const mkTask = (id: string): Task => ({
  id, name: id, project_id: null, todo_ids: [], assignee_member_id: "", assignee_member_ids: [],
  status: "todo", priority: null, start_date: null, due_date: null, estimated_hours: null,
  comment: "", is_deleted: false,
});
const legacyDep: TaskDependency = { id: "d1", predecessor_task_id: "A", successor_task_id: "B", is_deleted: false };

beforeEach(() => {
  vi.clearAllMocks();
  clearLastUndoAction();
  setGuestMode(false);
  useAppStore.setState({ tasks: [mkTask("A"), mkTask("B")], taskDependencies: [legacyDep], currentGroupId: "g" });
});
afterEach(() => setGuestMode(false));

describe("updateTaskDependency", () => {
  it("種類・ラグをstateとDBへ書く。列なし（旧データ）の行は FS／0 として比較される", async () => {
    await useAppStore.getState().updateTaskDependency("d1", { depType: "SS", lagDays: 2 }, "u1");
    expect(storeMock.updateTaskDependencyTerms).toHaveBeenCalledWith("d1", { dep_type: "SS", lag_days: 2 }, "u1");
    const d = useAppStore.getState().taskDependencies[0];
    expect(d).toMatchObject({ dep_type: "SS", lag_days: 2 });
  });

  it("旧データ（FS／0）と同じ値への「変更」は何も書かない", async () => {
    await useAppStore.getState().updateTaskDependency("d1", { depType: "FS", lagDays: 0 }, "u1");
    expect(storeMock.updateTaskDependencyTerms).not.toHaveBeenCalled();
  });

  it("Undo で元の種類・ラグへ戻る（DBにも書く）", async () => {
    await useAppStore.getState().updateTaskDependency("d1", { depType: "FF", lagDays: -1 }, "u1");
    const undo = peekLastUndoAction();
    expect(undo).not.toBeNull();
    undo!();
    await vi.waitFor(() => expect(storeMock.updateTaskDependencyTerms).toHaveBeenCalledTimes(2));
    expect(storeMock.updateTaskDependencyTerms).toHaveBeenLastCalledWith("d1", { dep_type: "FS", lag_days: 0 }, "u1");
    expect(useAppStore.getState().taskDependencies[0]).toMatchObject({ dep_type: "FS", lag_days: 0 });
  });

  it("ゲストはDBを呼ばずstateだけ更新する", async () => {
    setGuestMode(true);
    await useAppStore.getState().updateTaskDependency("d1", { depType: "SF", lagDays: 3 }, "__guest__");
    expect(storeMock.updateTaskDependencyTerms).not.toHaveBeenCalled();
    expect(useAppStore.getState().taskDependencies[0]).toMatchObject({ dep_type: "SF", lag_days: 3 });
  });

  it("ずらし日数は整数に正規化する", async () => {
    await useAppStore.getState().updateTaskDependency("d1", { depType: "FS", lagDays: 2.9 }, "u1");
    expect(useAppStore.getState().taskDependencies[0].lag_days).toBe(2);
  });
});

describe("addTaskDependency：種類・ラグの指定", () => {
  it("既定は FS／0、指定すれば保存される", async () => {
    useAppStore.setState({ taskDependencies: [] });
    await useAppStore.getState().addTaskDependency("A", "B", "u1", { depType: "SS", lagDays: -2 });
    expect(useAppStore.getState().taskDependencies[0]).toMatchObject({ dep_type: "SS", lag_days: -2 });
    expect(storeMock.insertTaskDependency).toHaveBeenCalledTimes(1);
  });

  it("指定なしは FS／0", async () => {
    useAppStore.setState({ taskDependencies: [] });
    await useAppStore.getState().addTaskDependency("A", "B", "u1");
    expect(useAppStore.getState().taskDependencies[0]).toMatchObject({ dep_type: "FS", lag_days: 0 });
  });

  it("循環チェックは種類に関わらず同じ（SS でも逆向きは拒否）", async () => {
    useAppStore.setState({ taskDependencies: [{ ...legacyDep, dep_type: "SS" }] });
    await expect(useAppStore.getState().addTaskDependency("B", "A", "u1", { depType: "FF" })).rejects.toThrow();
  });
});
