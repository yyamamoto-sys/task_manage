// src/lib/personalOkr/__tests__/quarterMonths.test.ts
import { describe, expect, it } from "vitest";
import { quarterMonthSlots, monthToDateStr, classifyMonth } from "../quarterMonths";

describe("quarterMonthSlots", () => {
  it("3Q（7〜9月）は7月/8月/9月をmonth_index 1/2/3で返す", () => {
    const slots = quarterMonthSlots(2026, "3Q");
    expect(slots).toEqual([
      { monthIndex: 1, monthStart: new Date(2026, 6, 1) },
      { monthIndex: 2, monthStart: new Date(2026, 7, 1) },
      { monthIndex: 3, monthStart: new Date(2026, 8, 1) },
    ]);
  });

  it("1Q（1〜3月）は1月/2月/3月を返す", () => {
    const slots = quarterMonthSlots(2026, "1Q");
    expect(slots.map(s => s.monthStart.getMonth())).toEqual([0, 1, 2]);
  });

  it("4Q（10〜12月）は10月/11月/12月を返す", () => {
    const slots = quarterMonthSlots(2026, "4Q");
    expect(slots.map(s => s.monthStart.getMonth())).toEqual([9, 10, 11]);
  });
});

describe("monthToDateStr", () => {
  it("月初日付をYYYY-MM-01文字列に変換する", () => {
    expect(monthToDateStr(new Date(2026, 7, 1))).toBe("2026-08-01");
    expect(monthToDateStr(new Date(2026, 0, 15))).toBe("2026-01-01");
  });
});

describe("classifyMonth", () => {
  const today = new Date(2026, 7, 7); // 2026-08-07

  it("今日より前の月はpast", () => {
    expect(classifyMonth(new Date(2026, 6, 1), today)).toBe("past");
  });
  it("今日と同じ月はcurrent", () => {
    expect(classifyMonth(new Date(2026, 7, 1), today)).toBe("current");
  });
  it("今日より後の月はfuture", () => {
    expect(classifyMonth(new Date(2026, 8, 1), today)).toBe("future");
  });
});
