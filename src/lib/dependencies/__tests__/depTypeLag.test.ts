// 依存の種類（FS/SS/FF/SF）とずらし日数（v3.197）：制約の一般化・旧データの読み取り・ゲート・ラベル。
import { describe, it, expect } from "vitest";
import type { Task, TaskDependency } from "../../localData/types";
import { computeCascadeShifts } from "../reschedule";
import { getIncompletePredecessors } from "../gate";
import { depTypeOf, lagOf, formatDepLabel, normalizeLag } from "../depType";
import { buildTypedDependencyPoints, computeDependencyRenders, ARROW_KICK } from "../../../components/gantt/ganttDependencyArrows";

function task(id: string, start: string | null, due: string | null, extra: Partial<Task> = {}): Task {
  return {
    id, name: id, project_id: "p", todo_ids: [], assignee_member_id: "", assignee_member_ids: [],
    status: "todo", priority: null, start_date: start, due_date: due, estimated_hours: null,
    comment: "", is_deleted: false, ...extra,
  };
}
function dep(pred: string, succ: string, extra: Partial<TaskDependency> = {}): TaskDependency {
  return { id: `${pred}-${succ}`, predecessor_task_id: pred, successor_task_id: succ, is_deleted: false, ...extra };
}
// 先行 A：10/10〜10/20。後続 B：作業期間 4 日。
const A = task("A", "2026-10-10", "2026-10-20");
const shiftOf = (b: Task, d: TaskDependency) => {
  const r = computeCascadeShifts("A", [A, b], [d]);
  return r.length ? { start: r[0].newStart, due: r[0].newDue } : null;
};

describe("旧データ（列なし）の読み取り", () => {
  it("dep_type / lag_days が undefined・null・不正値なら FS／0", () => {
    expect(depTypeOf({})).toBe("FS");
    expect(lagOf({})).toBe(0);
    expect(depTypeOf({ dep_type: null as unknown as undefined })).toBe("FS");
    expect(depTypeOf({ dep_type: "XX" as never })).toBe("FS");
    expect(lagOf({ lag_days: null as unknown as undefined })).toBe(0);
  });
  it("ラベル：FS／0 は出さず、それ以外は 種類+ラグ", () => {
    expect(formatDepLabel({})).toBeNull();
    expect(formatDepLabel({ dep_type: "SS", lag_days: 2 })).toBe("SS+2d");
    expect(formatDepLabel({ dep_type: "FF", lag_days: -1 })).toBe("FF-1d");
    expect(formatDepLabel({ dep_type: "SF", lag_days: 0 })).toBe("SF");
    expect(formatDepLabel({ dep_type: "FS", lag_days: 3 })).toBe("FS+3d");
  });
  it("normalizeLag は整数化・不正値0・上限クランプ", () => {
    expect(normalizeLag("2.7")).toBe(2);
    expect(normalizeLag("-3")).toBe(-3);
    expect(normalizeLag("abc")).toBe(0);
    expect(normalizeLag(999999)).toBe(3650);
  });
});

describe("自動リスケ：FS（回帰）", () => {
  const B = task("B", "2026-10-15", "2026-10-19"); // 先行の期日 10/20 に食い込む
  it("列なし（旧データ）は従来どおり FS／0：start を先行の due へ、作業期間保持", () => {
    expect(shiftOf(B, dep("A", "B"))).toEqual({ start: "2026-10-20", due: "2026-10-24" });
  });
  it("明示 FS／0 も同じ", () => {
    expect(shiftOf(B, dep("A", "B", { dep_type: "FS", lag_days: 0 }))).toEqual({ start: "2026-10-20", due: "2026-10-24" });
  });
  it("同日開始は動かさない（ギャップ強制なし）", () => {
    expect(shiftOf(task("B", "2026-10-20", "2026-10-24"), dep("A", "B"))).toBeNull();
  });
  it("先行が前倒しでも引き寄せない", () => {
    expect(shiftOf(task("B", "2026-10-25", "2026-10-29"), dep("A", "B"))).toBeNull();
  });
});

describe("自動リスケ：4種×ラグ（正・0・負）", () => {
  // B の作業期間は 4 日（start→due）。違反するように B を置いて必要な押し量を確認する。
  it("FS＋3：start >= 先行.due+3 = 10/23", () => {
    expect(shiftOf(task("B", "2026-10-20", "2026-10-24"), dep("A", "B", { dep_type: "FS", lag_days: 3 }))).toEqual({ start: "2026-10-23", due: "2026-10-27" });
  });
  it("FS−2（リード）：10/18 まで食い込んでよい", () => {
    expect(shiftOf(task("B", "2026-10-18", "2026-10-22"), dep("A", "B", { dep_type: "FS", lag_days: -2 }))).toBeNull();
    expect(shiftOf(task("B", "2026-10-16", "2026-10-20"), dep("A", "B", { dep_type: "FS", lag_days: -2 }))).toEqual({ start: "2026-10-18", due: "2026-10-22" });
  });
  it("SS／0：start >= 先行.start = 10/10", () => {
    expect(shiftOf(task("B", "2026-10-10", "2026-10-14"), dep("A", "B", { dep_type: "SS", lag_days: 0 }))).toBeNull();
    expect(shiftOf(task("B", "2026-10-05", "2026-10-09"), dep("A", "B", { dep_type: "SS", lag_days: 0 }))).toEqual({ start: "2026-10-10", due: "2026-10-14" });
  });
  it("SS＋2：start >= 10/12", () => {
    expect(shiftOf(task("B", "2026-10-10", "2026-10-14"), dep("A", "B", { dep_type: "SS", lag_days: 2 }))).toEqual({ start: "2026-10-12", due: "2026-10-16" });
  });
  it("SS−3：start >= 10/07（以降なら動かさない）", () => {
    expect(shiftOf(task("B", "2026-10-07", "2026-10-11"), dep("A", "B", { dep_type: "SS", lag_days: -3 }))).toBeNull();
    expect(shiftOf(task("B", "2026-10-05", "2026-10-09"), dep("A", "B", { dep_type: "SS", lag_days: -3 }))).toEqual({ start: "2026-10-07", due: "2026-10-11" });
  });
  it("FF／0：due >= 先行.due = 10/20（start ではなく due で判定）", () => {
    expect(shiftOf(task("B", "2026-10-16", "2026-10-20"), dep("A", "B", { dep_type: "FF" }))).toBeNull();
    expect(shiftOf(task("B", "2026-10-12", "2026-10-16"), dep("A", "B", { dep_type: "FF" }))).toEqual({ start: "2026-10-16", due: "2026-10-20" });
  });
  it("FF＋1：due >= 10/21", () => {
    expect(shiftOf(task("B", "2026-10-16", "2026-10-20"), dep("A", "B", { dep_type: "FF", lag_days: 1 }))).toEqual({ start: "2026-10-17", due: "2026-10-21" });
  });
  it("FF−2：due >= 10/18", () => {
    expect(shiftOf(task("B", "2026-10-14", "2026-10-18"), dep("A", "B", { dep_type: "FF", lag_days: -2 }))).toBeNull();
    expect(shiftOf(task("B", "2026-10-12", "2026-10-16"), dep("A", "B", { dep_type: "FF", lag_days: -2 }))).toEqual({ start: "2026-10-14", due: "2026-10-18" });
  });
  it("SF／0：due >= 先行.start = 10/10", () => {
    expect(shiftOf(task("B", "2026-10-06", "2026-10-10"), dep("A", "B", { dep_type: "SF" }))).toBeNull();
    expect(shiftOf(task("B", "2026-10-04", "2026-10-08"), dep("A", "B", { dep_type: "SF" }))).toEqual({ start: "2026-10-06", due: "2026-10-10" });
  });
  it("SF＋2：due >= 10/12", () => {
    expect(shiftOf(task("B", "2026-10-06", "2026-10-10"), dep("A", "B", { dep_type: "SF", lag_days: 2 }))).toEqual({ start: "2026-10-08", due: "2026-10-12" });
  });
  it("SF−1：due >= 10/09", () => {
    expect(shiftOf(task("B", "2026-10-05", "2026-10-09"), dep("A", "B", { dep_type: "SF", lag_days: -1 }))).toBeNull();
  });
  it("複数先行は最大の押し量を採る（FS と SS の混在）", () => {
    const C = task("C", "2026-10-12", "2026-10-30");
    const B = task("B", "2026-10-10", "2026-10-14");
    const r = computeCascadeShifts("A", [A, C, B], [
      dep("A", "B", { dep_type: "SS", lag_days: 1 }),  // start >= 10/11（+1）
      dep("C", "B"),                                    // start >= C.due 10/30（+20）
    ]);
    expect(r[0]).toMatchObject({ taskId: "B", newStart: "2026-10-30", newDue: "2026-11-03" });
  });
  it("連鎖：SS で押された後続の新しい start が、さらに後続の SS 制約へ伝わる", () => {
    const B = task("B", "2026-10-05", "2026-10-09");
    const C = task("C", "2026-10-05", "2026-10-08");
    const r = computeCascadeShifts("A", [A, B, C], [
      dep("A", "B", { dep_type: "SS" }), dep("B", "C", { dep_type: "SS", lag_days: 1 }),
    ]);
    expect(r.map(s => [s.taskId, s.newStart])).toEqual([["B", "2026-10-10"], ["C", "2026-10-11"]]);
  });
  it("基準側の日付が無い先行は無視（SS で先行に start が無い）", () => {
    const A2 = task("A", null, "2026-10-20");
    expect(computeCascadeShifts("A", [A2, task("B", "2026-10-05", "2026-10-09")], [dep("A", "B", { dep_type: "SS" })])).toEqual([]);
  });
});

describe("ゲート（完了ブロック／着手警告）の種類別扱い", () => {
  const tasks = [task("A", null, null), task("B", null, null)];
  it("FS・FF は完了ブロック対象、SS・SF は対象外", () => {
    for (const [t, n] of [["FS", 1], ["FF", 1], ["SS", 0], ["SF", 0]] as const) {
      expect(getIncompletePredecessors("B", tasks, [dep("A", "B", { dep_type: t })]).length).toBe(n);
    }
    expect(getIncompletePredecessors("B", tasks, [dep("A", "B")]).length).toBe(1); // 旧データ
  });
  it("着手警告は FS のみ", () => {
    expect(getIncompletePredecessors("B", tasks, [dep("A", "B", { dep_type: "FF" })], "start").length).toBe(0);
    expect(getIncompletePredecessors("B", tasks, [dep("A", "B", { dep_type: "FS" })], "start").length).toBe(1);
  });
});

describe("矢印の端点", () => {
  const pred = { x: 100, y: 0, width: 50, height: 20 };   // 始端100・終端150・中央y=10
  const succ = { x: 300, y: 40, width: 60, height: 20 };  // 始端300・終端360・中央y=50
  it("FS：先行終端→後続始端", () => {
    const pts = buildTypedDependencyPoints("FS", pred, succ);
    expect(pts[0]).toEqual({ x: 150, y: 10 });
    expect(pts[pts.length - 1]).toEqual({ x: 300, y: 50 });
  });
  it("SS：始端→始端", () => {
    const pts = buildTypedDependencyPoints("SS", pred, succ);
    expect(pts[0]).toEqual({ x: 100, y: 10 });
    expect(pts[pts.length - 1]).toEqual({ x: 300, y: 50 });
    expect(pts[1].x).toBe(100 - ARROW_KICK);
  });
  it("FF：終端→終端", () => {
    const pts = buildTypedDependencyPoints("FF", pred, succ);
    expect(pts[0]).toEqual({ x: 150, y: 10 });
    expect(pts[pts.length - 1]).toEqual({ x: 360, y: 50 });
    expect(pts[1].x).toBe(360 + ARROW_KICK);
  });
  it("SF：先行始端→後続終端", () => {
    const pts = buildTypedDependencyPoints("SF", pred, succ);
    expect(pts[0]).toEqual({ x: 100, y: 10 });
    expect(pts[pts.length - 1]).toEqual({ x: 360, y: 50 });
  });
  it("computeDependencyRenders：ラベルは FS／0 で null、それ以外は 種類+ラグ", () => {
    const rects = new Map([["A", pred], ["B", succ]]);
    const r1 = computeDependencyRenders([dep("A", "B")], rects);
    expect(r1.arrows[0].label).toBeNull();
    const r2 = computeDependencyRenders([dep("A", "B", { dep_type: "SS", lag_days: 2 })], rects);
    expect(r2.arrows[0].label).toBe("SS+2d");
    expect(r2.arrows[0].points[0]).toEqual({ x: 100, y: 10 });
  });
});

import { buildInheritedDependencies } from "../../project/taskInheritance";
describe("複製・PJ引き継ぎで種類とラグを引き継ぐ", () => {
  it("SS+2 は新タスクIDの組へそのまま引き継がれる", () => {
    const idMap = new Map([["A", "nA"], ["B", "nB"]]);
    expect(buildInheritedDependencies([dep("A", "B", { dep_type: "SS", lag_days: 2 })], idMap))
      .toEqual([{ predecessorTaskId: "nA", successorTaskId: "nB", depType: "SS", lagDays: 2 }]);
  });
});
