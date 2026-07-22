// src/lib/calendar/__tests__/calendarUtils.test.ts
import { describe, it, expect } from "vitest";
import { chunkIntoWeeks, assignBarLanes, computeWeekBarSegments } from "../calendarUtils";

function d(s: string): Date {
  const dt = new Date(s);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

describe("chunkIntoWeeks", () => {
  it("42セル（6週）を7日ずつ6配列に分割する", () => {
    const cells = Array.from({ length: 42 }, (_, i) => d(`2026-06-${String((i % 28) + 1).padStart(2, "0")}`));
    const weeks = chunkIntoWeeks(cells);
    expect(weeks).toHaveLength(6);
    weeks.forEach(w => expect(w).toHaveLength(7));
  });

  it("7セル（1週）を1配列に分割する", () => {
    const cells = Array.from({ length: 7 }, (_, i) => d(`2026-07-${19 + i}`));
    const weeks = chunkIntoWeeks(cells);
    expect(weeks).toHaveLength(1);
    expect(weeks[0]).toHaveLength(7);
  });
});

describe("assignBarLanes", () => {
  it("重ならないタスクは同じレーン0に割り当てる", () => {
    const lanes = assignBarLanes([
      { id: "a", start_date: "2026-07-01", due_date: "2026-07-03" },
      { id: "b", start_date: "2026-07-04", due_date: "2026-07-06" },
    ]);
    expect(lanes.get("a")).toBe(0);
    expect(lanes.get("b")).toBe(0);
  });

  it("重なるタスクは別レーンに割り当てる", () => {
    const lanes = assignBarLanes([
      { id: "a", start_date: "2026-07-01", due_date: "2026-07-05" },
      { id: "b", start_date: "2026-07-03", due_date: "2026-07-07" },
    ]);
    expect(lanes.get("a")).toBe(0);
    expect(lanes.get("b")).toBe(1);
  });

  it("3件が全て重なる場合は3レーンに分かれる", () => {
    const lanes = assignBarLanes([
      { id: "a", start_date: "2026-07-01", due_date: "2026-07-10" },
      { id: "b", start_date: "2026-07-02", due_date: "2026-07-09" },
      { id: "c", start_date: "2026-07-03", due_date: "2026-07-08" },
    ]);
    expect(new Set(lanes.values()).size).toBe(3);
  });

  it("空いたレーンを再利用する（早く終わったタスクのレーンに次のタスクが入る）", () => {
    const lanes = assignBarLanes([
      { id: "a", start_date: "2026-07-01", due_date: "2026-07-02" }, // lane0
      { id: "b", start_date: "2026-07-01", due_date: "2026-07-05" }, // lane1（aと重なる）
      { id: "c", start_date: "2026-07-03", due_date: "2026-07-04" }, // aは既に終わっている→lane0を再利用
    ]);
    expect(lanes.get("a")).toBe(0);
    expect(lanes.get("b")).toBe(1);
    expect(lanes.get("c")).toBe(0);
  });

  it("開始日が無いタスクは対象外", () => {
    const lanes = assignBarLanes([{ id: "a", start_date: null, due_date: "2026-07-03" }]);
    expect(lanes.has("a")).toBe(false);
  });

  it("期日が無いタスクは対象外", () => {
    const lanes = assignBarLanes([{ id: "a", start_date: "2026-07-01", due_date: undefined }]);
    expect(lanes.has("a")).toBe(false);
  });

  it("開始日が期日より後（無効な範囲）のタスクは対象外", () => {
    const lanes = assignBarLanes([{ id: "a", start_date: "2026-07-10", due_date: "2026-07-01" }]);
    expect(lanes.has("a")).toBe(false);
  });

  it("開始日と期日が同日のタスクは1日分として扱う", () => {
    const lanes = assignBarLanes([{ id: "a", start_date: "2026-07-01", due_date: "2026-07-01" }]);
    expect(lanes.get("a")).toBe(0);
  });
});

describe("computeWeekBarSegments", () => {
  const weekStart = d("2026-07-19"); // 日
  const weekEnd = d("2026-07-25"); // 土

  it("週の途中で完結する3日間タスク（月曜〜水曜=週内2〜4日目）の座標を計算する", () => {
    const lanes = new Map([["a", 0]]);
    const segs = computeWeekBarSegments(weekStart, weekEnd, [
      { id: "a", start_date: "2026-07-20", due_date: "2026-07-22" },
    ], lanes);
    expect(segs).toHaveLength(1);
    expect(segs[0].leftPct).toBeCloseTo((1 / 7) * 100); // 月曜=週内1日目(0始まり)
    expect(segs[0].widthPct).toBeCloseTo((3 / 7) * 100); // 20,21,22の3日
    expect(segs[0].lane).toBe(0);
  });

  it("週をまたぐタスクは、この週分だけがクランプされて座標化される", () => {
    const lanes = new Map([["a", 0]]);
    // 前週の金曜〜今週の火曜（week内では日曜〜火曜の3日だけが対象）
    const segs = computeWeekBarSegments(weekStart, weekEnd, [
      { id: "a", start_date: "2026-07-17", due_date: "2026-07-21" },
    ], lanes);
    expect(segs).toHaveLength(1);
    expect(segs[0].leftPct).toBe(0); // 週の先頭(日曜)からクランプ
    expect(segs[0].widthPct).toBeCloseTo((3 / 7) * 100); // 19,20,21の3日
  });

  it("次週にまたがる部分は次週側の呼び出しで別セグメントとして計算される", () => {
    const lanes = new Map([["a", 0]]);
    const nextWeekStart = d("2026-07-26");
    const nextWeekEnd = d("2026-08-01");
    const segs = computeWeekBarSegments(nextWeekStart, nextWeekEnd, [
      { id: "a", start_date: "2026-07-24", due_date: "2026-07-27" },
    ], lanes);
    expect(segs).toHaveLength(1);
    expect(segs[0].leftPct).toBe(0); // 次週の先頭からクランプ
    expect(segs[0].widthPct).toBeCloseTo((2 / 7) * 100); // 26,27の2日
  });

  it("この週と全く重ならないタスクはセグメントを返さない", () => {
    const lanes = new Map([["a", 0]]);
    const segs = computeWeekBarSegments(weekStart, weekEnd, [
      { id: "a", start_date: "2026-08-01", due_date: "2026-08-03" },
    ], lanes);
    expect(segs).toHaveLength(0);
  });

  it("開始日のみ（期日なし）のタスクはセグメントを返さない", () => {
    const lanes = new Map([["a", 0]]);
    const segs = computeWeekBarSegments(weekStart, weekEnd, [
      { id: "a", start_date: "2026-07-20", due_date: null },
    ], lanes);
    expect(segs).toHaveLength(0);
  });

  it("期日のみ（開始日なし）のタスクはセグメントを返さない", () => {
    const lanes = new Map([["a", 0]]);
    const segs = computeWeekBarSegments(weekStart, weekEnd, [
      { id: "a", start_date: null, due_date: "2026-07-22" },
    ], lanes);
    expect(segs).toHaveLength(0);
  });

  it("lanesに登録が無いタスク（assignBarLanesで除外された等）はセグメントを返さない", () => {
    const segs = computeWeekBarSegments(weekStart, weekEnd, [
      { id: "a", start_date: "2026-07-20", due_date: "2026-07-22" },
    ], new Map());
    expect(segs).toHaveLength(0);
  });

  it("週全体を覆うタスクはleftPct=0・widthPct=100になる", () => {
    const lanes = new Map([["a", 0]]);
    const segs = computeWeekBarSegments(weekStart, weekEnd, [
      { id: "a", start_date: "2026-07-01", due_date: "2026-08-01" },
    ], lanes);
    expect(segs[0].leftPct).toBe(0);
    expect(segs[0].widthPct).toBeCloseTo(100);
  });
});
