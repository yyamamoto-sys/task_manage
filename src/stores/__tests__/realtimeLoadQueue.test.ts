// load() の取得中に届いた realtime 差分を、置き換えの後に再適用する／差分取得（v3.148・CLAUDE.md Section 76）。
import { describe, it, expect, vi, beforeEach } from "vitest";

const storeMock = vi.hoisted(() => ({
  fetchCriticalData: vi.fn(), fetchOkrData: vi.fn(), fetchGroups: vi.fn(), fetchChangesSince: vi.fn(),
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

import { useAppStore, setRemoteResyncRequester, catchUpRemoteChanges, getFirstLoadStartedAt, _resetRemoteStateForTest } from "../appStore";
import type { RealtimeChange } from "../appStore";

const critical = (tasks: Record<string, unknown>[]) => ({
  members: [], projects: [], tasks, taskProjects: [], milestones: [], memberTags: [], memberTagMembers: [], taskDependencies: [], partialFailures: [],
});
const okr = (todos: Record<string, unknown>[] = []) => ({
  objectives: [], keyResults: [], taskForces: [], todos, projectTaskForces: [], taskTaskForces: [], partialFailures: [],
});
const ev = (table: string, eventType: "INSERT" | "UPDATE" | "DELETE", row: Record<string, unknown>): RealtimeChange => ({
  table, eventType, new: eventType === "DELETE" ? null : row, old: eventType === "DELETE" ? row : null,
});

beforeEach(() => {
  _resetRemoteStateForTest();
  useAppStore.setState({ tasks: [], todos: [], projects: [], taskProjects: [] });
  Object.values(storeMock).forEach(v => { if (typeof v === "function" && "mockReset" in v) (v as { mockReset: () => void }).mockReset(); });
  storeMock.fetchGroups.mockResolvedValue([]);
  storeMock.fetchLoadingTips.mockResolvedValue([]);
  storeMock.fetchOkrData.mockResolvedValue(okr());
});

describe("load() の取得中に届いた realtime 差分", () => {
  it("取得完了時の丸ごと置き換えで消えず、取得結果より新しい差分が勝つ／取得結果の方が新しければ差分は捨てられる", async () => {
    let resolveCritical!: (v: unknown) => void;
    storeMock.fetchCriticalData.mockReturnValue(new Promise(r => { resolveCritical = r; }));
    const loading = useAppStore.getState().load();
    // 取得中に届く：t1 の更新（取得結果より新しい）・t2 の更新（取得結果の方が新しい）・t3 の新規
    useAppStore.getState().applyRemoteChange(ev("tasks", "UPDATE", { id: "t1", name: "リモート新", updated_at: "2026-10-14T00:00:10Z" }));
    useAppStore.getState().applyRemoteChange(ev("tasks", "UPDATE", { id: "t2", name: "リモート旧", updated_at: "2026-10-14T00:00:01Z" }));
    useAppStore.getState().applyRemoteChange(ev("tasks", "INSERT", { id: "t3", name: "新規", updated_at: "2026-10-14T00:00:09Z" }));
    resolveCritical(critical([
      { id: "t1", name: "取得結果の旧", updated_at: "2026-10-14T00:00:05Z" },
      { id: "t2", name: "取得結果の新", updated_at: "2026-10-14T00:00:05Z" },
    ]));
    await loading;
    const tasks = useAppStore.getState().tasks;
    expect(tasks.find(t => t.id === "t1")?.name).toBe("リモート新");
    expect(tasks.find(t => t.id === "t2")?.name).toBe("取得結果の新");
    expect(tasks.find(t => t.id === "t3")?.name).toBe("新規");
  });
  it("Phase 2（OKR 系の表）の置き換えにも再適用される", async () => {
    let resolveOkr!: (v: unknown) => void;
    storeMock.fetchCriticalData.mockResolvedValue(critical([]));
    storeMock.fetchOkrData.mockReturnValue(new Promise(r => { resolveOkr = r; }));
    const loading = useAppStore.getState().load();
    // Phase 1 が終わって Phase 2 の取得中に届く
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    useAppStore.getState().applyRemoteChange(ev("todos", "INSERT", { id: "td1", title: "取得中に作られた", updated_at: "2026-10-14T00:00:09Z" }));
    resolveOkr(okr([]));
    await loading;
    expect(useAppStore.getState().todos.map(t => t.id)).toContain("td1");
  });
  it("load が終わったあとに届いた差分は、キューではなく直接反映される（キューは空に戻る）", async () => {
    storeMock.fetchCriticalData.mockResolvedValue(critical([{ id: "t1", name: "A", updated_at: "2026-10-14T00:00:00Z" }]));
    await useAppStore.getState().load();
    useAppStore.getState().applyRemoteChange(ev("tasks", "UPDATE", { id: "t1", name: "B", updated_at: "2026-10-14T00:00:05Z" }));
    expect(useAppStore.getState().tasks[0].name).toBe("B");
  });
  it("初回 load の開始時刻を記録する（差分取得の起点）", async () => {
    expect(getFirstLoadStartedAt()).toBeNull();
    storeMock.fetchCriticalData.mockResolvedValue(critical([]));
    const before = Date.now();
    await useAppStore.getState().load();
    expect(getFirstLoadStartedAt()).toBeGreaterThanOrEqual(before);
  });
});

describe("catchUpRemoteChanges：購読が張られるまでの間の変更を差分取得で埋める", () => {
  it("取得した行を反映し、未登録 id の UPDATE でも全件再取得を要求しない", async () => {
    const requester = vi.fn();
    setRemoteResyncRequester(requester);
    useAppStore.setState({ tasks: [{ id: "t1", name: "古い", updated_at: "2026-10-14T00:00:00Z" } as never] });
    storeMock.fetchChangesSince.mockResolvedValue([
      { table: "tasks", row: { id: "t1", name: "更新された", updated_at: "2026-10-14T00:00:05Z" } },
      { table: "tasks", row: { id: "tNew", name: "窓の間に作られた", updated_at: "2026-10-14T00:00:06Z" } },
      { table: "task_projects", row: { task_id: "t1", project_id: "p1" } },
    ]);
    await catchUpRemoteChanges(Date.parse("2026-10-14T00:00:00Z"));
    const s = useAppStore.getState();
    expect(s.tasks.find(t => t.id === "t1")?.name).toBe("更新された");
    expect(s.tasks.find(t => t.id === "tNew")?.name).toBe("窓の間に作られた");
    expect(s.taskProjects).toHaveLength(1);
    expect(requester).not.toHaveBeenCalled();
  });
  it("時計のずれを見込んで、起点より2分前から取得する", async () => {
    storeMock.fetchChangesSince.mockResolvedValue([]);
    await catchUpRemoteChanges(Date.parse("2026-10-14T00:10:00Z"));
    expect(storeMock.fetchChangesSince).toHaveBeenCalledWith("2026-10-14T00:08:00.000Z");
  });
  it("取得に失敗したら例外を投げる（呼び出し側が全件再取得に切り替える）", async () => {
    storeMock.fetchChangesSince.mockRejectedValue(new Error("net"));
    await expect(catchUpRemoteChanges(Date.now())).rejects.toThrow("net");
  });
});
