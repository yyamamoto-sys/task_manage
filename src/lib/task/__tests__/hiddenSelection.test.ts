import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const { showToast, saveTask, confirmDialog, state } = vi.hoisted(() => ({
  showToast: vi.fn(),
  saveTask: vi.fn(async () => {}),
  confirmDialog: vi.fn(async () => true),
  state: { tasks: [] as Array<Record<string, unknown>> },
}));

vi.mock("react", () => ({ useCallback: (f: unknown) => f }));
vi.mock("../../../components/common/Toast", () => ({ showToast }));
vi.mock("../../dialog", () => ({ confirmDialog }));
vi.mock("../../../stores/appStore", () => {
  const useAppStore = Object.assign(
    (sel: (s: unknown) => unknown) => sel({
      saveTask, deleteTask: vi.fn(async () => {}), restoreTask: vi.fn(), bulkShiftTasks: vi.fn(async () => {}),
    }),
    { getState: () => ({ tasks: state.tasks, saveTask }) },
  );
  return { useAppStore };
});

import { useBulkTaskActions } from "../../../hooks/useBulkTaskActions";
import { countHiddenTargets, hiddenIncludedNote, withHiddenNote } from "../hiddenSelection";

const task = (id: string) => ({
  id, status: "todo", priority: null, assignee_member_id: null, assignee_member_ids: [],
  project_id: "p", section_id: null, parent_task_id: null, display_order: 0,
});

beforeEach(() => {
  vi.clearAllMocks();
  confirmDialog.mockResolvedValue(true);
  state.tasks = [task("a"), task("b"), task("c")];
});

describe("countHiddenTargets / withHiddenNote（M77・M80）", () => {
  it("表示範囲に無い対象だけ数える。表示範囲が渡されなければ 0", () => {
    expect(countHiddenTargets(["a", "b", "c"], ["a"])).toBe(2);
    expect(countHiddenTargets(["a"], ["a"])).toBe(0);
    expect(countHiddenTargets(["a", "b"], undefined)).toBe(0);
  });
  it("0件なら文面を変えず、あれば注記を足す", () => {
    expect(withHiddenNote("本文", 0)).toBe("本文");
    expect(withHiddenNote("本文", 2)).toContain(hiddenIncludedNote(2));
    expect(hiddenIncludedNote(2)).toBe("うち、今は表示されていない 2 件も含みます。");
  });
});

describe("一括操作の確認（見えていない選択を含むとき）", () => {
  const useBulk = (visible: string[], selected: string[]) => useBulkTaskActions(
    state.tasks as never, [], new Set(selected), "u", () => {}, { current: visible },
  );

  it("見えない選択を含むステータス変更は、件数入りの確認を出してから実行する", async () => {
    await useBulk(["a"], ["a", "b", "c"]).bulkUpdateStatus("done");
    expect(confirmDialog).toHaveBeenCalledTimes(1);
    expect((confirmDialog.mock.calls[0] as unknown[])[0]).toContain("うち、今は表示されていない 2 件も含みます");
    expect(saveTask).toHaveBeenCalledTimes(3);
  });
  it("確認で取り消したら何も保存しない", async () => {
    confirmDialog.mockResolvedValueOnce(false);
    await useBulk(["a"], ["a", "b"]).bulkUpdatePriority("high");
    expect(saveTask).not.toHaveBeenCalled();
  });
  it("見えない選択が0件なら従来どおり確認なしで実行する", async () => {
    await useBulk(["a", "b"], ["a", "b"]).bulkUpdateStatus("done");
    expect(confirmDialog).not.toHaveBeenCalled();
    expect(saveTask).toHaveBeenCalledTimes(2);
  });
  it("一括削除の確認文にも見えない件数が入る", async () => {
    await useBulk(["a"], ["a", "b"]).bulkDelete();
    expect((confirmDialog.mock.calls[0] as unknown[])[0]).toContain("うち、今は表示されていない 1 件も含みます");
  });
  it("表示範囲を渡さない呼び出しは確認を足さない（後方互換）", async () => {
    await useBulkTaskActions(state.tasks as never, [], new Set(["a"]), "u", () => {}).bulkUpdateStatus("done");
    expect(confirmDialog).not.toHaveBeenCalled();
  });
});

describe("3画面の配線", () => {
  const src = (rel: string) => readFileSync(resolve(__dirname, "../../..", rel), "utf-8");
  it("ガント・リスト・カンバンは表示中のidを一括操作と複製モーダルへ渡す", () => {
    for (const f of ["components/gantt/GanttView.tsx", "components/list/ListView.tsx", "components/kanban/KanbanView.tsx"]) {
      const s = src(f);
      expect(s, f).toMatch(/useBulkTaskActions\([^)]*Ref,?\s*\)/);
      expect(s, f).toMatch(/visibleTaskIds=\{/);
    }
  });
});
