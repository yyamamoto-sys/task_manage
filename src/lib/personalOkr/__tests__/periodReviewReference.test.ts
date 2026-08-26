import { describe, expect, it } from "vitest";
import { computeMonthlyAverage, computePeriodReference, computeWeightedAverage } from "../periodReviewReference";

describe("computeWeightedAverage", () => {
  it("正常系：加重平均を計算する", () => {
    const v = computeWeightedAverage([
      { weightPct: 40, value: 80 },
      { weightPct: 60, value: 90 },
    ]);
    expect(v).toBeCloseTo((40 * 80 + 60 * 90) / 100, 5);
  });

  it("weight_pctが全て0のときはnull", () => {
    const v = computeWeightedAverage([
      { weightPct: 0, value: 80 },
      { weightPct: 0, value: 90 },
    ]);
    expect(v).toBeNull();
  });

  it("記入済みKRが0件（valueが全てnull）のときはnull", () => {
    const v = computeWeightedAverage([
      { weightPct: 40, value: null },
      { weightPct: 60, value: null },
    ]);
    expect(v).toBeNull();
  });

  it("行が0件のときはnull", () => {
    expect(computeWeightedAverage([])).toBeNull();
  });

  it("一部KRのみ記入：記入があるKRだけで加重平均する", () => {
    const v = computeWeightedAverage([
      { weightPct: 40, value: 80 },
      { weightPct: 60, value: null },
    ]);
    expect(v).toBeCloseTo(80, 5);
  });

  it("weightが負のときは除外する", () => {
    const v = computeWeightedAverage([
      { weightPct: -10, value: 100 },
      { weightPct: 50, value: 60 },
    ]);
    expect(v).toBeCloseTo(60, 5);
  });
});

describe("computeMonthlyAverage", () => {
  it("記入がある月だけの単純平均", () => {
    expect(computeMonthlyAverage([80, null, 90])).toBeCloseTo(85, 5);
  });

  it("全て未記入ならnull", () => {
    expect(computeMonthlyAverage([null, undefined, null])).toBeNull();
  });

  it("空配列ならnull", () => {
    expect(computeMonthlyAverage([])).toBeNull();
  });
});

describe("computePeriodReference", () => {
  it("正常系：自己評価・GM評価を独立に算出する", () => {
    const ref = computePeriodReference([
      { krId: "a", label: "A", weightPct: 40, selfEvalPct: 80, gmEvalPct: 70 },
      { krId: "b", label: "B", weightPct: 60, selfEvalPct: 90, gmEvalPct: null },
    ]);
    expect(ref.selfEvalPct).toBeCloseTo((40 * 80 + 60 * 90) / 100, 5);
    expect(ref.gmEvalPct).toBeCloseTo(70, 5); // gmEvalPctはBが未記入のためAのみで算出
  });

  it("weight_pctが全て0のときは両方null", () => {
    const ref = computePeriodReference([
      { krId: "a", label: "A", weightPct: 0, selfEvalPct: 80, gmEvalPct: 70 },
    ]);
    expect(ref.selfEvalPct).toBeNull();
    expect(ref.gmEvalPct).toBeNull();
  });

  it("記入済みKRが0件のときは両方null", () => {
    const ref = computePeriodReference([
      { krId: "a", label: "A", weightPct: 50, selfEvalPct: null, gmEvalPct: null },
    ]);
    expect(ref.selfEvalPct).toBeNull();
    expect(ref.gmEvalPct).toBeNull();
  });

  it("KRが0件のときは両方null", () => {
    const ref = computePeriodReference([]);
    expect(ref.selfEvalPct).toBeNull();
    expect(ref.gmEvalPct).toBeNull();
  });
});
