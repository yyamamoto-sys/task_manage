// src/lib/personalOkr/__tests__/availablePeriods.test.ts
import { describe, expect, it } from "vitest";
import { listAvailablePersonalKrPeriods } from "../availablePeriods";
import type { PersonalKr } from "../../localData/types";

function makeKr(overrides: Partial<PersonalKr>): PersonalKr {
  return {
    id: overrides.id ?? "kr-1",
    member_id: "m1",
    group_id: "grp-aid",
    fiscal_year: 2026,
    quarter: "3Q",
    kr_kind: "general",
    key_result_id: null,
    task_force_id: null,
    label: "テスト",
    weight_pct: 10,
    category: null,
    activity: null,
    strength_role: null,
    weakness_role: null,
    criteria: null,
    supplement: null,
    display_order: 0,
    imported_at: null,
    source_label: null,
    is_deleted: false,
    created_at: "2026-08-01T00:00:00Z",
    updated_by: "m1",
    ...overrides,
  };
}

describe("listAvailablePersonalKrPeriods", () => {
  it("論理削除されていないKRの（年度・四半期）組を件数付きで返す", () => {
    const krs = [
      makeKr({ id: "a", fiscal_year: 2026, quarter: "3Q" }),
      makeKr({ id: "b", fiscal_year: 2026, quarter: "3Q" }),
      makeKr({ id: "c", fiscal_year: 2027, quarter: "1Q" }),
    ];
    const periods = listAvailablePersonalKrPeriods(krs);
    expect(periods).toEqual([
      { fiscalYear: 2027, quarter: "1Q", count: 1 },
      { fiscalYear: 2026, quarter: "3Q", count: 2 },
    ]);
  });

  it("is_deleted=trueのKRは数えない", () => {
    const krs = [
      makeKr({ id: "a", is_deleted: true }),
    ];
    expect(listAvailablePersonalKrPeriods(krs)).toEqual([]);
  });

  it("KRが0件なら空配列", () => {
    expect(listAvailablePersonalKrPeriods([])).toEqual([]);
  });

  it("同じ年度内では四半期の降順（4Q→1Q）で並ぶ", () => {
    const krs = [
      makeKr({ id: "a", fiscal_year: 2026, quarter: "1Q" }),
      makeKr({ id: "b", fiscal_year: 2026, quarter: "4Q" }),
      makeKr({ id: "c", fiscal_year: 2026, quarter: "2Q" }),
    ];
    const periods = listAvailablePersonalKrPeriods(krs);
    expect(periods.map(p => p.quarter)).toEqual(["4Q", "2Q", "1Q"]);
  });
});
