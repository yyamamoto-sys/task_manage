// 保存の競合（ConflictError）の原因になる2つの不具合の再発防止（v3.153・CLAUDE.md Section 5／76）。
// A: load() の取得中に成功した自分の保存の updated_at を、古い取得結果の丸ごと置き換えが巻き戻す。
// C: 古いスナップショットの task で saveTask を呼ぶと、楽観更新が store の updated_at を古い値に戻す。
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({ updated: "", n: 0 }));
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

import { useAppStore, _resetRemoteStateForTest } from "../appStore";
import type { Task } from "../../lib/localData/types";

const U0 = "2026-10-15T00:00:00.000Z";
const iso = (n: number) => new Date(Date.parse(U0) + n * 1000).toISOString();
const T = (u: string, name = "A", extra: Record<string, unknown> = {}) =>
  ({ id: "t1", name, status: "todo", updated_at: u, todo_ids: [], tags: [], assignee_member_ids: [], is_deleted: false, group_id: "g", ...extra }) as unknown as Task;
const critical = (tasks: Task[]) => ({
  members: [], projects: [], tasks, taskProjects: [], milestones: [], projectSections: [], memberTags: [],
  memberTagMembers: [], taskDependencies: [], partialFailures: [],
});

beforeEach(() => {
  _resetRemoteStateForTest();
  Object.values(storeMock).forEach(v => { if (typeof v === "function" && "mockReset" in v) (v as { mockReset: () => void }).mockReset(); });
  db.updated = U0; db.n = 0;
  storeMock.fetchGroups.mockResolvedValue([]);
  storeMock.fetchLoadingTips.mockResolvedValue([]);
  storeMock.fetchOkrData.mockResolvedValue({ objectives: [], keyResults: [], taskForces: [], todos: [], projectTaskForces: [], taskTaskForces: [], partialFailures: [] });
  // saveWithLock と同じ意味：expected が DB と一致したときだけ進める
  storeMock.upsertTask.mockImplementation(async (_t: unknown, expected?: string) => {
    if (expected !== db.updated) throw new storeMock.ConflictError("conflict expected=" + expected + " db=" + db.updated);
    db.n++; db.updated = iso(db.n); return db.updated;
  });
  storeMock.upsertProject.mockImplementation(async () => { db.n++; return iso(db.n); });
  useAppStore.setState({ tasks: [T(U0)], projects: [], currentGroupId: "g" } as never);
});

describe("A: load() の取得中に成功した保存を、古い取得結果で巻き戻さない", () => {
  it("取得中に保存→古い取得結果で置換しても updated_at と内容が保存後のまま・次の保存が通る", async () => {
    let release!: (v: unknown) => void;
    storeMock.fetchCriticalData.mockImplementation(() => new Promise(r => { release = r; }));
    const loading = useAppStore.getState().load();
    await useAppStore.getState().saveTask(T(U0, "B"));
    expect(useAppStore.getState().tasks[0].updated_at).toBe(iso(1));
    release(critical([T(U0, "A")]));
    await loading;
    const t = useAppStore.getState().tasks[0];
    expect(t.updated_at).toBe(iso(1));
    expect(t.name).toBe("B");
    await expect(useAppStore.getState().saveTask(T(iso(1), "C"))).resolves.toBeUndefined();
  });

  it("取得結果の方が新しい行（他人の変更）は手元で消さない", async () => {
    let release!: (v: unknown) => void;
    storeMock.fetchCriticalData.mockImplementation(() => new Promise(r => { release = r; }));
    const loading = useAppStore.getState().load();
    await useAppStore.getState().saveTask(T(U0, "B"));
    release(critical([T(iso(5), "他人の変更")]));
    await loading;
    const t = useAppStore.getState().tasks[0];
    expect(t.updated_at).toBe(iso(5));
    expect(t.name).toBe("他人の変更");
  });

  it("取得中に保存していない行は取得結果のまま（記録の無い行は触らない）", async () => {
    let release!: (v: unknown) => void;
    storeMock.fetchCriticalData.mockImplementation(() => new Promise(r => { release = r; }));
    useAppStore.setState({ tasks: [T(iso(9), "手元だけ新しい")] } as never);
    const loading = useAppStore.getState().load();
    release(critical([T(U0, "取得結果")]));
    await loading;
    expect(useAppStore.getState().tasks[0].name).toBe("取得結果");
  });

  it("取得開始前の保存は記録されず、次の load の置き換えには影響しない（世代ごと）", async () => {
    await useAppStore.getState().saveTask(T(U0, "B"));
    storeMock.fetchCriticalData.mockResolvedValue(critical([T(U0, "旧")]));
    await useAppStore.getState().load();
    expect(useAppStore.getState().tasks[0].name).toBe("旧");
  });

  it("取得中に新規作成した行は、取得結果に無くても消えない", async () => {
    let release!: (v: unknown) => void;
    storeMock.fetchCriticalData.mockImplementation(() => new Promise(r => { release = r; }));
    storeMock.upsertTask.mockImplementation(async () => iso(3));
    const loading = useAppStore.getState().load();
    await useAppStore.getState().saveTask(T(iso(3), "新規", { id: "t9" }));
    release(critical([T(U0, "A")]));
    await loading;
    expect(useAppStore.getState().tasks.map(t => t.id).sort()).toEqual(["t1", "t9"]);
  });

  it("PJ も同じ（saveProject が取得中に成功 → 古い取得結果で巻き戻らない）", async () => {
    let release!: (v: unknown) => void;
    storeMock.fetchCriticalData.mockImplementation(() => new Promise(r => { release = r; }));
    const P = (u: string, name: string) => ({ id: "p1", name, updated_at: u, is_deleted: false, group_id: "g" }) as never;
    useAppStore.setState({ projects: [P(U0, "A")] } as never);
    const loading = useAppStore.getState().load();
    await useAppStore.getState().saveProject(P(U0, "B"));
    release({ ...critical([]), projects: [P(U0, "A")] });
    await loading;
    const p = useAppStore.getState().projects[0];
    expect(p.name).toBe("B");
    expect(p.updated_at).toBe(iso(1));
  });
});

describe("C: 古いスナップショットの task で保存しても store の updated_at を戻さない", () => {
  it("DB=U1・store=U1 のとき、古い U0 の task を渡して saveTask しても ConflictError にならない", async () => {
    await useAppStore.getState().saveTask(T(U0, "B"));
    expect(db.updated).toBe(iso(1));
    await expect(useAppStore.getState().saveTask(T(U0, "C"))).resolves.toBeUndefined();
    const t = useAppStore.getState().tasks[0];
    expect(t.name).toBe("C");
    expect(t.updated_at).toBe(iso(2));
  });
});
