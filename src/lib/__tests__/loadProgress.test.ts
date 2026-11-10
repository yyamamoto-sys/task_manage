import { describe, it, expect } from "vitest";
import { phase1Percent, PHASE1_DATA_MAX, PREPARING_PROGRESS } from "../loadProgress";

describe("phase1Percent", () => {
  it("0/10 は 0、全完了は PHASE1_DATA_MAX（100 にはしない）", () => {
    expect(phase1Percent(0, 10)).toBe(0);
    expect(phase1Percent(10, 10)).toBe(PHASE1_DATA_MAX);
    expect(PHASE1_DATA_MAX).toBeLessThan(PREPARING_PROGRESS);
  });
  it("範囲外・分母0でも 0〜上限に収まる", () => {
    expect(phase1Percent(20, 10)).toBe(PHASE1_DATA_MAX);
    expect(phase1Percent(-1, 10)).toBe(0);
    expect(phase1Percent(3, 0)).toBe(0);
  });
});
