// applyRemoteChange の堅牢化（v3.148・CLAUDE.md Section 76）：重ねる更新（TOAST列）・古さ判定・間引いた再取得の契機。
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAppStore, isStaleRemoteUpdate, shouldResyncOnRemoteChange, setRemoteResyncRequester, _resetRemoteStateForTest } from "../appStore";
import type { RealtimeChange } from "../appStore";

const ev = (table: string, eventType: "INSERT" | "UPDATE" | "DELETE", row: Record<string, unknown>): RealtimeChange => ({
  table, eventType,
  new: eventType === "DELETE" ? null : row,
  old: eventType === "DELETE" ? row : null,
});
const apply = (e: RealtimeChange) => useAppStore.getState().applyRemoteChange(e);

beforeEach(() => {
  _resetRemoteStateForTest();
  useAppStore.setState({ tasks: [], projects: [], todos: [], milestones: [], members: [], taskProjects: [], taskTaskForces: [], projectTaskForces: [], taskDependencies: [], keyResults: [], taskForces: [] });
});

describe("UPDATE は既存の行に重ねる（TOAST 列が載らなくても既存値を消さない）", () => {
  it("new に comment が無ければ既存の comment を残し、変わった列だけ反映する", () => {
    apply(ev("tasks", "INSERT", { id: "t1", name: "A", comment: "長い本文", todo_ids: ["td1"], tags: ["x"], assignee_member_ids: ["m1"], updated_at: "2026-10-14T00:00:00Z" }));
    apply(ev("tasks", "UPDATE", { id: "t1", name: "B", updated_at: "2026-10-14T00:00:05Z" }));
    const t = useAppStore.getState().tasks[0];
    expect(t.name).toBe("B");
    expect(t.comment).toBe("長い本文");
    expect(t.todo_ids).toEqual(["td1"]);
    expect(t.tags).toEqual(["x"]);
    expect(t.assignee_member_ids).toEqual(["m1"]);
  });
  it("new で明示的に null になった列は null にする（キーの有無で判定）", () => {
    apply(ev("tasks", "INSERT", { id: "t1", name: "A", due_date: "2026-10-20", updated_at: "2026-10-14T00:00:00Z" }));
    apply(ev("tasks", "UPDATE", { id: "t1", due_date: null, updated_at: "2026-10-14T00:00:05Z" }));
    expect(useAppStore.getState().tasks[0].due_date).toBeNull();
  });
  it("projects も同様（member_ids が載らない UPDATE で消えない）", () => {
    apply(ev("projects", "INSERT", { id: "p1", name: "P", member_ids: ["m1"], owner_member_ids: ["m1"], updated_at: "2026-10-14T00:00:00Z" }));
    apply(ev("projects", "UPDATE", { id: "p1", name: "P2", updated_at: "2026-10-14T00:00:05Z" }));
    const p = useAppStore.getState().projects[0];
    expect(p.name).toBe("P2");
    expect(p.member_ids).toEqual(["m1"]);
  });
});

describe("古さ判定は Date.parse の数値比較・同値は後から届いた方を採る", () => {
  it("isStaleRemoteUpdate：書式が違っても同じ瞬間は古くない／手元が新しいときだけ古い", () => {
    expect(isStaleRemoteUpdate("2026-10-14T00:00:00Z", "2026-10-14T00:00:00+00:00")).toBe(false);
    expect(isStaleRemoteUpdate("2026-10-14T00:00:01.000Z", "2026-10-14T09:00:00+09:00")).toBe(true);
    expect(isStaleRemoteUpdate("2026-10-14T00:00:00Z", "2026-10-14T00:00:01Z")).toBe(false);
    expect(isStaleRemoteUpdate(undefined, "2026-10-14T00:00:01Z")).toBe(false);
    expect(isStaleRemoteUpdate("2026-10-14T00:00:00Z", "壊れた値")).toBe(false);
  });
  it("文字列比較では逆転する書式（+09:00 と Z）でも正しく古いものを捨てる", () => {
    // 手元 = 2026-10-14T00:00:00Z（= 09:00+09:00）、届いた行 = 2026-10-13T23:59:59Z（= "2026-10-14T08:59:59+09:00"）
    apply(ev("tasks", "INSERT", { id: "t1", name: "新", updated_at: "2026-10-14T00:00:00Z" }));
    apply(ev("tasks", "UPDATE", { id: "t1", name: "旧", updated_at: "2026-10-14T08:59:59+09:00" }));
    expect(useAppStore.getState().tasks[0].name).toBe("新");
  });
  it("同値（同じトランザクションで2回 UPDATE）は後から届いた内容を採る", () => {
    apply(ev("tasks", "INSERT", { id: "t1", name: "1回目", updated_at: "2026-10-14T00:00:00Z" }));
    apply(ev("tasks", "UPDATE", { id: "t1", name: "2回目", updated_at: "2026-10-14T00:00:00Z" }));
    expect(useAppStore.getState().tasks[0].name).toBe("2回目");
  });
  it("自分の保存が realtime で戻ってきた（内容も同じ）ときは配列の参照を変えない", () => {
    apply(ev("tasks", "INSERT", { id: "t1", name: "A", updated_at: "2026-10-14T00:00:00Z" }));
    const before = useAppStore.getState().tasks;
    apply(ev("tasks", "UPDATE", { id: "t1", name: "A", updated_at: "2026-10-14T00:00:00Z" }));
    expect(useAppStore.getState().tasks).toBe(before);
  });
  it("より古い UPDATE は無視する（自分の楽観更新を古いエコーで戻さない）", () => {
    apply(ev("tasks", "INSERT", { id: "t1", name: "最新", updated_at: "2026-10-14T00:00:10Z" }));
    apply(ev("tasks", "UPDATE", { id: "t1", name: "古い", updated_at: "2026-10-14T00:00:05Z" }));
    expect(useAppStore.getState().tasks[0].name).toBe("最新");
  });
});

describe("shouldResyncOnRemoteChange：差分だけでは関連データが揃わない変更", () => {
  const projects = [{ id: "p1", member_ids: ["m1", "m2"], group_ids: ["g1"], owner_member_ids: ["m1"], owner_member_id: "m1", group_id: "g1" }];
  const state = { tasks: [{ id: "t1" }], projects };
  it("tasks/projects の DELETE は要求する", () => {
    expect(shouldResyncOnRemoteChange(ev("tasks", "DELETE", { id: "t1" }), state)).toBe(true);
    expect(shouldResyncOnRemoteChange(ev("projects", "DELETE", { id: "p1" }), state)).toBe(true);
  });
  it("手元に無い id の UPDATE（見える範囲が広がった）は要求する。INSERT は要求しない", () => {
    expect(shouldResyncOnRemoteChange(ev("tasks", "UPDATE", { id: "tX" }), state)).toBe(true);
    expect(shouldResyncOnRemoteChange(ev("projects", "UPDATE", { id: "pX" }), state)).toBe(true);
    expect(shouldResyncOnRemoteChange(ev("tasks", "INSERT", { id: "tX" }), state)).toBe(false);
  });
  it("既知のタスクの通常の UPDATE は要求しない", () => {
    expect(shouldResyncOnRemoteChange(ev("tasks", "UPDATE", { id: "t1", name: "x" }), state)).toBe(false);
  });
  it("projects の UPDATE は、部署・メンバー・オーナーが変わったときだけ要求する（配列の並びは問わない）", () => {
    expect(shouldResyncOnRemoteChange(ev("projects", "UPDATE", { id: "p1", name: "x" }), state)).toBe(false);
    expect(shouldResyncOnRemoteChange(ev("projects", "UPDATE", { id: "p1", member_ids: ["m2", "m1"] }), state)).toBe(false);
    expect(shouldResyncOnRemoteChange(ev("projects", "UPDATE", { id: "p1", member_ids: ["m1", "m2", "m3"] }), state)).toBe(true);
    expect(shouldResyncOnRemoteChange(ev("projects", "UPDATE", { id: "p1", group_ids: ["g1", "g2"] }), state)).toBe(true);
    expect(shouldResyncOnRemoteChange(ev("projects", "UPDATE", { id: "p1", owner_member_id: "m9" }), state)).toBe(true);
    expect(shouldResyncOnRemoteChange(ev("projects", "UPDATE", { id: "p1", group_id: "g2" }), state)).toBe(true);
  });
  it("tasks/projects 以外の表は要求しない", () => {
    expect(shouldResyncOnRemoteChange(ev("milestones", "DELETE", { id: "m" }), state)).toBe(false);
    expect(shouldResyncOnRemoteChange(ev("task_projects", "DELETE", { task_id: "t", project_id: "p" }), state)).toBe(false);
  });
});

describe("applyRemoteChange → 要求先（間引いた load）", () => {
  it("要求すべき変更でだけ要求先を呼び、通常の差分では呼ばない（load() を直接呼ばない）", () => {
    const spy = vi.fn();
    setRemoteResyncRequester(spy);
    apply(ev("tasks", "INSERT", { id: "t1", name: "A", updated_at: "2026-10-14T00:00:00Z" }));
    apply(ev("tasks", "UPDATE", { id: "t1", name: "B", updated_at: "2026-10-14T00:00:05Z" }));
    expect(spy).not.toHaveBeenCalled();
    apply(ev("tasks", "UPDATE", { id: "tZ", name: "未登録", updated_at: "2026-10-14T00:00:05Z" }));
    expect(spy).toHaveBeenCalledTimes(1);
    apply(ev("tasks", "DELETE", { id: "t1" }));
    expect(spy).toHaveBeenCalledTimes(2);
  });
  it("要求先が未設定（null）でも落ちない", () => {
    expect(() => apply(ev("tasks", "DELETE", { id: "t1" }))).not.toThrow();
  });
});
