import { describe, it, expect, vi, beforeEach } from "vitest";
import { planDoneToggle, toggleTaskDone, type ToggleDoneDeps } from "../toggleDone";
import { showToast } from "../../../components/common/Toast";
import { consumeLastUndoAction, clearLastUndoAction } from "../../lastUndoStore";
import type { Task } from "../../localData/types";

const mk = (over: Partial<Task>): Task => ({
  id: "t1", name: "資料作成", status: "todo", is_deleted: false, parent_task_id: null,
  updated_by: "u0",
  ...over,
} as unknown as Task);

describe("planDoneToggle", () => {
  it("未完了→完了、完了→未完了(todo)", () => {
    expect(planDoneToggle(mk({ status: "in_progress" }), false)).toEqual({ kind: "set", from: "in_progress", to: "done" });
    expect(planDoneToggle(mk({ status: "on_hold" }), false)).toEqual({ kind: "set", from: "on_hold", to: "done" });
    expect(planDoneToggle(mk({ status: "done" }), false)).toEqual({ kind: "set", from: "done", to: "todo" });
  });
  it("子タスクを持つ親・中止・削除済み・存在しないタスクは切り替えない", () => {
    expect(planDoneToggle(mk({}), true)).toEqual({ kind: "parent" });
    expect(planDoneToggle(mk({ status: "cancelled" }), false)).toEqual({ kind: "skip" });
    expect(planDoneToggle(mk({ is_deleted: true }), false)).toEqual({ kind: "skip" });
    expect(planDoneToggle(undefined, false)).toEqual({ kind: "skip" });
  });
});

describe("toggleTaskDone（既存のsaveTask経路＋Undoトースト）", () => {
  let tasks: Task[];
  let saveTask: ReturnType<typeof vi.fn>;
  let toast: ReturnType<typeof vi.fn>;
  const deps = (): ToggleDoneDeps => ({
    getTasks: () => tasks,
    saveTask: saveTask as unknown as ToggleDoneDeps["saveTask"],
    showToast: toast as unknown as ToggleDoneDeps["showToast"],
    userId: "me",
  });
  beforeEach(() => {
    tasks = [mk({ id: "t1" }), mk({ id: "p1", name: "親" }), mk({ id: "c1", parent_task_id: "p1" })];
    saveTask = vi.fn(async () => undefined);
    toast = vi.fn();
  });

  it("saveTask経由で完了にし、必ず isUndo:true のトーストを出す", async () => {
    await toggleTaskDone("t1", deps());
    expect(saveTask).toHaveBeenCalledWith(expect.objectContaining({ id: "t1", status: "done", updated_by: "me" }));
    const action = toast.mock.calls[0][2];
    expect(action.isUndo).toBe(true);
    expect(action.label).toBe("元に戻す");
  });

  it("Undoを実行すると、最新のタスクに元のステータスだけ当て直す", async () => {
    tasks[0] = mk({ id: "t1", status: "in_progress" });
    await toggleTaskDone("t1", deps());
    // その後、他者が名前を変えた最新状態
    tasks = [mk({ id: "t1", name: "改名後", status: "done" }), ...tasks.slice(1)];
    toast.mock.calls[0][2].onClick();
    expect(saveTask).toHaveBeenLastCalledWith(expect.objectContaining({ id: "t1", name: "改名後", status: "in_progress" }));
  });

  it("子タスクを持つ親は保存せず案内トーストだけ（Undo対象にしない）", async () => {
    await toggleTaskDone("p1", deps());
    expect(saveTask).not.toHaveBeenCalled();
    expect(toast.mock.calls[0][1]).toBe("info");
    expect(toast.mock.calls[0][2]).toBeUndefined();
  });

  it("存在しないタスクは何もしない", async () => {
    await toggleTaskDone("zzz", deps());
    expect(saveTask).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it("保存に失敗したらエラートーストを出し、Undoは登録しない", async () => {
    saveTask.mockRejectedValueOnce(new Error("x"));
    await toggleTaskDone("t1", deps());
    expect(toast.mock.calls[0][1]).toBe("error");
    expect(toast.mock.calls[0][2]).toBeUndefined();
  });
});

describe("実際の showToast に渡すと Ctrl+Z 用の lastUndoStore に登録される", () => {
  beforeEach(() => clearLastUndoAction());
  it("Undoトースト＝Ctrl+Zで戻せる", async () => {
    const tasks = [mk({ id: "t1" })];
    const saveTask = vi.fn(async () => undefined);
    await toggleTaskDone("t1", {
      getTasks: () => tasks, saveTask, showToast, userId: "me",
    });
    const undo = consumeLastUndoAction();
    expect(undo).not.toBeNull();
    undo!();
    expect(saveTask).toHaveBeenLastCalledWith(expect.objectContaining({ id: "t1", status: "todo" }));
  });
});
