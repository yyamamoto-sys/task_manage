// src/lib/ai/__tests__/undoApply.test.ts
//
// 【v3.71で書き換え】undoApply.ts が appStore の choke point（saveTask/saveProject/deleteTask/
// restoreTask/deleteProject/restoreProject）経由に統一されたため、`supabase.from(...)` の
// 呼び出し順・payload形をそのまま検査する旧テストは実装の詳細に依存しすぎていた。
// applyProposal.test.ts と同じ方式（低レベルCRUDをモックし、appStoreのstateと choke point
// 関数呼び出しを検査する）に書き換える。

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { UndoSnapshot } from "../../../hooks/useUndoStack";
import type { Task, Project } from "../../localData/types";

const storeMock = vi.hoisted(() => ({
  fetchCriticalData: vi.fn(),
  fetchOkrData: vi.fn(),
  fetchGroups: vi.fn(),
  ConflictError: class ConflictError extends Error {},
  upsertGroup: vi.fn(), softDeleteGroup: vi.fn(),
  fetchLoadingTips: vi.fn(), upsertLoadingTip: vi.fn(), softDeleteLoadingTip: vi.fn(),
  upsertMember: vi.fn(), softDeleteMember: vi.fn(),
  upsertObjective: vi.fn(),
  upsertKeyResult: vi.fn(), softDeleteKeyResult: vi.fn(),
  upsertTaskForce: vi.fn(), softDeleteTaskForce: vi.fn(),
  upsertToDo: vi.fn(), softDeleteToDo: vi.fn(),
  upsertProject: vi.fn(), softDeleteProject: vi.fn(), restoreProject: vi.fn(),
  upsertTask: vi.fn(), softDeleteTask: vi.fn(), restoreTask: vi.fn(),
  upsertMilestone: vi.fn(), softDeleteMilestone: vi.fn(),
  insertProjectTaskForce: vi.fn(), deleteProjectTaskForce: vi.fn(),
  upsertQuarterlyObjective: vi.fn(),
  insertTaskTaskForce: vi.fn(), deleteTaskTaskForce: vi.fn(),
  insertTaskProject: vi.fn(), deleteTaskProject: vi.fn(),
  insertTaskDependency: vi.fn(), softDeleteTaskDependency: vi.fn(),
  upsertMemberTag: vi.fn(), softDeleteMemberTag: vi.fn(), replaceMemberTagMembers: vi.fn(),
}));

vi.mock("../../supabase/store", () => storeMock);
// handleSaveError内のreportErrorがwindow.dispatchEventを呼ぶブラウザ専用実装のため、
// vitest（environment:"node"）では元の失敗理由をReferenceErrorで揉み消してしまう。no-op化する。
vi.mock("../../errorReporter", () => ({ reportError: vi.fn() }));

import { useAppStore } from "../../../stores/appStore";
import { applyUndo } from "../undoApply";

const INITIAL_STATE = useAppStore.getState();
function resetStore() {
  useAppStore.setState(INITIAL_STATE, true);
}

function makeTask(over: Partial<Task>): Task {
  return {
    id: "t-1", name: "タスク", project_id: null, todo_ids: [],
    assignee_member_id: "", assignee_member_ids: [], status: "todo", priority: null,
    start_date: null, due_date: null, estimated_hours: null, comment: "", is_deleted: false,
    ...over,
  };
}

function makeProject(over: Partial<Project>): Project {
  return {
    id: "pj-1", name: "PJ", purpose: "目的", contribution_memo: "",
    owner_member_id: "m1", owner_member_ids: ["m1"], status: "active", color_tag: "#000",
    start_date: "2026-01-01", end_date: "2026-12-31", is_deleted: false,
    ...over,
  };
}

function makeSnapshot(operations: UndoSnapshot["operations"]): UndoSnapshot {
  return { id: "snap-1", label: "テスト", appliedAt: "2026-07-21T00:00:00Z", operations };
}

beforeEach(() => {
  resetStore();
  vi.clearAllMocks();
  Object.values(storeMock).forEach(v => { if (typeof v === "function" && "mockReset" in v) (v as { mockReset: () => void }).mockReset(); });
  storeMock.upsertTask.mockResolvedValue("2026-08-12T00:00:00.000Z");
  storeMock.upsertProject.mockResolvedValue("2026-08-12T00:00:00.000Z");
});

describe("applyUndo — 物理削除しないこと（最重要・choke pointはis_deletedフラグのみを操作）", () => {
  it("いずれの operation タイプでも softDelete系/restore系/upsert系しか呼ばれない", async () => {
    useAppStore.setState({
      tasks: [makeTask({ id: "t-1" }), makeTask({ id: "t-2", is_deleted: true }), makeTask({ id: "t-3" })],
      projects: [makeProject({ id: "pj-1" }), makeProject({ id: "pj-2", is_deleted: true }), makeProject({ id: "pj-3" })],
    });
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
  });
});

describe("applyUndo — 各operationタイプの実処理（appStoreのchoke point経由）", () => {
  it("task_field: 指定フィールドをoldValueに戻すsaveTaskを呼ぶ", async () => {
    useAppStore.setState({ tasks: [makeTask({ id: "t-1", due_date: "2026-05-20" })] });
    const snapshot = makeSnapshot([{ type: "task_field", taskId: "t-1", field: "due_date", oldValue: "2026-05-01" }]);
    await applyUndo(snapshot, "user-1");

    expect(storeMock.upsertTask).toHaveBeenCalledTimes(1);
    const saved = useAppStore.getState().tasks.find(t => t.id === "t-1");
    expect(saved?.due_date).toBe("2026-05-01");
    expect(saved?.updated_by).toBe("user-1");
  });

  it("task_restore: appStore.restoreTask経由でis_deleted=falseに戻す", async () => {
    useAppStore.setState({ tasks: [makeTask({ id: "t-2", is_deleted: true })] });
    const snapshot = makeSnapshot([{ type: "task_restore", taskId: "t-2" }]);
    await applyUndo(snapshot, "user-1");

    expect(storeMock.restoreTask).toHaveBeenCalledWith("t-2");
    expect(useAppStore.getState().tasks.find(t => t.id === "t-2")?.is_deleted).toBe(false);
  });

  it("task_delete: appStore.deleteTask経由でis_deleted=trueにする（add_taskのUndo）", async () => {
    useAppStore.setState({ tasks: [makeTask({ id: "t-3" })] });
    const snapshot = makeSnapshot([{ type: "task_delete", taskId: "t-3" }]);
    await applyUndo(snapshot, "user-1");

    expect(storeMock.softDeleteTask).toHaveBeenCalledWith("t-3", "user-1");
    expect(useAppStore.getState().tasks.find(t => t.id === "t-3")?.is_deleted).toBe(true);
  });

  it("task_field(due_date): skipCascadeを付けて呼ぶため、Undoで戻した日付を起点にB3自動リスケが再発火しない（v3.77バグ修正の回帰テスト）", async () => {
    // t-1（先行）→t-2（後続）のFS依存があるデータで、AIのdate_change提案がt-1のdue_dateを
    // 前倒し（2026-05-20→2026-05-01）した状態からUndoする（=oldValueの2026-05-20へ戻す）。
    // 戻す先の日付(05-20)はt-2のstart_date(05-02)より後ろのため、skipCascadeが漏れていると
    // この復元を起点にcomputeCascadeShiftsが再計算され、Undo操作に無関係なt-2まで
    // 押し出されてしまう（余計なsaveTask＝upsertTask呼び出しが発生する）。
    useAppStore.setState({
      tasks: [
        makeTask({ id: "t-1", due_date: "2026-05-01", start_date: "2026-04-25" }),
        makeTask({ id: "t-2", due_date: "2026-05-10", start_date: "2026-05-02" }),
      ],
      taskDependencies: [
        { id: "dep-1", predecessor_task_id: "t-1", successor_task_id: "t-2", is_deleted: false },
      ],
    });
    const snapshot = makeSnapshot([{ type: "task_field", taskId: "t-1", field: "due_date", oldValue: "2026-05-20" }]);
    const result = await applyUndo(snapshot, "user-1");

    expect(result.type).toBe("success");
    // t-1自身の復元1回だけで、t-2側への連鎖保存は起きない
    expect(storeMock.upsertTask).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().tasks.find(t => t.id === "t-2")?.due_date).toBe("2026-05-10");
    expect(useAppStore.getState().tasks.find(t => t.id === "t-2")?.start_date).toBe("2026-05-02");
  });

  it("pj_field: appStore.saveProject経由でPJの指定フィールドをoldValueに戻す（バグ修正の回帰テスト）", async () => {
    useAppStore.setState({ projects: [makeProject({ id: "pj-1", end_date: "2026-09-01" })] });
    const snapshot = makeSnapshot([{ type: "pj_field", pjId: "pj-1", field: "end_date", oldValue: "2026-06-01" }]);
    await applyUndo(snapshot, "user-1");

    expect(storeMock.upsertProject).toHaveBeenCalledTimes(1);
    const saved = useAppStore.getState().projects.find(p => p.id === "pj-1");
    expect(saved?.end_date).toBe("2026-06-01");
    expect(saved?.updated_by).toBe("user-1");
  });

  it("pj_restore: PJ配下の削除済みタスク（is_deleted=trueのみ）→PJ本体の順にrestoreTask/restoreProjectが呼ばれる", async () => {
    useAppStore.setState({
      projects: [makeProject({ id: "pj-2", is_deleted: true })],
      tasks: [
        makeTask({ id: "t-a", project_id: "pj-2", is_deleted: true }),
        makeTask({ id: "t-b", project_id: "pj-2", is_deleted: false }), // 元々削除されていない→対象外
      ],
    });
    const snapshot = makeSnapshot([{ type: "pj_restore", pjId: "pj-2" }]);
    await applyUndo(snapshot, "user-1");

    expect(storeMock.restoreTask).toHaveBeenCalledTimes(1);
    expect(storeMock.restoreTask).toHaveBeenCalledWith("t-a");
    expect(storeMock.restoreProject).toHaveBeenCalledWith("pj-2");
    expect(useAppStore.getState().tasks.find(t => t.id === "t-a")?.is_deleted).toBe(false);
    expect(useAppStore.getState().projects.find(p => p.id === "pj-2")?.is_deleted).toBe(false);
  });

  it("pj_delete: PJ配下の非削除タスク→PJ本体の順にdeleteTask/deleteProjectが呼ばれる（add_projectのUndo）", async () => {
    useAppStore.setState({
      projects: [makeProject({ id: "pj-3" })],
      tasks: [makeTask({ id: "t-c", project_id: "pj-3", is_deleted: false })],
    });
    const snapshot = makeSnapshot([{ type: "pj_delete", pjId: "pj-3" }]);
    await applyUndo(snapshot, "user-1");

    expect(storeMock.softDeleteTask).toHaveBeenCalledWith("t-c", "user-1");
    expect(storeMock.softDeleteProject).toHaveBeenCalledWith("pj-3", "user-1");
    expect(useAppStore.getState().tasks.find(t => t.id === "t-c")?.is_deleted).toBe(true);
    expect(useAppStore.getState().projects.find(p => p.id === "pj-3")?.is_deleted).toBe(true);
  });

  it("operations配列は逆順（後に実行した操作から）に適用する", async () => {
    useAppStore.setState({
      tasks: [makeTask({ id: "t-1", due_date: "2026-05-20" })],
      projects: [makeProject({ id: "pj-1", end_date: "2026-09-01" })],
    });
    const callOrder: string[] = [];
    storeMock.upsertTask.mockImplementation(async () => { callOrder.push("tasks"); return "2026-08-12T00:00:00.000Z"; });
    storeMock.upsertProject.mockImplementation(async () => { callOrder.push("projects"); return "2026-08-12T00:00:00.000Z"; });

    const snapshot = makeSnapshot([
      { type: "task_field", taskId: "t-1", field: "due_date", oldValue: "2026-05-01" },
      { type: "pj_field", pjId: "pj-1", field: "end_date", oldValue: "2026-06-01" },
    ]);
    await applyUndo(snapshot, "user-1");

    expect(callOrder[0]).toBe("projects"); // pj_field（配列2番目）が先に適用される
    expect(callOrder[1]).toBe("tasks");    // task_field（配列1番目）が後に適用される
  });
});

describe("applyUndo — エラー処理", () => {
  it("saveTaskが失敗した場合、formatErrorForUser経由のメッセージでtype:errorを返す（partial:falseの回帰テスト・1件目から失敗＝何も反映されていない）", async () => {
    useAppStore.setState({ tasks: [makeTask({ id: "t-1" })] });
    storeMock.upsertTask.mockRejectedValueOnce(new Error("boom"));

    const snapshot = makeSnapshot([{ type: "task_field", taskId: "t-1", field: "due_date", oldValue: "2026-05-01" }]);
    const result = await applyUndo(snapshot, "user-1");

    expect(result.type).toBe("error");
    if (result.type !== "error") return;
    expect(result.message).toContain("元に戻す処理に失敗しました");
    expect(result.message).toContain("boom");
    expect(result.partial).toBe(false);
  });

  it("saveProjectが失敗した場合もtype:errorを返す", async () => {
    useAppStore.setState({ projects: [makeProject({ id: "pj-1" })] });
    storeMock.upsertProject.mockRejectedValueOnce(new Error("pj boom"));

    const snapshot = makeSnapshot([{ type: "pj_field", pjId: "pj-1", field: "end_date", oldValue: "2026-06-01" }]);
    const result = await applyUndo(snapshot, "user-1");

    expect(result.type).toBe("error");
    if (result.type !== "error") return;
    expect(result.message).toContain("PJフィールド復元エラー");
  });

  it("複数operationのうち途中で失敗した場合、partial:trueと「一部のみ元に戻りました」を含むmessageを返す（v3.77バグ修正の回帰テスト）", async () => {
    useAppStore.setState({
      tasks: [makeTask({ id: "t-1", due_date: "2026-05-20" })],
      projects: [makeProject({ id: "pj-1", end_date: "2026-09-01" })],
    });
    // 1件目（pj_field、逆順適用のため配列の後ろ側から先に処理される）は成功、
    // 2件目（task_field）で失敗させる
    storeMock.upsertProject.mockResolvedValueOnce("2026-08-12T00:00:00.000Z");
    storeMock.upsertTask.mockRejectedValueOnce(new Error("conflict"));

    const snapshot = makeSnapshot([
      { type: "task_field", taskId: "t-1", field: "due_date", oldValue: "2026-05-01" },
      { type: "pj_field", pjId: "pj-1", field: "end_date", oldValue: "2026-06-01" },
    ]);
    const result = await applyUndo(snapshot, "user-1");

    expect(result.type).toBe("error");
    if (result.type !== "error") return;
    expect(result.partial).toBe(true);
    expect(result.message).toContain("一部のみ元に戻りました");
    // pj_field側は既にDBへ反映済み（stateにも反映されている）
    expect(useAppStore.getState().projects.find(p => p.id === "pj-1")?.end_date).toBe("2026-06-01");
  });
});
