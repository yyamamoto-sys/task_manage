// src/lib/releaseNotes/__tests__/groupByMonth.test.ts
import { describe, it, expect } from "vitest";
import type { ReleaseNoteEntry } from "../../releaseNotes";
import { groupReleaseNotesByMonth, monthKeyOf, monthLabelOf, defaultOpenMonthKeys } from "../groupByMonth";

const ENTRIES: ReleaseNoteEntry[] = [
  { version: "v3.10", date: "2026-08-10", title: "8月2件目", highlights: ["x"] },
  { version: "v3.05", date: "2026-08-01", title: "8月1件目", highlights: ["x"] },
  { version: "v3.00", date: "2026-07-15", title: "7月1件目", highlights: ["x"] },
  { version: "v2.90", date: "2026-05-01", title: "5月1件目", highlights: ["x"] },
];

describe("monthKeyOf / monthLabelOf", () => {
  it("YYYY-MM-DDからYYYY-MMを取り出す", () => {
    expect(monthKeyOf("2026-08-10")).toBe("2026-08");
  });

  it("YYYY-MMをYYYY年M月の表示ラベルに変換する（先頭0を落とす）", () => {
    expect(monthLabelOf("2026-08")).toBe("2026年8月");
    expect(monthLabelOf("2026-01")).toBe("2026年1月");
  });

  it("不正な形式はそのまま返す", () => {
    expect(monthLabelOf("invalid")).toBe("invalid");
    expect(monthLabelOf("2026-13")).toBe("2026-13");
  });
});

describe("groupReleaseNotesByMonth", () => {
  it("新しい順のエントリを、隣接する同じ月ごとにグループ化する", () => {
    const groups = groupReleaseNotesByMonth(ENTRIES);
    expect(groups.map(g => g.monthKey)).toEqual(["2026-08", "2026-07", "2026-05"]);
    expect(groups[0].entries.map(e => e.version)).toEqual(["v3.10", "v3.05"]);
    expect(groups[1].entries.map(e => e.version)).toEqual(["v3.00"]);
    expect(groups[2].entries.map(e => e.version)).toEqual(["v2.90"]);
  });

  it("各グループにYYYY年M月の表示ラベルを持つ", () => {
    const groups = groupReleaseNotesByMonth(ENTRIES);
    expect(groups.map(g => g.label)).toEqual(["2026年8月", "2026年7月", "2026年5月"]);
  });

  it("空配列は空配列を返す", () => {
    expect(groupReleaseNotesByMonth([])).toEqual([]);
  });

  it("全件が同じ月なら1グループにまとまる", () => {
    const sameMonth: ReleaseNoteEntry[] = [
      { version: "v1", date: "2026-08-10", title: "a", highlights: ["x"] },
      { version: "v2", date: "2026-08-05", title: "b", highlights: ["x"] },
      { version: "v3", date: "2026-08-01", title: "c", highlights: ["x"] },
    ];
    const groups = groupReleaseNotesByMonth(sameMonth);
    expect(groups.length).toBe(1);
    expect(groups[0].entries.length).toBe(3);
  });
});

describe("defaultOpenMonthKeys", () => {
  const monthKeys = ["2026-08", "2026-07", "2026-05"];

  it("絞り込みなし：当月と前月だけを開く", () => {
    const referenceDate = new Date(2026, 7, 12); // 2026-08-12（月は0始まり）
    const result = defaultOpenMonthKeys(monthKeys, referenceDate, false);
    expect(result).toEqual(new Set(["2026-08", "2026-07"]));
  });

  it("絞り込みなし：当月・前月のどちらにも当たらない月は開かない", () => {
    const referenceDate = new Date(2026, 7, 12);
    const result = defaultOpenMonthKeys(["2026-05"], referenceDate, false);
    expect(result.size).toBe(0);
  });

  it("年をまたぐ前月（1月の前月は前年12月）を正しく判定する", () => {
    const referenceDate = new Date(2026, 0, 15); // 2026-01-15
    const result = defaultOpenMonthKeys(["2026-01", "2025-12", "2025-11"], referenceDate, false);
    expect(result).toEqual(new Set(["2026-01", "2025-12"]));
  });

  it("期間で絞り込んでいるとき（hasPeriodFilter=true）は該当する月をすべて開く", () => {
    const referenceDate = new Date(2026, 7, 12);
    const result = defaultOpenMonthKeys(monthKeys, referenceDate, true);
    expect(result).toEqual(new Set(monthKeys));
  });

  it("絞り込みが無く該当月キーが空のときは空集合を返す", () => {
    const referenceDate = new Date(2026, 7, 12);
    expect(defaultOpenMonthKeys([], referenceDate, false).size).toBe(0);
    expect(defaultOpenMonthKeys([], referenceDate, true).size).toBe(0);
  });
});
