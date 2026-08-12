// src/stores/__tests__/guestWriteBranches.test.ts
//
// 【設計意図】
// ゲスト（サンプル閲覧）の日常編集開放（CLAUDE.md Section 23・v3.69）の再発防止テスト。
// personalOkrUiStore.test.ts と同じ方式：appStore.ts の書き込み系アクションが、ゲストの
// ときは低レベルCRUD（lib/supabase/store.ts）を一切呼ばずstateだけを更新すること・
// 非ゲストのときは既存どおり呼ぶこと（回帰確認）を検証する。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setGuestMode } from "../../lib/guestMode";
import type { Task, Project, Milestone } from "../../lib/localData/types";

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

vi.mock("../../lib/supabase/store", () => storeMock);

import { useAppStore } from "../appStore";

const INITIAL_STATE = useAppStore.getState();

function resetStore() {
  useAppStore.setState(INITIAL_STATE, true);
}

const dummyTask: Task = {
  id: "test-task-1", name: "テストタスク", project_id: null, todo_ids: [],
  assignee_member_id: "", assignee_member_ids: [], status: "todo", priority: null,
  start_date: null, due_date: null, estimated_hours: null, comment: "", is_deleted: false,
};

const dummyProject: Project = {
  id: "test-pj-1", name: "テストPJ", purpose: "目的", contribution_memo: "",
  owner_member_id: "m1", owner_member_ids: ["m1"], status: "active", color_tag: "#000000",
  start_date: "2026-08-01", end_date: "2026-08-31", is_deleted: false,
};

const dummyMilestone: Milestone = {
  id: "test-ms-1", project_id: "test-pj-1", name: "テストMS", date: "2026-08-15", is_deleted: false,
};

describe("appStore：ゲスト分岐（日常編集の開放・v3.69）", () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
    Object.values(storeMock).forEach(v => { if (typeof v === "function" && "mockReset" in v) (v as { mockReset: () => void }).mockReset(); });
  });
  afterEach(() => setGuestMode(false));

  it("saveTask：ゲストはupsertTaskを呼ばずstateだけ更新する", async () => {
    setGuestMode(true);
    await useAppStore.getState().saveTask(dummyTask);
    expect(storeMock.upsertTask).not.toHaveBeenCalled();
    expect(useAppStore.getState().tasks.find(t => t.id === dummyTask.id)).toBeTruthy();
  });

  it("saveTask：非ゲストはupsertTaskを呼ぶ（既存経路は不変）", async () => {
    storeMock.upsertTask.mockResolvedValue("2026-08-12T00:00:00.000Z");
    await useAppStore.getState().saveTask(dummyTask);
    expect(storeMock.upsertTask).toHaveBeenCalledTimes(1);
  });

  it("deleteTask/restoreTask：ゲストは低レベルCRUDを呼ばない", async () => {
    setGuestMode(true);
    useAppStore.setState({ tasks: [dummyTask] });
    await useAppStore.getState().deleteTask(dummyTask.id, "__guest__");
    expect(storeMock.softDeleteTask).not.toHaveBeenCalled();
    expect(useAppStore.getState().tasks.find(t => t.id === dummyTask.id)?.is_deleted).toBe(true);

    await useAppStore.getState().restoreTask(dummyTask.id);
    expect(storeMock.restoreTask).not.toHaveBeenCalled();
    expect(useAppStore.getState().tasks.find(t => t.id === dummyTask.id)?.is_deleted).toBe(false);
  });

  it("saveProject/deleteProject/restoreProject：ゲストは低レベルCRUDを呼ばない", async () => {
    setGuestMode(true);
    await useAppStore.getState().saveProject(dummyProject);
    expect(storeMock.upsertProject).not.toHaveBeenCalled();
    await useAppStore.getState().deleteProject(dummyProject.id, "__guest__");
    expect(storeMock.softDeleteProject).not.toHaveBeenCalled();
    expect(useAppStore.getState().projects.find(p => p.id === dummyProject.id)?.is_deleted).toBe(true);

    await useAppStore.getState().restoreProject(dummyProject.id);
    expect(storeMock.restoreProject).not.toHaveBeenCalled();
    expect(useAppStore.getState().projects.find(p => p.id === dummyProject.id)?.is_deleted).toBe(false);
  });

  it("saveMilestone/deleteMilestone：ゲストは低レベルCRUDを呼ばない", async () => {
    setGuestMode(true);
    await useAppStore.getState().saveMilestone(dummyMilestone);
    expect(storeMock.upsertMilestone).not.toHaveBeenCalled();
    await useAppStore.getState().deleteMilestone(dummyMilestone.id, "__guest__");
    expect(storeMock.softDeleteMilestone).not.toHaveBeenCalled();
  });

  it("addTaskDependency/removeTaskDependency：ゲストは低レベルCRUDを呼ばない", async () => {
    setGuestMode(true);
    useAppStore.setState({ tasks: [dummyTask, { ...dummyTask, id: "test-task-2" }] });
    await useAppStore.getState().addTaskDependency(dummyTask.id, "test-task-2", "__guest__");
    expect(storeMock.insertTaskDependency).not.toHaveBeenCalled();
    const dep = useAppStore.getState().taskDependencies[0];
    await useAppStore.getState().removeTaskDependency(dep.id, "__guest__");
    expect(storeMock.softDeleteTaskDependency).not.toHaveBeenCalled();
  });

  it("addTaskTaskForce/removeTaskTaskForce・addTaskProject/removeTaskProject：ゲストは低レベルCRUDを呼ばない", async () => {
    setGuestMode(true);
    const store = useAppStore.getState();
    await store.addTaskTaskForce({ task_id: dummyTask.id, tf_id: "tf1" });
    await store.removeTaskTaskForce(dummyTask.id, "tf1");
    await store.addTaskProject({ task_id: dummyTask.id, project_id: dummyProject.id });
    await store.removeTaskProject(dummyTask.id, dummyProject.id);
    expect(storeMock.insertTaskTaskForce).not.toHaveBeenCalled();
    expect(storeMock.deleteTaskTaskForce).not.toHaveBeenCalled();
    expect(storeMock.insertTaskProject).not.toHaveBeenCalled();
    expect(storeMock.deleteTaskProject).not.toHaveBeenCalled();
  });

  it("ConflictErrorは誤発生しない：ゲストの連続saveTaskが例外を投げない", async () => {
    setGuestMode(true);
    await useAppStore.getState().saveTask(dummyTask);
    await useAppStore.getState().saveTask({ ...dummyTask, name: "改名2回目" });
    expect(useAppStore.getState().tasks.find(t => t.id === dummyTask.id)?.name).toBe("改名2回目");
  });
});
