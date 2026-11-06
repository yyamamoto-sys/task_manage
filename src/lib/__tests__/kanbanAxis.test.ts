import { describe, it, expect } from "vitest";
import type { ProjectSection, Task } from "../localData/types";
import {
  NO_GROUP_KEY, NO_PRIORITY_KEY, OTHER_ASSIGNEE_KEY, buildAxisColumns, computeAxisDropPatch, dropRejectReason,
  parseStoredKanbanAxis, taskColumnKeys, type AxisContext,
} from "../kanbanAxis";
import { UNASSIGNED_KEY } from "../task/assigneeMove";

const task = (o: Partial<Task> & { id: string }): Task => ({
  name: o.id, project_id: "p1", todo_ids: [], assignee_member_id: "", assignee_member_ids: [],
  status: "todo", priority: null, start_date: null, due_date: null, estimated_hours: null, comment: "", is_deleted: false,
  ...o,
});
const sec = (id: string, project_id: string, name: string, sort_order = 0): ProjectSection =>
  ({ id, project_id, name, sort_order, is_deleted: false });
const ctx = (o: Partial<AxisContext> = {}): AxisContext => ({
  members: [{ id: "a", display_name: "Aさん" }, { id: "b", display_name: "Bさん" }],
  sections: [sec("s1", "p1", "準備"), sec("s2", "p2", "準備"), sec("s3", "p1", "本番", 1)],
  projects: [{ id: "p1", name: "PJ1" }, { id: "p2", name: "PJ2" }],
  selectedProjectId: null,
  ...o,
});

describe("parseStoredKanbanAxis", () => {
  it("未知の値・未保存は status", () => {
    expect(parseStoredKanbanAxis(null)).toBe("status");
    expect(parseStoredKanbanAxis("x")).toBe("status");
    expect(parseStoredKanbanAxis("assignee")).toBe("assignee");
  });
});

describe("担当者軸の列", () => {
  it("メンバー列＋未割り当て。複数担当は各担当者の列に出る", () => {
    const t1 = task({ id: "t1", assignee_member_ids: ["a", "b"], assignee_member_id: "a" });
    const t2 = task({ id: "t2" });
    const cols = buildAxisColumns("assignee", [t1, t2], ctx());
    expect(cols.map(c => c.key)).toEqual(["a", "b", UNASSIGNED_KEY]);
    expect(cols[0].tasks.map(t => t.id)).toEqual(["t1"]);
    expect(cols[1].tasks.map(t => t.id)).toEqual(["t1"]);
    expect(cols[2].tasks.map(t => t.id)).toEqual(["t2"]);
  });
  it("表示外の担当者だけのタスクは「表示外の担当者」列（落とせない）", () => {
    const t = task({ id: "t", assignee_member_ids: ["zzz"], assignee_member_id: "zzz" });
    expect(taskColumnKeys("assignee", t, ctx())).toEqual([OTHER_ASSIGNEE_KEY]);
    expect(buildAxisColumns("assignee", [t], ctx()).map(c => c.key)).toContain(OTHER_ASSIGNEE_KEY);
    expect(dropRejectReason("assignee", t, OTHER_ASSIGNEE_KEY, ctx())).not.toBeNull();
  });
  it("ドロップ：移動元の担当者だけ入れ替え、2項目で返す", () => {
    const t = task({ id: "t", assignee_member_ids: ["a", "x"], assignee_member_id: "a" });
    expect(computeAxisDropPatch("assignee", t, "a", "b", ctx())).toEqual({ assignee_member_ids: ["b", "x"], assignee_member_id: "b" });
    expect(computeAxisDropPatch("assignee", t, "a", UNASSIGNED_KEY, ctx())).toEqual({ assignee_member_ids: ["x"], assignee_member_id: "x" });
    expect(computeAxisDropPatch("assignee", t, "a", "a", ctx())).toBeNull();
  });
});

describe("優先度軸", () => {
  it("高・中・低は常に出し、未設定は該当があるときだけ", () => {
    const t = task({ id: "t", priority: "mid" });
    expect(buildAxisColumns("priority", [t], ctx()).map(c => c.key)).toEqual(["high", "mid", "low"]);
    const u = task({ id: "u" });
    expect(buildAxisColumns("priority", [t, u], ctx()).map(c => c.key)).toEqual(["high", "mid", "low", NO_PRIORITY_KEY]);
  });
  it("ドロップ：優先度を変える。同じ列は null", () => {
    const t = task({ id: "t", priority: "mid" });
    expect(computeAxisDropPatch("priority", t, "mid", "high", ctx())).toEqual({ priority: "high" });
    expect(computeAxisDropPatch("priority", t, "mid", NO_PRIORITY_KEY, ctx())).toEqual({ priority: null });
    expect(computeAxisDropPatch("priority", t, "mid", "mid", ctx())).toBeNull();
  });
});

describe("グループ軸", () => {
  it("PJ未選択：所属グループだけ列にし、同名は「PJ名／グループ名」", () => {
    const tasks = [task({ id: "a", section_id: "s1" }), task({ id: "b", project_id: "p2", section_id: "s2" }), task({ id: "c" })];
    const cols = buildAxisColumns("group", tasks, ctx());
    expect(cols.map(c => c.label)).toEqual(["PJ1／準備", "PJ2／準備", "グループなし"]);
    expect(cols[2].tasks.map(t => t.id)).toEqual(["c"]);
  });
  it("PJ選択中：そのPJの全グループが列（空でも）。名前だけ", () => {
    const cols = buildAxisColumns("group", [task({ id: "a", section_id: "s1" })], ctx({ selectedProjectId: "p1" }));
    expect(cols.map(c => c.label)).toEqual(["準備", "本番", "グループなし"]);
  });
  it("別PJのグループへは落とせない（理由つき・更新なし）", () => {
    const t = task({ id: "t", project_id: "p1" });
    expect(dropRejectReason("group", t, "s2", ctx())).toContain("別のプロジェクト");
    expect(computeAxisDropPatch("group", t, NO_GROUP_KEY, "s2", ctx())).toBeNull();
  });
  it("同じPJのグループへ・グループなしへ移せる", () => {
    const t = task({ id: "t", section_id: "s1" });
    expect(computeAxisDropPatch("group", t, "s1", "s3", ctx())).toEqual({ section_id: "s3" });
    expect(computeAxisDropPatch("group", t, "s1", NO_GROUP_KEY, ctx())).toEqual({ section_id: null });
    expect(computeAxisDropPatch("group", t, "s1", "s1", ctx())).toBeNull();
  });
  it("子タスクは親と同じグループ＝移せない", () => {
    const t = task({ id: "t", parent_task_id: "p", section_id: "s1" });
    expect(dropRejectReason("group", t, "s3", ctx())).toContain("子タスク");
    expect(computeAxisDropPatch("group", t, "s1", "s3", ctx())).toBeNull();
  });
  it("PJ無しのタスクはグループへ移せない", () => {
    const t = task({ id: "t", project_id: null });
    expect(dropRejectReason("group", t, "s1", ctx())).not.toBeNull();
  });
  it("削除済みグループIDを持つタスクは「グループなし」に載る", () => {
    const t = task({ id: "t", section_id: "gone" });
    expect(taskColumnKeys("group", t, ctx())).toEqual([NO_GROUP_KEY]);
  });
});
