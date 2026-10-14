import { describe, it, expect, beforeEach } from "vitest";
import { recordLoad, getLoadTotal, countLoadsWithin, _resetLoadCounterForTest } from "../loadCounter";

beforeEach(_resetLoadCounterForTest);

describe("loadCounter", () => {
  it("窓の外の古い記録は数えない", () => {
    recordLoad(0); recordLoad(500_000); recordLoad(900_000);
    expect(countLoadsWithin(600_000, 900_000)).toBe(2);
    expect(getLoadTotal()).toBe(3);
  });
  it("保持する記録は上限つき（計測が溜まり続けない）が、累計は数え続ける", () => {
    for (let i = 0; i < 1000; i++) recordLoad(i);
    expect(getLoadTotal()).toBe(1000);
    expect(countLoadsWithin(10_000_000, 1000)).toBeLessThanOrEqual(200);
  });
});
