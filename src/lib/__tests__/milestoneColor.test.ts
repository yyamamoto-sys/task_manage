import { describe, it, expect } from "vitest";
import {
  normalizeHexColor, darkenHex, milestoneFillColor, milestoneBorderColor, milestoneGlyphColor,
  milestoneColorPatch, generateColorGrid, COLOR_GRID_HUES, MILESTONE_SWATCHES,
  pushRecentColor, parseRecentColors, RECENT_COLORS_MAX, isLightColor,
  DEFAULT_MILESTONE_FILL, DEFAULT_MILESTONE_BORDER,
} from "../milestoneColor";

describe("normalizeHexColor", () => {
  it("3桁・6桁・#有無・大小を #rrggbb に揃える", () => {
    expect(normalizeHexColor("#ABC")).toBe("#aabbcc");
    expect(normalizeHexColor("aabbcc")).toBe("#aabbcc");
    expect(normalizeHexColor("  #A1B2C3 ")).toBe("#a1b2c3");
  });
  it("不正値は null", () => {
    for (const v of ["", "#12", "#12345", "#gggggg", "red", "rgb(0,0,0)", "#1234567", null, undefined, 5]) {
      expect(normalizeHexColor(v)).toBeNull();
    }
  });
});

describe("表示色", () => {
  it("未設定・不正は既定色（塗り・枠・文字とも従来値）", () => {
    for (const ms of [{}, { color: null }, { color: "nope" }, null, undefined]) {
      expect(milestoneFillColor(ms)).toBe(DEFAULT_MILESTONE_FILL);
      expect(milestoneBorderColor(ms)).toBe(DEFAULT_MILESTONE_BORDER);
      expect(milestoneGlyphColor(ms)).toBe(DEFAULT_MILESTONE_BORDER);
    }
  });
  it("個別色は塗り＝その色・枠＝暗くした色", () => {
    expect(milestoneFillColor({ color: "#FF0000" })).toBe("#ff0000");
    expect(milestoneBorderColor({ color: "#ff0000" })).toBe("#b30000");
    expect(milestoneGlyphColor({ color: "#ff0000" })).toBe("#ff0000");
  });
  it("白でも枠は白より暗い", () => {
    expect(milestoneBorderColor({ color: "#ffffff" })).not.toBe("#ffffff");
  });
  it("darkenHex は不正値で既定枠色", () => {
    expect(darkenHex("zzz")).toBe(DEFAULT_MILESTONE_BORDER);
    expect(darkenHex("#000000")).toBe("#000000");
  });
  it("isLightColor", () => {
    expect(isLightColor("#ffffff")).toBe(true);
    expect(isLightColor("#000000")).toBe(false);
  });
});

describe("milestoneColorPatch（列が無い本番でも壊さない）", () => {
  it("元も無し・選択も既定 → color キーを出さない", () => {
    expect("color" in milestoneColorPatch(undefined, null)).toBe(false);
    expect("color" in milestoneColorPatch(null, null)).toBe(false);
  });
  it("色を選んだら正規化して返す", () => {
    expect(milestoneColorPatch(undefined, "#ABC")).toEqual({ color: "#aabbcc" });
  });
  it("元の色を既定に戻すときだけ null を明示する", () => {
    expect(milestoneColorPatch("#ff0000", null)).toEqual({ color: null });
  });
});

describe("generateColorGrid", () => {
  const grid = generateColorGrid();
  it("全行12列・全セルが #rrggbb", () => {
    expect(grid.length).toBeGreaterThanOrEqual(6);
    for (const row of grid) {
      expect(row).toHaveLength(COLOR_GRID_HUES);
      for (const c of row) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
  it("先頭行はグレー（白→黒）", () => {
    expect(grid[0][0]).toBe("#ffffff");
    expect(grid[0][COLOR_GRID_HUES - 1]).toBe("#000000");
  });
  it("色相の既知点：赤(0°)・緑(120°)・青(240°) が明るさ中段で期待色相", () => {
    const mid = grid[3];
    const [r0, g0, b0] = [mid[0], mid[4], mid[8]].map(h => parseInt(h.slice(1), 16));
    expect((r0 >> 16) & 255).toBeGreaterThan(r0 & 255);
    expect((g0 >> 8) & 255).toBeGreaterThan((g0 >> 16) & 255);
    expect(b0 & 255).toBeGreaterThan((b0 >> 8) & 255);
  });
  it("同一行内・行間で明るさが単調（上ほど薄い）", () => {
    for (let c = 0; c < COLOR_GRID_HUES; c++) {
      const lum = (h: string) => { const n = parseInt(h.slice(1), 16); return ((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255); };
      for (let r = 2; r < grid.length; r++) expect(lum(grid[r][c])).toBeLessThan(lum(grid[r - 1][c]));
    }
  });
  it("見本は10色・すべて正規形・重複なし", () => {
    expect(MILESTONE_SWATCHES).toHaveLength(10);
    expect(new Set(MILESTONE_SWATCHES).size).toBe(10);
    for (const c of MILESTONE_SWATCHES) expect(normalizeHexColor(c)).toBe(c);
  });
});

describe("最近使った色", () => {
  it("先頭追加・重複は前に出す・上限で切る", () => {
    let l: string[] = [];
    for (let i = 0; i < 10; i++) l = pushRecentColor(l, `#00000${i}`);
    expect(l).toHaveLength(RECENT_COLORS_MAX);
    expect(l[0]).toBe("#000009");
    l = pushRecentColor(l, "#000007");
    expect(l[0]).toBe("#000007");
    expect(l.filter(c => c === "#000007")).toHaveLength(1);
  });
  it("不正値は無視", () => {
    expect(pushRecentColor(["#111111"], "nope")).toEqual(["#111111"]);
  });
  it("parseRecentColors は壊れた JSON・不正要素に耐える", () => {
    expect(parseRecentColors(null)).toEqual([]);
    expect(parseRecentColors("{")).toEqual([]);
    expect(parseRecentColors('{"a":1}')).toEqual([]);
    expect(parseRecentColors('["#ABC","x","#aabbcc","#123456"]')).toEqual(["#aabbcc", "#123456"]);
  });
});
