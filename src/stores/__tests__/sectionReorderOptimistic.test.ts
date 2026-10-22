// グループの並べ替えは、保存の完了を待たずに最終の並びを1回で画面へ反映する（巡回57回目・v3.177）。
// 以前は1件ずつ「保存→完了→次の1件を反映」だったため、保存が遅い間は途中の並び（同じ sort_order が重なった状態）が
// 画面に出て、その間にもう一度並べ替えると中途半端な並びを基準に計算されていた。
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
  upsertProjectSection: vi.fn(), softDeleteProjectSection: vi.fn(),
  insertProjectTaskForce: vi.fn(), deleteProjectTaskForce: vi.fn(), upsertQuarterlyObjective: vi.fn(),
  insertTaskTaskForce: vi.fn(), deleteTaskTaskForce: vi.fn(), insertTaskProject: vi.fn(), deleteTaskProject: vi.fn(),
  insertTaskDependency: vi.fn(), softDeleteTaskDependency: vi.fn(),
  upsertMemberTag: vi.fn(), softDeleteMemberTag: vi.fn(), replaceMemberTagMembers: vi.fn(), insertEntityChangeLog: vi.fn(),
}));
vi.mock("../../lib/supabase/store", () => storeMock);

import { useAppStore } from "../appStore";
import type { ProjectSection } from "../../lib/localData/types";

const U = "2026-10-22T00:00:00.000Z";
const sec = (id: string, sort_order: number): ProjectSection =>
  ({ id, project_id: "p1", name: id, sort_order, is_deleted: false, updated_at: U, created_at: U });

beforeEach(() => {
  Object.values(storeMock).forEach(v => { if (typeof v === "function" && "mockReset" in v) (v as { mockReset: () => void }).mockReset(); });
  useAppStore.setState({ projectSections: [sec("a", 0), sec("b", 1), sec("c", 2)], tasks: [], currentGroupId: "g" } as never);
});

const orderOf = () => useAppStore.getState().projectSections
  .filter(s => !s.is_deleted).sort((x, y) => x.sort_order - y.sort_order).map(s => s.id).join("");

describe("reorderProjectSections", () => {
  it("1件目の保存が終わる前でも、最終の並びが画面に反映されている", async () => {
    let release!: (v: string) => void;
    storeMock.upsertProjectSection.mockImplementationOnce(() => new Promise<string>(r => { release = r; }));
    storeMock.upsertProjectSection.mockResolvedValue(U);
    const p = useAppStore.getState().reorderProjectSections("p1", ["c", "a", "b"], "u1");
    // 保存はまだ1件目で止まっている。この時点で c,a,b になっていること（修正前は a,b,c のまま sort_order の一部だけが変わる）
    expect(orderOf()).toBe("cab");
    release("2026-10-22T00:00:01.000Z");
    await p;
    expect(orderOf()).toBe("cab");
    expect(storeMock.upsertProjectSection).toHaveBeenCalledTimes(3);
  });

  it("並びが変わらなければ何も保存しない", async () => {
    await useAppStore.getState().reorderProjectSections("p1", ["a", "b", "c"], "u1");
    expect(storeMock.upsertProjectSection).not.toHaveBeenCalled();
  });
});
