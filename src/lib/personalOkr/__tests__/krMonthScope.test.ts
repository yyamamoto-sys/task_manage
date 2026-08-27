// src/lib/personalOkr/__tests__/krMonthScope.test.ts
import { describe, expect, it } from "vitest";
import { isKrActiveInMonth, resolveEffectiveWeightPct, sumEffectiveWeightPct } from "../krMonthScope";

describe("isKrActiveInMonth", () => {
  it("active_month_indexesがundefined（未適用時）なら全月対象", () => {
    expect(isKrActiveInMonth({ active_month_indexes: undefined }, 1)).toBe(true);
    expect(isKrActiveInMonth({ active_month_indexes: undefined }, 2)).toBe(true);
    expect(isKrActiveInMonth({ active_month_indexes: undefined }, 3)).toBe(true);
  });

  it("active_month_indexesが[1]なら1のみ対象", () => {
    expect(isKrActiveInMonth({ active_month_indexes: [1] }, 1)).toBe(true);
    expect(isKrActiveInMonth({ active_month_indexes: [1] }, 2)).toBe(false);
    expect(isKrActiveInMonth({ active_month_indexes: [1] }, 3)).toBe(false);
  });

  it("active_month_indexesが[1,2,3]なら全月対象", () => {
    expect(isKrActiveInMonth({ active_month_indexes: [1, 2, 3] }, 1)).toBe(true);
    expect(isKrActiveInMonth({ active_month_indexes: [1, 2, 3] }, 2)).toBe(true);
    expect(isKrActiveInMonth({ active_month_indexes: [1, 2, 3] }, 3)).toBe(true);
  });
});

describe("resolveEffectiveWeightPct", () => {
  it("対象外の月ならnull", () => {
    const kr = { active_month_indexes: [1], weight_pct: 40 };
    expect(resolveEffectiveWeightPct(kr, null, 2)).toBeNull();
  });

  it("上書きがあれば上書き値を使う", () => {
    const kr = { active_month_indexes: [1, 2, 3], weight_pct: 40 };
    expect(resolveEffectiveWeightPct(kr, { weight_override_pct: 25 }, 1)).toBe(25);
  });

  it("上書きが無ければ（undefined）四半期共通値を使う", () => {
    const kr = { active_month_indexes: [1, 2, 3], weight_pct: 40 };
    expect(resolveEffectiveWeightPct(kr, { weight_override_pct: undefined }, 1)).toBe(40);
    expect(resolveEffectiveWeightPct(kr, null, 1)).toBe(40);
    expect(resolveEffectiveWeightPct(kr, undefined, 1)).toBe(40);
  });

  it("上書きがnullでも（クリア扱い）四半期共通値を使う", () => {
    const kr = { active_month_indexes: [1, 2, 3], weight_pct: 40 };
    expect(resolveEffectiveWeightPct(kr, { weight_override_pct: null }, 1)).toBe(40);
  });

  it("🔴 上書きが0のときは0をそのまま返す（??が0を落とさないこと）", () => {
    const kr = { active_month_indexes: [1, 2, 3], weight_pct: 40 };
    expect(resolveEffectiveWeightPct(kr, { weight_override_pct: 0 }, 1)).toBe(0);
  });

  it("active_month_indexesがundefined（未適用時）なら全月対象として解決する", () => {
    const kr = { active_month_indexes: undefined, weight_pct: 40 };
    expect(resolveEffectiveWeightPct(kr, null, 2)).toBe(40);
  });
});

describe("sumEffectiveWeightPct", () => {
  it("対象外KRは合計に入らない", () => {
    const krs = [
      { id: "a", active_month_indexes: [1], weight_pct: 40 },
      { id: "b", active_month_indexes: [2, 3], weight_pct: 60 },
    ];
    expect(sumEffectiveWeightPct(krs, {}, 1)).toBe(40);
    expect(sumEffectiveWeightPct(krs, {}, 2)).toBe(60);
  });

  it("上書きウェイトが混ざっても正しく合計する", () => {
    const krs = [
      { id: "a", active_month_indexes: [1, 2, 3], weight_pct: 40 },
      { id: "b", active_month_indexes: [1, 2, 3], weight_pct: 60 },
    ];
    expect(sumEffectiveWeightPct(krs, { a: { weight_override_pct: 25 } }, 1)).toBe(85);
  });

  it("対象KRが0件のとき0を返す（例外を出さない）", () => {
    expect(sumEffectiveWeightPct([], {}, 1)).toBe(0);
  });

  it("全KRが対象外のとき0を返す", () => {
    const krs = [{ id: "a", active_month_indexes: [2], weight_pct: 40 }];
    expect(sumEffectiveWeightPct(krs, {}, 1)).toBe(0);
  });
});
