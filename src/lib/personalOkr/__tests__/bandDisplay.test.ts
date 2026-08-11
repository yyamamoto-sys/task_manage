import { describe, it, expect } from "vitest";
import { resolveBandDisplay } from "../bandDisplay";

describe("resolveBandDisplay", () => {
  it("band_overrideがあれば最優先で使う（band_ai・band_targetがあっても無視する）", () => {
    expect(resolveBandDisplay(80, 70, 60)).toEqual({ value: 80, source: "override" });
  });

  it("band_overrideが無く band_ai があれば band_ai を使う（band_targetは無視する）", () => {
    expect(resolveBandDisplay(null, 70, 60)).toEqual({ value: 70, source: "ai" });
    expect(resolveBandDisplay(undefined, 70, 60)).toEqual({ value: 70, source: "ai" });
  });

  it("band_override・band_aiが無ければ band_target を使う", () => {
    expect(resolveBandDisplay(null, null, 60)).toEqual({ value: 60, source: "target" });
    expect(resolveBandDisplay(undefined, undefined, 60)).toEqual({ value: 60, source: "target" });
  });

  it("全て無ければ none/null", () => {
    expect(resolveBandDisplay(null, null, null)).toEqual({ value: null, source: "none" });
    expect(resolveBandDisplay(undefined, undefined, undefined)).toEqual({ value: null, source: "none" });
  });

  it("🔴 band_overrideが入っているときはband_aiの値が一切表示に使われない", () => {
    const display = resolveBandDisplay(60, 90, 70);
    expect(display.value).toBe(60);
    expect(display.source).toBe("override");
    expect(display.value).not.toBe(90);
  });
});
