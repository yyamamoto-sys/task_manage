// src/lib/personalOkr/__tests__/weightCheck.test.ts
import { describe, expect, it } from "vitest";
import { sumWeightPct, isWeightTotalWarning } from "../weightCheck";

describe("sumWeightPct", () => {
  it("weight_pctの合計を返す", () => {
    expect(sumWeightPct([{ weight_pct: 40 }, { weight_pct: 25 }, { weight_pct: 20 }, { weight_pct: 10 }, { weight_pct: 5 }])).toBe(100);
  });
  it("空配列は0", () => {
    expect(sumWeightPct([])).toBe(0);
  });
});

describe("isWeightTotalWarning", () => {
  it("合計が100なら警告なし", () => {
    expect(isWeightTotalWarning(100)).toBe(false);
  });
  it("合計が100からわずかにずれる浮動小数の誤差は警告にしない", () => {
    expect(isWeightTotalWarning(100.005)).toBe(false);
  });
  it("合計が100未満なら警告", () => {
    expect(isWeightTotalWarning(90)).toBe(true);
  });
  it("合計が100を超えても警告", () => {
    expect(isWeightTotalWarning(110)).toBe(true);
  });
});
