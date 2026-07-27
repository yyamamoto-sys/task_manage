import { describe, it, expect } from "vitest";
import { toDisplayTips, pickTipsForDisplay, DEFAULT_LOADING_TIPS, computeTipIndex } from "../loadingTips";
import type { LoadingTip } from "../../localData/types";

// readCachedTips/writeCachedTips は localStorage 依存（vitest.config.ts が
// environment: "node" のため localStorage が無く未検証）。純粋関数のみテストする。

function makeTip(overrides: Partial<LoadingTip> = {}): LoadingTip {
  return {
    id: "id-1",
    title: "見出し",
    body: "本文",
    sort_order: 10,
    is_active: true,
    is_deleted: false,
    ...overrides,
  };
}

describe("toDisplayTips", () => {
  it("is_deleted のヒントを除外する", () => {
    const tips = [makeTip({ id: "a" }), makeTip({ id: "b", is_deleted: true })];
    const result = toDisplayTips(tips);
    expect(result.map(t => t.title)).toEqual(["見出し"]);
    expect(result.length).toBe(1);
  });

  it("is_active=false のヒントを除外する", () => {
    const tips = [makeTip({ id: "a" }), makeTip({ id: "b", is_active: false })];
    const result = toDisplayTips(tips);
    expect(result.length).toBe(1);
  });

  it("本文が空白のみのヒントを除外する", () => {
    const tips = [makeTip({ id: "a" }), makeTip({ id: "b", body: "   " })];
    const result = toDisplayTips(tips);
    expect(result.length).toBe(1);
  });

  it("sort_order の昇順に並ぶ", () => {
    const tips = [
      makeTip({ id: "a", title: "A", sort_order: 30 }),
      makeTip({ id: "b", title: "B", sort_order: 10 }),
      makeTip({ id: "c", title: "C", sort_order: 20 }),
    ];
    const result = toDisplayTips(tips);
    expect(result.map(t => t.title)).toEqual(["B", "C", "A"]);
  });

  it("同一sort_orderは元の順を保つ（安定ソート）", () => {
    const tips = [
      makeTip({ id: "a", title: "A", sort_order: 10 }),
      makeTip({ id: "b", title: "B", sort_order: 10 }),
      makeTip({ id: "c", title: "C", sort_order: 10 }),
    ];
    const result = toDisplayTips(tips);
    expect(result.map(t => t.title)).toEqual(["A", "B", "C"]);
  });
});

describe("pickTipsForDisplay", () => {
  it("null なら DEFAULT_LOADING_TIPS を返す", () => {
    expect(pickTipsForDisplay(null)).toBe(DEFAULT_LOADING_TIPS);
  });

  it("空配列なら DEFAULT_LOADING_TIPS を返す", () => {
    expect(pickTipsForDisplay([])).toBe(DEFAULT_LOADING_TIPS);
  });

  it("1件以上あればそれを返す", () => {
    const cached = [{ title: "t", body: "b" }];
    expect(pickTipsForDisplay(cached)).toBe(cached);
  });
});

describe("DEFAULT_LOADING_TIPS", () => {
  it("10件ある", () => {
    expect(DEFAULT_LOADING_TIPS.length).toBe(10);
  });

  it("すべて body が非空", () => {
    for (const tip of DEFAULT_LOADING_TIPS) {
      expect(tip.body.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("computeTipIndex", () => {
  it("elapsed 0 のとき offset そのものを返す", () => {
    expect(computeTipIndex(0, 5, 2, 7000)).toBe(2);
  });

  it("interval未満はindexが変わらない", () => {
    expect(computeTipIndex(0, 5, 0, 7000)).toBe(0);
    expect(computeTipIndex(6999, 5, 0, 7000)).toBe(0);
  });

  it("interval経過ごとに1つ進む", () => {
    expect(computeTipIndex(7000, 5, 0, 7000)).toBe(1);
    expect(computeTipIndex(14000, 5, 0, 7000)).toBe(2);
    expect(computeTipIndex(21000, 5, 0, 7000)).toBe(3);
  });

  it("tipCountで巡回する（一周して戻る）", () => {
    expect(computeTipIndex(5 * 7000, 5, 0, 7000)).toBe(0);
    expect(computeTipIndex(6 * 7000, 5, 0, 7000)).toBe(1);
  });

  it("tipCountが0のとき0を返す（0除算・NaNにならない）", () => {
    expect(computeTipIndex(100000, 0, 3, 7000)).toBe(0);
  });

  it("負のelapsedMsでも範囲内の値を返す", () => {
    const result = computeTipIndex(-5000, 5, 0, 7000);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThan(5);
    expect(Number.isNaN(result)).toBe(false);
  });

  it("負のelapsedMsが大きくても範囲内の値を返す", () => {
    const result = computeTipIndex(-100000, 3, 1, 7000);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThan(3);
  });
});
