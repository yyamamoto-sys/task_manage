import { describe, it, expect } from "vitest";
import {
  phase1Percent, PHASE1_DATA_MAX, PREPARING_PROGRESS, rowFraction, createMonotonic, FALLBACK_TABLE_ROWS, fractionToPhase1Percent, type TableLoad,
} from "../loadProgress";

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

const T = (loaded: number, total: number | null, done = false): TableLoad => ({ loaded, total, done });

describe("rowFraction（行数ベース）", () => {
  it("取得済み行数の合計／総行数の合計になる（大きい表が重い）", () => {
    expect(rowFraction([T(0, 9000), T(1000, 1000, true)])).toBeCloseTo(0.1);
    expect(rowFraction([T(4500, 9000), T(1000, 1000, true)])).toBeCloseTo(0.55);
  });
  it("表の内部でも行が増えるたびに値が増える", () => {
    const a = rowFraction([T(0, 3000), T(0, 3000)]);
    const b = rowFraction([T(1000, 3000), T(0, 3000)]);
    const c = rowFraction([T(1000, 3000), T(2000, 3000)]);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
  });
  it("総行数が分からない表は最低重み（FALLBACK_TABLE_ROWS）で数え、完了で満たす", () => {
    expect(rowFraction([T(0, null), T(0, null)])).toBe(0);
    expect(rowFraction([T(0, null, true), T(0, null)])).toBeCloseTo(0.5);
    expect(FALLBACK_TABLE_ROWS).toBeGreaterThan(0);
  });
  it("0行の表も重み1で、完了すると1になる／全表完了で1", () => {
    expect(rowFraction([T(0, 0, true)])).toBe(1);
    expect(rowFraction([T(50, 50, true), T(0, null, true)])).toBe(1);
  });
  it("取得済みが総行数を超えても1を超えない", () => {
    expect(rowFraction([T(1200, 1000)])).toBe(1);
  });
  it("表がないときは0", () => {
    expect(rowFraction([])).toBe(0);
  });
});

describe("createMonotonic", () => {
  it("下がる値を与えても表示は後退せず、reset で戻せる", () => {
    const m = createMonotonic();
    expect(m.push(10)).toBe(10);
    expect(m.push(30)).toBe(30);
    expect(m.push(20)).toBe(30);
    m.reset();
    expect(m.push(5)).toBe(5);
  });
  it("分母が増えて割合が下がる状況でも後退しない", () => {
    const m = createMonotonic();
    const before = m.push(fractionToPhase1Percent(rowFraction([T(100, null, true), T(0, null)])));
    const after = m.push(fractionToPhase1Percent(rowFraction([T(100, 100, true), T(0, 9000)])));
    expect(after).toBeGreaterThanOrEqual(before);
  });
});
