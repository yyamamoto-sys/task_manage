// src/stores/__tests__/loadProgressFlow.test.ts
//
// 【設計意図】（v3.211）起動画面の進行度が、Phase 1 完了（loading=false）の瞬間に 0 へ戻らないこと、
// Phase 2（OKR）の上端バーは別の値（backgroundProgress）で 0 から始まることを検証する。
// 以前は Phase 1 完了の set で loadProgress を 0 に戻していたため、自動同定の間 100% が一度も見えなかった。

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
import { PREPARING_PROGRESS, PHASE1_DATA_MAX } from "../../lib/loadProgress";

const INITIAL_STATE = useAppStore.getState();

const critical = {
  members: [], projects: [], tasks: [], taskProjects: [],
  milestones: [], projectSections: [], memberTags: [], memberTagMembers: [], taskDependencies: [],
  partialFailures: [] as string[],
};
const okr = {
  objectives: [], keyResults: [], taskForces: [], todos: [],
  projectTaskForces: [], taskTaskForces: [], partialFailures: [] as string[],
};

describe("appStore.load()：起動画面の進行度（v3.211）", () => {
  beforeEach(() => {
    useAppStore.setState(INITIAL_STATE, true);
    Object.values(storeMock).forEach(v => { if (typeof v === "function" && "mockReset" in v) (v as { mockReset: () => void }).mockReset(); });
    storeMock.fetchGroups.mockResolvedValue([]);
    storeMock.fetchLoadingTips.mockResolvedValue([]);
  });

  it("Phase 1 完了で loadProgress は 0 に戻らず、Phase 2 の上端バーは backgroundProgress が 0 から始まる", async () => {
    storeMock.fetchCriticalData.mockImplementation(async (onProgress?: (d: number, t: number) => void) => {
      onProgress?.(9, 9);
      return critical;
    });
    let atPhase2: { loading: boolean; loadProgress: number; backgroundProgress: number } | null = null;
    storeMock.fetchOkrData.mockImplementation(async () => {
      const s = useAppStore.getState();
      atPhase2 = { loading: s.loading, loadProgress: s.loadProgress, backgroundProgress: s.backgroundProgress };
      return okr;
    });
    await useAppStore.getState().load();
    expect(atPhase2).toEqual({ loading: false, loadProgress: PREPARING_PROGRESS, backgroundProgress: 0 });
    expect(useAppStore.getState().backgroundProgress).toBe(100);
  });

  it("Phase 1 の間は進行度が単調に増え、データ取得だけでは上限（PHASE1_DATA_MAX）を超えない", async () => {
    storeMock.fetchCriticalData.mockImplementation(async (onProgress?: (d: number, t: number) => void) => {
      for (let i = 1; i <= 9; i++) onProgress?.(i, 9);
      return critical;
    });
    storeMock.fetchOkrData.mockResolvedValue(okr);
    const seen: number[] = [];
    let loadingSeen = true;
    const unsub = useAppStore.subscribe(s => { if (s.loading && loadingSeen) seen.push(s.loadProgress); if (!s.loading) loadingSeen = false; });
    await useAppStore.getState().load();
    unsub();
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    expect(Math.max(...seen)).toBeLessThanOrEqual(PHASE1_DATA_MAX);
  });

  it("fetchGroups が失敗しても起動は続き、groups は空配列（握りつぶしを維持）", async () => {
    storeMock.fetchCriticalData.mockResolvedValue(critical);
    storeMock.fetchOkrData.mockResolvedValue(okr);
    storeMock.fetchGroups.mockRejectedValue(new Error("relation groups does not exist"));
    await useAppStore.getState().load();
    expect(useAppStore.getState().error).toBeNull();
    expect(useAppStore.getState().groups).toEqual([]);
  });
});
