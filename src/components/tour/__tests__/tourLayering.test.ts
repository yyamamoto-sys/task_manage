// ツアーの吹き出しが、クリックで開いたポップオーバー（ベルのパネル等）に隠れて続行不能にならないことの固定。
// jsdom では実際の重なりを判定できないため、重なり順の規約（z-index の大小・Portal 先）をソース走査と純関数で検査する。
// 走査はコメント除去後（CLAUDE.md Section 59）。

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { TOUR_Z, sameRect } from "../tourLayout";

const SRC = join(__dirname, "..", "..", "..");
function strip(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter(l => !l.trim().startsWith("//")).join("\n");
}
const read = (rel: string) => strip(readFileSync(join(SRC, rel), "utf8"));

describe("ツアーの重なり順", () => {
  it("吹き出しの z-index は、body 直下に出るポップオーバー（useFloatingPanel）より大きい", () => {
    const m = read("hooks/useFloatingPanel.ts").match(/PANEL_Z_INDEX\s*=\s*(\d+)/);
    expect(m).not.toBeNull();
    expect(TOUR_Z.bubble).toBeGreaterThan(Number(m![1]));
    expect(TOUR_Z.scrim).toBeLessThan(TOUR_Z.spotlight);
    expect(TOUR_Z.spotlight).toBeLessThan(TOUR_Z.bubble);
  });

  it("TourOverlay は #root（isolation:isolate）の外＝body 直下へ Portal される（中に描くと z-index が何であれポップオーバーに負ける）", () => {
    const src = read("components/tour/TourProvider.tsx");
    expect(src).toMatch(/createPortal\(/);
    expect(src).toMatch(/document\.body/);
    expect(src).toMatch(/pointerEvents:\s*"auto"/); // body の継承 pointer-events:none を打ち消す（Section 51）
  });

  it("z-index は定数経由で、数値の直書きに戻っていない", () => {
    const src = read("components/tour/TourProvider.tsx");
    expect(src).not.toMatch(/zIndex:\s*(9990|9991|10000)\b/);
    expect(src).toMatch(/TOUR_Z\.bubble/);
  });

  it("対象の位置は定期的に測り直され、消えたら null（中央表示）になる", () => {
    const src = read("components/tour/TourProvider.tsx");
    expect(src).toMatch(/sameRect\(prev, next\)/);
    expect(src).toMatch(/el \? el\.getBoundingClientRect\(\) : null/);
  });

  it("全ツアーの Esc／✕／スキップは gated の段でも常に使える（続行不能にしない）", () => {
    const src = read("components/tour/TourProvider.tsx");
    expect(src).toMatch(/handleTourEscape\(e, [^\n]*onSkip\)/);
    expect(src).toMatch(/aria-label="ツアーを閉じる"/);
    // 「スキップ」ボタンは !gated の条件の外
    expect(src).toMatch(/<button onClick=\{onSkip\} style=\{ghostBtn\}>/);
  });
});

describe("sameRect", () => {
  const r = { top: 10, left: 20, width: 100, height: 40 };
  it("誤差 0.5px 未満は同じ", () => { expect(sameRect(r, { ...r, top: 10.3 })).toBe(true); });
  it("動いたら違う", () => { expect(sameRect(r, { ...r, top: 12 })).toBe(false); });
  it("null の扱い", () => {
    expect(sameRect(null, null)).toBe(true);
    expect(sameRect(r, null)).toBe(false);
    expect(sameRect(null, r)).toBe(false);
  });
});
