import { describe, it, expect } from "vitest";
import type { Task } from "../../localData/types";
import { UNASSIGNED_KEY } from "../../task/assigneeMove";
import {
  addDaysYmd, buildWeekGrid, cellValue, computeWeekGridDrop, mondayOf, parseStoredWeekCount,
  parseStoredWorkloadViewMode, weekGridOverloadThreshold, weekIndexOf,
} from "../weekGrid";

const task = (o: Partial<Task> & { id: string }): Task => ({
  name: o.id, project_id: "p1", todo_ids: [], assignee_member_id: "", assignee_member_ids: [],
  status: "todo", priority: null, start_date: null, due_date: null, estimated_hours: null, comment: "", is_deleted: false,
  ...o,
});
const own = (id: string, ...ids: string[]) => ({ id, assignee_member_id: ids[0] ?? "", assignee_member_ids: ids });

// 2026-11-02 は月曜（11-08 日曜・11-09 月曜）
describe("週の計算", () => {
  it("月曜始まり：月〜日は同じ週、日曜は前の月曜", () => {
    expect(mondayOf("2026-11-02")).toBe("2026-11-02");
    expect(mondayOf("2026-11-06")).toBe("2026-11-02");
    expect(mondayOf("2026-11-08")).toBe("2026-11-02");
    expect(mondayOf("2026-11-09")).toBe("2026-11-09");
  });
  it("週の境目：日曜は今週・翌月曜は次の週。範囲の前は負", () => {
    expect(weekIndexOf("2026-11-08", "2026-11-02")).toBe(0);
    expect(weekIndexOf("2026-11-09", "2026-11-02")).toBe(1);
    expect(weekIndexOf("2026-11-01", "2026-11-02")).toBe(-1);
    expect(weekIndexOf("2026-10-26", "2026-11-02")).toBe(-1);
    expect(weekIndexOf("2026-10-25", "2026-11-02")).toBe(-2);
  });
  it("年またぎ：月曜は年をまたいでも7日刻み", () => {
    expect(mondayOf("2027-01-01")).toBe("2026-12-28");
    expect(weekIndexOf("2027-01-01", "2026-12-21")).toBe(1);
    expect(weekIndexOf("2027-01-04", "2026-12-28")).toBe(1);
    expect(addDaysYmd("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysYmd("2027-03-01", -1)).toBe("2027-02-28");
    expect(addDaysYmd("2028-02-28", 1)).toBe("2028-02-29");
  });
});

describe("buildWeekGrid", () => {
  const start = "2026-11-02";
  it("担当者×週に件数・工数を積む。共同担当は各担当者の行に出る", () => {
    const tasks = [
      task({ ...own("t1", "a"), due_date: "2026-11-04", estimated_hours: 3 }),
      task({ ...own("t2", "a", "b"), due_date: "2026-11-08", estimated_hours: 2 }),
      task({ ...own("t3", "a"), due_date: "2026-11-09" }),
    ];
    const g = buildWeekGrid(tasks, ["a", "b"], start, 4);
    const a = g.rows.find(r => r.key === "a")!;
    const b = g.rows.find(r => r.key === "b")!;
    expect(a.cells[0].count).toBe(2);
    expect(a.cells[0].hours).toBe(5);
    expect(a.cells[1].count).toBe(1);
    expect(a.cells[1].withoutEstimate).toBe(1);
    expect(a.cells[1].hours).toBe(0);
    expect(b.cells[0].tasks.map(t => t.id)).toEqual(["t2"]);
    expect(g.weeks).toEqual(["2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23"]);
  });
  it("未割り当て行は最後。期日なしと範囲外は別枠", () => {
    const tasks = [
      task({ id: "u1", due_date: "2026-11-03" }),
      task({ ...own("n1", "a") }),
      task({ ...own("o1", "a"), due_date: "2026-10-30" }),
      task({ ...own("o2", "a"), due_date: "2027-03-01" }),
    ];
    const g = buildWeekGrid(tasks, ["a"], start, 4);
    expect(g.rows.map(r => r.key)).toEqual(["a", UNASSIGNED_KEY]);
    expect(g.rows[1].cells[0].count).toBe(1);
    expect(g.rows[0].noDue.map(t => t.id)).toEqual(["n1"]);
    expect(g.rows[0].outOfRange.map(t => t.id)).toEqual(["o1", "o2"]);
    expect(g.rows[0].cells.every(c => c.count === 0)).toBe(true);
  });
  it("完了・保留・中止・削除済みと、表示外メンバーだけの担当は積まない", () => {
    const d = "2026-11-03";
    const tasks = [
      task({ ...own("x1", "a"), due_date: d, status: "done" }),
      task({ ...own("x2", "a"), due_date: d, status: "on_hold" }),
      task({ ...own("x3", "a"), due_date: d, status: "cancelled" }),
      task({ ...own("x4", "a"), due_date: d, is_deleted: true }),
      task({ ...own("x5", "zzz"), due_date: d }),
      task({ ...own("ok", "a"), due_date: d, status: "in_progress" }),
    ];
    const g = buildWeekGrid(tasks, ["a"], start, 4);
    expect(g.rows[0].cells[0].tasks.map(t => t.id)).toEqual(["ok"]);
    expect(g.rows[1].cells[0].count).toBe(0);
  });
  it("過負荷の基準：未割り当て行を除き、工数は8h下限・件数は3件下限", () => {
    const tasks = [
      task({ ...own("t1", "a"), due_date: "2026-11-03", estimated_hours: 4 }),
      task({ ...own("t2", "a"), due_date: "2026-11-04", estimated_hours: 4 }),
      task({ id: "u", due_date: "2026-11-03", estimated_hours: 100 }),
    ];
    const g = buildWeekGrid(tasks, ["a"], start, 4);
    expect(cellValue(g.rows[0].cells[0], "hours")).toBe(8);
    expect(weekGridOverloadThreshold(g, "hours")).toBe(12);
    expect(weekGridOverloadThreshold(g, "count")).toBe(3);
    const small = buildWeekGrid([task({ ...own("s", "a"), due_date: "2026-11-03", estimated_hours: 1 })], ["a"], start, 4);
    expect(weekGridOverloadThreshold(small, "hours")).toBe(8);
  });
});

describe("computeWeekGridDrop", () => {
  const base = { start_date: "2026-11-02" as string | null, due_date: "2026-11-04" as string | null };
  it("同じマスは null", () => {
    expect(computeWeekGridDrop({ ...own("t", "a"), ...base }, "a", "a", 0, 0)).toBeNull();
  });
  it("列だけ変わる：期日と開始日を週の差×7日ずらす（後ろへも前へも）", () => {
    expect(computeWeekGridDrop({ ...own("t", "a"), ...base }, "a", "a", 0, 2))
      .toEqual({ due_date: "2026-11-18", start_date: "2026-11-16" });
    expect(computeWeekGridDrop({ ...own("t", "a"), ...base }, "a", "a", 2, 1))
      .toEqual({ due_date: "2026-10-28", start_date: "2026-10-26" });
  });
  it("開始日なしは期日だけ。年をまたぐ", () => {
    expect(computeWeekGridDrop({ ...own("t", "a"), start_date: null, due_date: "2026-12-30" }, "a", "a", 0, 1))
      .toEqual({ due_date: "2027-01-06" });
  });
  it("行だけ変わる：担当者を入れ替え、日付は触らない", () => {
    expect(computeWeekGridDrop({ ...own("t", "a"), ...base }, "a", "b", 1, 1))
      .toEqual({ assignee_member_ids: ["b"], assignee_member_id: "b" });
  });
  it("複数担当：移動元だけ入れ替え／移動先が既に担当なら外すだけ", () => {
    expect(computeWeekGridDrop({ ...own("t", "a", "c"), ...base }, "a", "b", 0, 0))
      .toEqual({ assignee_member_ids: ["b", "c"], assignee_member_id: "b" });
    expect(computeWeekGridDrop({ ...own("t", "a", "b"), ...base }, "a", "b", 0, 0))
      .toEqual({ assignee_member_ids: ["b"], assignee_member_id: "b" });
  });
  it("未割り当て行との行き来と、行・列の同時変更", () => {
    expect(computeWeekGridDrop({ ...own("t"), ...base }, UNASSIGNED_KEY, "a", 0, 1))
      .toEqual({ assignee_member_ids: ["a"], assignee_member_id: "a", due_date: "2026-11-11", start_date: "2026-11-09" });
    expect(computeWeekGridDrop({ ...own("t", "a"), ...base }, "a", UNASSIGNED_KEY, 0, 0))
      .toEqual({ assignee_member_ids: [], assignee_member_id: "" });
  });
});

describe("保存値の解釈", () => {
  it("表示モード・週数は不正値なら既定", () => {
    expect(parseStoredWorkloadViewMode("week")).toBe("week");
    expect(parseStoredWorkloadViewMode("x")).toBe("list");
    expect(parseStoredWeekCount("12")).toBe(12);
    expect(parseStoredWeekCount("5")).toBe(8);
    expect(parseStoredWeekCount(null)).toBe(8);
  });
});
