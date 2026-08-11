import { describe, it, expect } from "vitest";
import { resolveBandDisplay } from "../bandDisplay";

describe("resolveBandDisplay", () => {
  it("band_overrideがあればそれを優先する", () => {
    expect(resolveBandDisplay(80, 70)).toEqual({ value: 80, source: "override" });
  });

  it("band_overrideが無ければband_targetを使う", () => {
    expect(resolveBandDisplay(null, 70)).toEqual({ value: 70, source: "target" });
    expect(resolveBandDisplay(undefined, 70)).toEqual({ value: 70, source: "target" });
  });

  it("どちらも無ければnone/null", () => {
    expect(resolveBandDisplay(null, null)).toEqual({ value: null, source: "none" });
    expect(resolveBandDisplay(undefined, undefined)).toEqual({ value: null, source: "none" });
  });
});
