import { describe, expect, it, vi, beforeEach } from "vitest";

const { showToast, saveTask, restoreTask, state } = vi.hoisted(() => {
  const saveTask = vi.fn();
  const restoreTask = vi.fn();
  const state = { tasks: [] as Array<Record<string, unknown>> };
  return { showToast: vi.fn(), saveTask, restoreTask, state };
});

vi.mock("react", () => ({ useCallback: (f: unknown) => f }));
vi.mock("../../../components/common/Toast", () => ({ showToast }));
vi.mock("../../dialog", () => ({ confirmDialog: vi.fn(async () => true) }));
vi.mock("../../../stores/appStore", () => {
  const useAppStore = Object.assign(
    (sel: (s: unknown) => unknown) => sel({ saveTask, deleteTask: vi.fn(async () => {}), restoreTask, bulkShiftTasks: vi.fn() }),
    { getState: () => ({ tasks: state.tasks, saveTask, restoreTask }) },
  );
  return { useAppStore };
});

import { useBulkTaskActions } from "../../../hooks/useBulkTaskActions";
import { settleSaves, settleSingleSave } from "../settleSaves";

const task = (id: string) => ({ id, status: "todo", priority: null, assignee_member_id: null, assignee_member_ids: [], project_id: "p", section_id: null, parent_task_id: null, display_order: 0 });

const unhandled: unknown[] = [];
const onUnhandled = (e: unknown) => { unhandled.push(e); };

beforeEach(() => {
  vi.clearAllMocks();
  unhandled.length = 0;
  state.tasks = [task("a"), task("b"), task("c")];
  process.on("unhandledRejection", onUnhandled);
});

const tick = () => new Promise(r => setTimeout(r, 20));

describe("settleSaves", () => {
  it("失敗が混ざっても例外を伝えず、件数を返す", async () => {
    const failed = await settleSaves([Promise.resolve(), Promise.reject(new Error("x")), Promise.reject(new Error("y"))]);
    expect(failed).toBe(2);
    expect(showToast).not.toHaveBeenCalled();
  });
  it("failureMessage があれば失敗時に1回だけ知らせる", async () => {
    await settleSaves([Promise.reject(new Error("x")), Promise.reject(new Error("y"))], n => `${n}件失敗`);
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith("2件失敗", "error");
  });
  it("settleSingleSave は拒否を握り、トーストも足さない", async () => {
    await expect(settleSingleSave(Promise.reject(new Error("x")))).resolves.toBeUndefined();
    expect(showToast).not.toHaveBeenCalled();
  });
});

describe("一括ステータス変更の元に戻す", () => {
  it("巻き戻しが2件失敗しても未処理の拒否を残さず、「2件は元に戻せませんでした」を1回だけ出す", async () => {
    saveTask.mockResolvedValue(undefined);
    const ids = new Set(["a", "b", "c"]);
    const { bulkUpdateStatus } = useBulkTaskActions(state.tasks as never, [], ids, "u", () => {});
    await bulkUpdateStatus("done");
    const undo = showToast.mock.calls[0][2].onClick as () => void;
    showToast.mockClear();
    saveTask.mockImplementation(async (t: { id: string }) => { if (t.id !== "a") throw new Error("fail"); });
    undo();
    await tick();
    expect(unhandled).toHaveLength(0);
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith("2件は元に戻せませんでした", "error");
    process.off("unhandledRejection", onUnhandled);
  });

  it("全件成功なら失敗のトーストは出ない", async () => {
    saveTask.mockResolvedValue(undefined);
    const { bulkUpdateStatus } = useBulkTaskActions(state.tasks as never, [], new Set(["a"]), "u", () => {});
    await bulkUpdateStatus("done");
    const undo = showToast.mock.calls[0][2].onClick as () => void;
    showToast.mockClear();
    undo();
    await tick();
    expect(showToast).not.toHaveBeenCalled();
    process.off("unhandledRejection", onUnhandled);
  });
});
