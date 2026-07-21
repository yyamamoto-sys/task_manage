import { describe, it, expect } from "vitest";
import { computeOverloadRanges, OVERLOAD_THRESHOLD_DEFAULT } from "../overload";
import { getMemberActiveTasks } from "../../workload/computeWorkload";
import type { Task } from "../../localData/types";

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    name: "task",
    project_id: "pj1",
    todo_ids: [],
    assignee_member_id: "",
    assignee_member_ids: [],
    status: "todo",
    priority: null,
    start_date: null,
    due_date: null,
    estimated_hours: null,
    comment: "",
    is_deleted: false,
    ...overrides,
  };
}

const RANGE_START = new Date("2026-08-01");
const RANGE_END = new Date("2026-08-31");

describe("computeOverloadRanges", () => {
  it("1. 単純な重なりで閾値超過を検出する（既定閾値3件＝4件目から過負荷）", () => {
    const tasks = [
      makeTask({ id: "A", start_date: "2026-08-05", due_date: "2026-08-10" }),
      makeTask({ id: "B", start_date: "2026-08-05", due_date: "2026-08-10" }),
      makeTask({ id: "C", start_date: "2026-08-05", due_date: "2026-08-10" }),
      makeTask({ id: "D", start_date: "2026-08-05", due_date: "2026-08-10" }),
    ];
    const result = computeOverloadRanges(tasks, RANGE_START, RANGE_END);
    expect(result).toEqual([{ start: "2026-08-05", end: "2026-08-10" }]);
  });

  it("2. 閾値以下（同時3件まで）は過負荷にならない", () => {
    const tasks = [
      makeTask({ id: "A", start_date: "2026-08-05", due_date: "2026-08-10" }),
      makeTask({ id: "B", start_date: "2026-08-05", due_date: "2026-08-10" }),
      makeTask({ id: "C", start_date: "2026-08-05", due_date: "2026-08-10" }),
    ];
    const result = computeOverloadRanges(tasks, RANGE_START, RANGE_END, OVERLOAD_THRESHOLD_DEFAULT);
    expect(result).toEqual([]);
  });

  it("3. 連続する過負荷日は1つの区間にまとまる（複数タスクの重なりがずれても連続なら結合）", () => {
    const tasks = [
      makeTask({ id: "A", start_date: "2026-08-05", due_date: "2026-08-08" }),
      makeTask({ id: "B", start_date: "2026-08-05", due_date: "2026-08-08" }),
      makeTask({ id: "C", start_date: "2026-08-05", due_date: "2026-08-08" }),
      makeTask({ id: "D", start_date: "2026-08-07", due_date: "2026-08-12" }),
      makeTask({ id: "E", start_date: "2026-08-07", due_date: "2026-08-12" }),
      makeTask({ id: "F", start_date: "2026-08-07", due_date: "2026-08-12" }),
    ];
    // 08-05〜06：A,B,C=3件（過負荷でない）／08-07〜08：A,B,C,D,E,F=6件（過負荷）／
    // 08-09〜12：D,E,F=3件（過負荷でない）→ 過負荷日は 07〜08 の連続2日のみ、1区間にまとまる
    const result = computeOverloadRanges(tasks, RANGE_START, RANGE_END);
    expect(result).toEqual([{ start: "2026-08-07", end: "2026-08-08" }]);
  });

  it("4. 開始日なし（期日のみ）のタスクは期日の1日だけを占有する", () => {
    const tasks = [
      makeTask({ id: "A", due_date: "2026-08-15" }),
      makeTask({ id: "B", due_date: "2026-08-15" }),
      makeTask({ id: "C", due_date: "2026-08-15" }),
      makeTask({ id: "D", due_date: "2026-08-15" }),
    ];
    const result = computeOverloadRanges(tasks, RANGE_START, RANGE_END);
    expect(result).toEqual([{ start: "2026-08-15", end: "2026-08-15" }]);
  });

  it("5. done のタスクは占有カウントから除外される", () => {
    const tasks = [
      makeTask({ id: "A", start_date: "2026-08-05", due_date: "2026-08-10" }),
      makeTask({ id: "B", start_date: "2026-08-05", due_date: "2026-08-10" }),
      makeTask({ id: "C", start_date: "2026-08-05", due_date: "2026-08-10" }),
      makeTask({ id: "D", start_date: "2026-08-05", due_date: "2026-08-10", status: "done" }),
    ];
    const result = computeOverloadRanges(tasks, RANGE_START, RANGE_END);
    expect(result).toEqual([]);
  });

  it("5b. cancelled/on_hold のタスクは占有カウントから除外される（2026-07-21 ステータス拡張）", () => {
    const tasks = [
      makeTask({ id: "A", start_date: "2026-08-05", due_date: "2026-08-10" }),
      makeTask({ id: "B", start_date: "2026-08-05", due_date: "2026-08-10" }),
      makeTask({ id: "C", start_date: "2026-08-05", due_date: "2026-08-10" }),
      makeTask({ id: "D", start_date: "2026-08-05", due_date: "2026-08-10", status: "cancelled" }),
      makeTask({ id: "E", start_date: "2026-08-05", due_date: "2026-08-10", status: "on_hold" }),
    ];
    const result = computeOverloadRanges(tasks, RANGE_START, RANGE_END);
    expect(result).toEqual([]);
  });

  it("6. 担当者フィルタ：getMemberActiveTasks で絞り込んだ結果だけがそのメンバーの過負荷判定に使われる", () => {
    const allTasks = [
      makeTask({ id: "A", start_date: "2026-08-05", due_date: "2026-08-10", assignee_member_ids: ["m1"] }),
      makeTask({ id: "B", start_date: "2026-08-05", due_date: "2026-08-10", assignee_member_ids: ["m1"] }),
      makeTask({ id: "C", start_date: "2026-08-05", due_date: "2026-08-10", assignee_member_ids: ["m1"] }),
      makeTask({ id: "D", start_date: "2026-08-05", due_date: "2026-08-10", assignee_member_ids: ["m1"] }),
      // 他メンバーのタスク（m1の過負荷判定に混入してはいけない）
      makeTask({ id: "E", start_date: "2026-08-05", due_date: "2026-08-10", assignee_member_ids: ["m2"] }),
      makeTask({ id: "F", start_date: "2026-08-05", due_date: "2026-08-10", assignee_member_ids: ["m2"] }),
      makeTask({ id: "G", start_date: "2026-08-05", due_date: "2026-08-10", assignee_member_ids: ["m2"] }),
    ];
    const m1Tasks = getMemberActiveTasks("m1", allTasks);
    const m2Tasks = getMemberActiveTasks("m2", allTasks);
    expect(computeOverloadRanges(m1Tasks, RANGE_START, RANGE_END)).toEqual([{ start: "2026-08-05", end: "2026-08-10" }]);
    // m2 は3件のみ＝閾値以下なので過負荷にならない
    expect(computeOverloadRanges(m2Tasks, RANGE_START, RANGE_END)).toEqual([]);
  });

  it("7. 表示範囲（rangeStart/rangeEnd）外の占有日はクランプされ範囲外に区間がはみ出さない", () => {
    const tasks = [
      makeTask({ id: "A", start_date: "2026-07-25", due_date: "2026-09-05" }),
      makeTask({ id: "B", start_date: "2026-07-25", due_date: "2026-09-05" }),
      makeTask({ id: "C", start_date: "2026-07-25", due_date: "2026-09-05" }),
      makeTask({ id: "D", start_date: "2026-07-25", due_date: "2026-09-05" }),
    ];
    const result = computeOverloadRanges(tasks, RANGE_START, RANGE_END);
    expect(result).toEqual([{ start: "2026-08-01", end: "2026-08-31" }]);
  });

  it("8. カスタム閾値を指定できる（閾値1＝2件以上で過負荷）", () => {
    const tasks = [
      makeTask({ id: "A", start_date: "2026-08-05", due_date: "2026-08-06" }),
      makeTask({ id: "B", start_date: "2026-08-05", due_date: "2026-08-06" }),
    ];
    expect(computeOverloadRanges(tasks, RANGE_START, RANGE_END, 1)).toEqual([{ start: "2026-08-05", end: "2026-08-06" }]);
    expect(computeOverloadRanges(tasks, RANGE_START, RANGE_END, 2)).toEqual([]);
  });

  it("9. due_date が無いタスクは占有日を持たず判定から除外される", () => {
    const tasks = [
      makeTask({ id: "A", start_date: "2026-08-05", due_date: null }),
      makeTask({ id: "B", start_date: "2026-08-05", due_date: "2026-08-06" }),
      makeTask({ id: "C", start_date: "2026-08-05", due_date: "2026-08-06" }),
      makeTask({ id: "D", start_date: "2026-08-05", due_date: "2026-08-06" }),
    ];
    // due_date が無い A は占有日を持たないため、有効なのは B,C,D の3件＝閾値以下
    const result = computeOverloadRanges(tasks, RANGE_START, RANGE_END);
    expect(result).toEqual([]);
  });

  it("10. rangeStart > rangeEnd は空配列を返す", () => {
    expect(computeOverloadRanges([], RANGE_END, RANGE_START)).toEqual([]);
  });
});
