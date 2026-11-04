import { describe, it, expect } from "vitest";
import type { MemberWorkloadRow } from "../computeWorkload";
import { overloadThreshold, sortWorkloadRows, workloadValue, parseStoredWorkloadUnit, OVERLOAD_MIN_HOURS } from "../workloadMetric";

const row = (id: string, active: number, hours: number | null, without = 0): MemberWorkloadRow => ({
  member_id: id, short_name: id, todo_count: active, in_progress_count: 0, active_count: active,
  total_estimated_hours: hours, tasks_with_estimate: hours === null ? 0 : active - without,
  tasks_without_estimate: without, overdue_count: 0,
});

describe("workloadMetric", () => {
  it("値：件数モード＝アクティブ件数／工数モード＝工数合計（未入力のみは0）", () => {
    expect(workloadValue(row("a", 5, 12), "count")).toBe(5);
    expect(workloadValue(row("a", 5, 12), "hours")).toBe(12);
    expect(workloadValue(row("a", 5, null, 5), "hours")).toBe(0);
  });
  it("過負荷の閾値：件数は下限3・工数は下限8h・平均の1.5倍が上回ればそちら", () => {
    expect(overloadThreshold([1, 1, 0], "count")).toBe(3);
    expect(overloadThreshold([4, 4, 4], "count")).toBe(6);
    expect(overloadThreshold([2, 1, 0], "hours")).toBe(OVERLOAD_MIN_HOURS);
    expect(overloadThreshold([20, 10], "hours")).toBe(22.5);
    expect(overloadThreshold([], "hours")).toBe(OVERLOAD_MIN_HOURS);
  });
  it("並び順：工数モードは工数の降順（同値は件数の降順）", () => {
    const rows = [row("a", 9, 2), row("b", 1, 30), row("c", 3, 0), row("d", 5, null, 5)];
    expect(sortWorkloadRows(rows, "hours").map(r => r.member_id)).toEqual(["b", "a", "d", "c"]);
    expect(sortWorkloadRows(rows, "count").map(r => r.member_id)).toEqual(["a", "d", "c", "b"]);
  });
  it("保存値：hours 以外は count", () => {
    expect(parseStoredWorkloadUnit("hours")).toBe("hours");
    expect(parseStoredWorkloadUnit(null)).toBe("count");
    expect(parseStoredWorkloadUnit("x")).toBe("count");
  });
});
