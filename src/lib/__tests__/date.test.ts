import { describe, it, expect } from "vitest";
import { formatMDWithWeekday, formatDateRangeWithWeekday } from "../date";

describe("formatMDWithWeekday", () => {
  it("「M月D日(曜)」形式（半角括弧・曜日は漢字1文字）に変換する", () => {
    // 2026-06-01 は月曜日
    expect(formatMDWithWeekday(new Date(2026, 5, 1))).toBe("6月1日(月)");
  });

  it("日曜日は「日」", () => {
    // 2026-06-07 は日曜日
    expect(formatMDWithWeekday(new Date(2026, 5, 7))).toBe("6月7日(日)");
  });
});

describe("formatDateRangeWithWeekday", () => {
  it("「M月D日(曜)〜M月D日(曜)」形式に変換する", () => {
    expect(formatDateRangeWithWeekday(new Date(2026, 5, 1), new Date(2026, 5, 7))).toBe(
      "6月1日(月)〜6月7日(日)"
    );
  });

  it("月をまたぐ範囲でも両端それぞれの月日を表示する", () => {
    expect(formatDateRangeWithWeekday(new Date(2026, 6, 29), new Date(2026, 7, 4))).toBe(
      "7月29日(水)〜8月4日(火)"
    );
  });
});
