// src/lib/layout/__tests__/sidebarWidth.test.ts
import { describe, it, expect } from "vitest";
import {
  clampSidebarWidth,
  parseStoredSidebarWidth,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
} from "../sidebarWidth";

describe("clampSidebarWidth", () => {
  it("範囲内の値はそのまま返す", () => {
    expect(clampSidebarWidth(250)).toBe(250);
  });

  it("最小値未満は最小値に丸める", () => {
    expect(clampSidebarWidth(0)).toBe(SIDEBAR_MIN_WIDTH);
    expect(clampSidebarWidth(-100)).toBe(SIDEBAR_MIN_WIDTH);
    expect(clampSidebarWidth(159)).toBe(SIDEBAR_MIN_WIDTH);
  });

  it("最大値を超える値は最大値に丸める", () => {
    expect(clampSidebarWidth(421)).toBe(SIDEBAR_MAX_WIDTH);
    expect(clampSidebarWidth(9999)).toBe(SIDEBAR_MAX_WIDTH);
  });

  it("境界値ちょうど（最小・最大）はそのまま通す", () => {
    expect(clampSidebarWidth(SIDEBAR_MIN_WIDTH)).toBe(SIDEBAR_MIN_WIDTH);
    expect(clampSidebarWidth(SIDEBAR_MAX_WIDTH)).toBe(SIDEBAR_MAX_WIDTH);
  });

  it("小数は四捨五入する", () => {
    expect(clampSidebarWidth(200.4)).toBe(200);
    expect(clampSidebarWidth(200.6)).toBe(201);
  });

  it("NaN・Infinityは既定幅を返す", () => {
    expect(clampSidebarWidth(NaN)).toBe(SIDEBAR_DEFAULT_WIDTH);
    expect(clampSidebarWidth(Infinity)).toBe(SIDEBAR_DEFAULT_WIDTH);
    expect(clampSidebarWidth(-Infinity)).toBe(SIDEBAR_DEFAULT_WIDTH);
  });
});

describe("parseStoredSidebarWidth", () => {
  it("正常な数値文字列はクランプ済みの数値として返す", () => {
    expect(parseStoredSidebarWidth("250")).toBe(250);
  });

  it("null・undefined・空文字列は既定幅を返す", () => {
    expect(parseStoredSidebarWidth(null)).toBe(SIDEBAR_DEFAULT_WIDTH);
    expect(parseStoredSidebarWidth(undefined)).toBe(SIDEBAR_DEFAULT_WIDTH);
    expect(parseStoredSidebarWidth("")).toBe(SIDEBAR_DEFAULT_WIDTH);
  });

  it("数値に変換できない文字列は既定幅を返す", () => {
    expect(parseStoredSidebarWidth("not-a-number")).toBe(SIDEBAR_DEFAULT_WIDTH);
    expect(parseStoredSidebarWidth("196px")).toBe(SIDEBAR_DEFAULT_WIDTH);
  });

  it("範囲外の数値文字列は範囲内にクランプする", () => {
    expect(parseStoredSidebarWidth("10")).toBe(SIDEBAR_MIN_WIDTH);
    expect(parseStoredSidebarWidth("-50")).toBe(SIDEBAR_MIN_WIDTH);
    expect(parseStoredSidebarWidth("9999")).toBe(SIDEBAR_MAX_WIDTH);
  });

  it("小数を含む文字列も丸めて範囲内に収める", () => {
    expect(parseStoredSidebarWidth("250.7")).toBe(251);
  });
});
