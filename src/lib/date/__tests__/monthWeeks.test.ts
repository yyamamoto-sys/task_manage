// src/lib/date/__tests__/monthWeeks.test.ts
//
// 【設計意図】
// computeMonthWeekSegments（月→週セグメント抽出。ganttUtils.ts のカレンダー週計算を移動）の
// 回帰テスト。月初の曜日パターン（日曜/月曜/土曜）・W1が1日だけになるケース・5週/6週になる月・
// 月末が週の途中で終わるケースを実カレンダー（2026年）で検証する。

import { describe, expect, it } from "vitest";
import { calendarWeekNumber, computeMonthWeekSegments } from "../monthWeeks";
import { toDateStr } from "../../date";

function seg(monthStr: string) {
  const [y, m] = monthStr.split("-").map(Number);
  return computeMonthWeekSegments(new Date(y, m - 1, 1));
}

function labels(segments: ReturnType<typeof seg>) {
  return segments.map(s => ({
    weekIndex: s.weekIndex,
    start: toDateStr(s.weekStart),
    end: toDateStr(s.weekEnd),
  }));
}

describe("calendarWeekNumber", () => {
  it("月初が日曜なら1日目からW1", () => {
    expect(calendarWeekNumber(new Date(2026, 1, 1))).toBe(1); // 2026-02-01 Sun
  });
  it("月初が月曜ならW1は満週（7日）", () => {
    expect(calendarWeekNumber(new Date(2026, 5, 1))).toBe(1); // 2026-06-01 Mon
    expect(calendarWeekNumber(new Date(2026, 5, 7))).toBe(1); // 2026-06-07 Sun（W1の最終日）
    expect(calendarWeekNumber(new Date(2026, 5, 8))).toBe(2); // 2026-06-08 Mon（W2の初日）
  });
});

describe("computeMonthWeekSegments", () => {
  it("月初が日曜のケース（2026-02）：W1が1日だけになり、5週になる月になる", () => {
    // 2026-02-01は日曜、28日まで（非うるう年）
    const segments = seg("2026-02");
    expect(segments).toHaveLength(5);
    expect(labels(segments)).toEqual([
      { weekIndex: 1, start: "2026-02-01", end: "2026-02-01" }, // W1は1日だけ
      { weekIndex: 2, start: "2026-02-02", end: "2026-02-08" },
      { weekIndex: 3, start: "2026-02-09", end: "2026-02-15" },
      { weekIndex: 4, start: "2026-02-16", end: "2026-02-22" },
      { weekIndex: 5, start: "2026-02-23", end: "2026-02-28" }, // 月末は週の途中（土曜）で終わる
    ]);
  });

  it("月初が月曜のケース（2026-06）：W1が満週になり、月末が週の途中で終わる", () => {
    // 2026-06-01は月曜、30日まで
    const segments = seg("2026-06");
    expect(segments).toHaveLength(5);
    expect(labels(segments)).toEqual([
      { weekIndex: 1, start: "2026-06-01", end: "2026-06-07" }, // 月初が月曜なのでW1から満週
      { weekIndex: 2, start: "2026-06-08", end: "2026-06-14" },
      { weekIndex: 3, start: "2026-06-15", end: "2026-06-21" },
      { weekIndex: 4, start: "2026-06-22", end: "2026-06-28" },
      { weekIndex: 5, start: "2026-06-29", end: "2026-06-30" }, // 月末（火曜）で途中終了
    ]);
  });

  it("月初が土曜のケース（2026-08）：W1が2日だけになり、6週になる月になる", () => {
    // 2026-08-01は土曜、31日まで
    const segments = seg("2026-08");
    expect(segments).toHaveLength(6);
    expect(labels(segments)).toEqual([
      { weekIndex: 1, start: "2026-08-01", end: "2026-08-02" },
      { weekIndex: 2, start: "2026-08-03", end: "2026-08-09" },
      { weekIndex: 3, start: "2026-08-10", end: "2026-08-16" },
      { weekIndex: 4, start: "2026-08-17", end: "2026-08-23" },
      { weekIndex: 5, start: "2026-08-24", end: "2026-08-30" },
      { weekIndex: 6, start: "2026-08-31", end: "2026-08-31" }, // 月末（月曜）が単独の週になる
    ]);
  });

  it("週インデックスは1始まりで連番になる", () => {
    const segments = seg("2026-06");
    expect(segments.map(s => s.weekIndex)).toEqual([1, 2, 3, 4, 5]);
  });

  it("全セグメントの日数の合計が月の日数と一致する", () => {
    const segments = seg("2026-08"); // 31日
    const totalDays = segments.reduce(
      (sum, s) => sum + (s.weekEnd.getTime() - s.weekStart.getTime()) / 86400000 + 1,
      0,
    );
    expect(totalDays).toBe(31);
  });
});
