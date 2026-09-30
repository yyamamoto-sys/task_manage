// src/stores/__tests__/loadPartialWarnings.test.ts
//
// 【設計意図】（CLAUDE.md Section 61・M42是正・v3.123）
// appStore.load() が Phase 1（fetchCriticalData）・Phase 2（fetchOkrData）の
// partialFailures を「追記」で partialLoadWarning に反映すること（Phase 1の警告を
// Phase 2が上書きしないこと）を検証する。guestWriteBranches.test.ts と同じ
// 「src/lib/supabase/store を丸ごとモックする」方式。

import { describe, it, expect, vi, beforeEach } from "vitest";

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
  insertEntityChangeLog: vi.fn(),
}));

vi.mock("../../lib/supabase/store", () => storeMock);

import { useAppStore } from "../appStore";

const INITIAL_STATE = useAppStore.getState();

function resetStore() {
  useAppStore.setState(INITIAL_STATE, true);
}

function baseCriticalData(partialFailures: string[] = []) {
  return {
    members: [], projects: [], tasks: [], taskProjects: [],
    milestones: [], memberTags: [], memberTagMembers: [], taskDependencies: [],
    partialFailures,
  };
}

function baseOkrData(partialFailures: string[] = []) {
  return {
    objectives: [], keyResults: [], taskForces: [], todos: [],
    projectTaskForces: [], taskTaskForces: [],
    partialFailures,
  };
}

describe("appStore.load()：Phase 1/Phase 2 partialLoadWarningの合成（M42是正・v3.123）", () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
    Object.values(storeMock).forEach(v => { if (typeof v === "function" && "mockReset" in v) (v as { mockReset: () => void }).mockReset(); });
    storeMock.fetchGroups.mockResolvedValue([]);
    storeMock.fetchLoadingTips.mockResolvedValue([]);
  });

  it("Phase 1・Phase 2ともに全表正常なら partialLoadWarning は空配列", async () => {
    storeMock.fetchCriticalData.mockResolvedValue(baseCriticalData());
    storeMock.fetchOkrData.mockResolvedValue(baseOkrData());
    await useAppStore.getState().load();
    expect(useAppStore.getState().partialLoadWarning).toEqual([]);
  });

  it("Phase 2（key_results）だけ失敗しても例外にならず、部分失敗一覧に入り他5表のデータは返る", async () => {
    storeMock.fetchCriticalData.mockResolvedValue(baseCriticalData());
    storeMock.fetchOkrData.mockResolvedValue({
      objectives: [{ id: "o1" }], keyResults: [], taskForces: [{ id: "tf1" }], todos: [{ id: "td1" }],
      projectTaskForces: [{ project_id: "p1", tf_id: "tf1" }], taskTaskForces: [{ task_id: "t1", tf_id: "tf1" }],
      partialFailures: ["KR（重要な成果）"],
    });
    await expect(useAppStore.getState().load()).resolves.not.toThrow();
    const state = useAppStore.getState();
    expect(state.partialLoadWarning).toEqual(["KR（重要な成果）"]);
    expect(state.keyResults).toEqual([]);
    expect(state.objectives).toHaveLength(1);
    expect(state.taskForces).toHaveLength(1);
    expect(state.todos).toHaveLength(1);
    expect(state.projectTaskForces).toHaveLength(1);
    expect(state.taskTaskForces).toHaveLength(1);
  });

  it("Phase 1（周辺表）の警告がある状態でPhase 2も失敗すると、両方の表名が残る", async () => {
    storeMock.fetchCriticalData.mockResolvedValue(baseCriticalData(["マイルストーン"]));
    storeMock.fetchOkrData.mockResolvedValue(baseOkrData(["ToDo"]));
    await useAppStore.getState().load();
    expect(useAppStore.getState().partialLoadWarning).toEqual(["マイルストーン", "ToDo"]);
  });
});
