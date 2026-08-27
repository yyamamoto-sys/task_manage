import { describe, expect, it } from "vitest";
import { computeMonthlyAverage, computePeriodReference, computeWeightedAverage, averageMonthlyReferences } from "../periodReviewReference";
import { isKrActiveInMonth, resolveEffectiveWeightPct } from "../krMonthScope";
import type { KrPeriodRow } from "../periodReviewReference";

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

// 【2026-08-26・v3.104】四半期ブロックの新しい算出式（仕様書§W4-3）：月ごとの参考値を求め、
// それらを単純平均する。
describe("averageMonthlyReferences", () => {
  it("3か月とも算出できる場合は単純平均する", () => {
    const monthly = [
      { selfEvalPct: 80, gmEvalPct: 70 },
      { selfEvalPct: 90, gmEvalPct: 60 },
      { selfEvalPct: 100, gmEvalPct: null },
    ];
    const ref = averageMonthlyReferences(monthly);
    expect(ref.selfEvalPct).toBeCloseTo((80 + 90 + 100) / 3, 5);
    expect(ref.gmEvalPct).toBeCloseTo((70 + 60) / 2, 5); // 算出できない月は除外
  });

  it("算出できない月（null）が混ざっても残りの月だけで平均する", () => {
    const ref = averageMonthlyReferences([
      { selfEvalPct: null, gmEvalPct: null },
      { selfEvalPct: 80, gmEvalPct: 70 },
    ]);
    expect(ref.selfEvalPct).toBeCloseTo(80, 5);
    expect(ref.gmEvalPct).toBeCloseTo(70, 5);
  });

  it("全月nullなら両方null", () => {
    const ref = averageMonthlyReferences([
      { selfEvalPct: null, gmEvalPct: null },
      { selfEvalPct: null, gmEvalPct: null },
    ]);
    expect(ref.selfEvalPct).toBeNull();
    expect(ref.gmEvalPct).toBeNull();
  });

  it("空配列なら両方null", () => {
    const ref = averageMonthlyReferences([]);
    expect(ref.selfEvalPct).toBeNull();
    expect(ref.gmEvalPct).toBeNull();
  });
});

// 【2026-08-26・v3.104】§W5「月ごとに構成が変わるケース（7月はKR-A/B、8月はKR-Bのみ）」の
// 統合シナリオ：krMonthScope.tsの実効ウェイト解決 → 月ごとにcomputePeriodReference →
// averageMonthlyReferencesで平均、という実際の呼び出しの流れをそのまま検証する。
describe("四半期ブロック：月ごとに対象KR・実効ウェイトが変わるシナリオ", () => {
  const krA = { id: "a", active_month_indexes: [1], weight_pct: 40 }; // 1か月目のみ対象
  const krB = { id: "b", active_month_indexes: [1, 2, 3], weight_pct: 60 };
  const krs = [krA, krB];

  // 1か月目：A(40%,self=80)・B(60%,self=90) → (40*80+60*90)/100 = 86
  // 2か月目：Aは対象外・Bのみ(100%,self=70) → 70
  // 3か月目：Aは対象外・Bのみ、記入なし → null（算出不可）
  const monthRecordsByMonthIndex: Record<1 | 2 | 3, Record<string, { self_eval_pct: number | null; weight_override_pct?: number | null }>> = {
    1: { a: { self_eval_pct: 80 }, b: { self_eval_pct: 90 } },
    2: { b: { self_eval_pct: 70 } },
    3: { b: { self_eval_pct: null } },
  };

  it("対象外KRは各月の行から除外され、算出できない月は平均から除外される", () => {
    const monthlyRefs = ([1, 2, 3] as const).map(mi => {
      const rows: KrPeriodRow[] = krs
        .filter(kr => isKrActiveInMonth(kr, mi))
        .map(kr => {
          const rec = monthRecordsByMonthIndex[mi][kr.id];
          const weightPct = resolveEffectiveWeightPct(kr, rec ? { weight_override_pct: rec.weight_override_pct } : null, mi) ?? 0;
          return { krId: kr.id, label: kr.id, weightPct, selfEvalPct: rec?.self_eval_pct ?? null, gmEvalPct: null };
        });
      return computePeriodReference(rows);
    });

    expect(monthlyRefs[0].selfEvalPct).toBeCloseTo(86, 5);
    expect(monthlyRefs[1].selfEvalPct).toBeCloseTo(70, 5);
    expect(monthlyRefs[2].selfEvalPct).toBeNull();

    const quarterRef = averageMonthlyReferences(monthlyRefs);
    expect(quarterRef.selfEvalPct).toBeCloseTo((86 + 70) / 2, 5);
  });
});
