// src/lib/date/__tests__/holidays.test.ts
import { describe, it, expect } from "vitest";
import { isHoliday } from "../holidays";

describe("isHoliday", () => {
  it("固定祝日（元日）を祝日名で返す", () => {
    expect(isHoliday("2026-01-01")).toBe("元日");
  });

  it("ハッピーマンデー（海の日・2026年は7/20）を祝日名で返す", () => {
    expect(isHoliday("2026-07-20")).toBe("海の日");
  });

  it("振替休日（2024-05-06）を祝日名で返す", () => {
    expect(isHoliday("2024-05-06")).toBe("振替休日");
  });

  it("平日は null を返す", () => {
    expect(isHoliday("2026-07-21")).toBeNull();
    expect(isHoliday("2026-07-24")).toBeNull();
  });

  it("土曜日（祝日でない）は null を返す", () => {
    // 2026-07-25 は土曜日で祝日ではない
    expect(isHoliday("2026-07-25")).toBeNull();
  });

  it("無効な日付文字列は null を返す", () => {
    expect(isHoliday("not-a-date")).toBeNull();
    expect(isHoliday("")).toBeNull();
  });
});
