// appStore.load() が実際に走った回数を数える（healthMonitor の load-burst の元。v3.146・Section 76）。
import { describe, it, expect, vi, beforeEach } from "vitest";

const storeMock = vi.hoisted(() => ({
  fetchCriticalData: vi.fn(), fetchOkrData: vi.fn(), fetchGroups: vi.fn(),
  ConflictError: class ConflictError extends Error {},
  upsertGroup: vi.fn(), softDeleteGroup: vi.fn(),
  fetchLoadingTips: vi.fn(), upsertLoadingTip: vi.fn(), softDeleteLoadingTip: vi.fn(),
  upsertMember: vi.fn(), softDeleteMember: vi.fn(), upsertObjective: vi.fn(),
  upsertKeyResult: vi.fn(), softDeleteKeyResult: vi.fn(),
  upsertTaskForce: vi.fn(), softDeleteTaskForce: vi.fn(), upsertToDo: vi.fn(), softDeleteToDo: vi.fn(),
  upsertProject: vi.fn(), softDeleteProject: vi.fn(), restoreProject: vi.fn(),
  upsertTask: vi.fn(), softDeleteTask: vi.fn(), restoreTask: vi.fn(),
  upsertMilestone: vi.fn(), softDeleteMilestone: vi.fn(),
  insertProjectTaskForce: vi.fn(), deleteProjectTaskForce: vi.fn(), upsertQuarterlyObjective: vi.fn(),
  insertTaskTaskForce: vi.fn(), deleteTaskTaskForce: vi.fn(), insertTaskProject: vi.fn(), deleteTaskProject: vi.fn(),
  insertTaskDependency: vi.fn(), softDeleteTaskDependency: vi.fn(),
  upsertMemberTag: vi.fn(), softDeleteMemberTag: vi.fn(), replaceMemberTagMembers: vi.fn(), insertEntityChangeLog: vi.fn(),
}));
vi.mock("../../lib/supabase/store", () => storeMock);

import { useAppStore } from "../appStore";
import { getLoadTotal, countLoadsWithin, _resetLoadCounterForTest } from "../../lib/diagnostics/loadCounter";

beforeEach(() => {
  _resetLoadCounterForTest();
  storeMock.fetchGroups.mockResolvedValue([]);
  storeMock.fetchLoadingTips.mockResolvedValue([]);
  storeMock.fetchCriticalData.mockResolvedValue({ members: [], projects: [], tasks: [], taskProjects: [], milestones: [], memberTags: [], memberTagMembers: [], taskDependencies: [], partialFailures: [] });
  storeMock.fetchOkrData.mockResolvedValue({ objectives: [], keyResults: [], taskForces: [], todos: [], projectTaskForces: [], taskTaskForces: [], partialFailures: [] });
});

describe("load() の実行回数", () => {
  it("load() を実行するたびに数える", async () => {
    await useAppStore.getState().load();
    await useAppStore.getState().load();
    expect(getLoadTotal()).toBe(2);
    expect(countLoadsWithin(10 * 60 * 1000)).toBe(2);
  });
});
