import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { computeHBarHeight } from "../ganttUtils";

// 左ラベル列と右バー列は scrollTop を同期するだけの別コンテナ。右だけに横スクロールバーが出ると
// 右の最大 scrollTop が左より（バーの高さ分）大きくなり、一番下で行が縦にずれる（CLAUDE.md Section 80）。
// コメントを除去してから走査する（Section 59）。
const src = readFileSync(resolve(__dirname, "../GanttView.tsx"), "utf8")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

describe("ガント左右の最大スクロール量の一致", () => {
  it("computeHBarHeight：実測の差分。負・NaNは0", () => {
    expect(computeHBarHeight(500, 488)).toBe(12);
    expect(computeHBarHeight(500, 500)).toBe(0);
    expect(computeHBarHeight(500, 510)).toBe(0);
    expect(computeHBarHeight(NaN, 10)).toBe(0);
  });

  it("右バー列の横スクロールバー高さを実測している", () => {
    expect(src).toMatch(/computeHBarHeight\(\s*el\.offsetHeight\s*,\s*el\.clientHeight\s*\)/);
    expect(src).toMatch(/new ResizeObserver\(measure\)/);
  });

  it("左ラベル列のスクロール領域の末尾に同じ高さの余白がある", () => {
    const start = src.indexOf("ref={labelBodyRef}");
    const end = src.indexOf("handleDividerMouseDown", start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const region = src.slice(start, end);
    expect(region).toMatch(/data-gantt-hbar-spacer[^>]*height:\s*hBarHeight/);
    expect(region.indexOf("data-gantt-hbar-spacer")).toBeGreaterThan(region.indexOf("ganttRows.map"));
  });
});
