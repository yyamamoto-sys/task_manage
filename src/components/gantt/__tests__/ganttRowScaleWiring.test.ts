// v3.191：ガントのズームが「行の高さ＋中身」に効く配線をソース走査で固定する（Section 59：コメント除去してから走査）。
// 修正前（固定の行高定数を直接使う実装）では赤になる。

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, "../../../");

function read(rel: string): string {
  const raw = fs.readFileSync(path.join(SRC, rel), "utf8");
  return raw.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map(l => {
    const i = l.indexOf("//");
    return i === -1 ? l : l.slice(0, i);
  }).join("\n");
}

describe("ガントの行スケール配線", () => {
  const view = read("components/gantt/GanttView.tsx");
  const parts = read("components/gantt/GanttParts.tsx");
  const utils = read("components/gantt/ganttUtils.ts");

  it("固定の行高定数（基準高）は computeGanttRowHeights の算出以外で使わない", () => {
    expect(view).not.toMatch(/GANTT_(GROUP|TASK|SECTION)_ROW_HEIGHT|QUICK_ADD_ROW_HEIGHT/);
    expect(parts).not.toMatch(/GANTT_(GROUP|TASK|SECTION)_ROW_HEIGHT|QUICK_ADD_ROW_HEIGHT/);
    const buildPart = utils.slice(utils.indexOf("export function buildPjViewGanttRows"), utils.indexOf("export function computeGanttBlockRanges"));
    expect(buildPart).not.toMatch(/GANTT_(GROUP|TASK|SECTION)_ROW_HEIGHT|QUICK_ADD_ROW_HEIGHT/);
  });

  it("行配列は rowMetrics.heights で組み立て、モバイル・プレビューは scale 1.0 固定", () => {
    expect(view).toMatch(/const rowScale = isPreview \|\| isMobile \? 1 : ganttRowScale\(dayWidth\)/);
    expect(view).toMatch(/buildPersonViewGanttRows\([\s\S]*?rowMetrics\.heights/);
    expect(view).toMatch(/buildPjViewGanttRows\(\{[\s\S]*?heights: rowMetrics\.heights/);
  });

  it("バー行・ラベル行のコンポーネントすべてに scale を渡す", () => {
    expect((view.match(/scale=\{rowScale\}/g) ?? []).length).toBe(6);
  });

  it("バー内ラベル・アバター等の副次要素は showSecondary で隠す／バーとつまみの高さは metrics 由来", () => {
    expect(parts).toMatch(/bar\.barWidth > 52 && m\.showSecondary/);
    expect(parts).toMatch(/height: m\.handleHeight/);
    expect(parts).not.toMatch(/height: 22, cursor: "ew-resize"/);
    expect((parts.match(/m\.showSecondary &&/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });

  it("ズーム時は縦位置も補正し（resolveZoomScrollTop）、全体表示ボタンは fitDayWidth を使う", () => {
    expect(view).toMatch(/resolveZoomScrollTop\(baseTop, prevRowHeightsRef\.current, nextHeights\)/);
    expect(view).toMatch(/fitDayWidth\(diffDays\(minD, maxD\) \+ 1, el\.clientWidth\)/);
    expect(view).toMatch(/onClick=\{fitAll\}/);
  });
});
