// v3.165：ガントのグループ見出しの並べ替え（⋮メニュー・⠿ドラッグ）の配線をソース走査で固定する。
// Section 59：コメントを除去してから走査する。わざと壊して赤くなること（各条件を外す）を確認済み。

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

describe("ガントのグループ見出し（並べ替え）", () => {
  const src = read("components/gantt/GanttView.tsx");
  it("見出し行は並べ替え専用の⋮メニュー（4項目だけ）を使い、保存は useSectionActions 経由", () => {
    expect(src).toMatch(/<SectionMenu\b[\s\S]*?actions=\{MOVE_ONLY_SECTION_MENU_ACTIONS\}/);
    expect(src).toMatch(/sectionActions\.moveSection\(sec, a\)/);
    expect(src).toMatch(/sectionActions\.reorderSections\(row\.pj\.id, order\)/);
    expect(src).toMatch(/computeSectionDropOrder\(/);
  });
  it("見出しのドラッグはタスク行とは別 state・別PJへは落とせない・プレビューとモバイルは対象外", () => {
    expect(src).toMatch(/useState<\{ id: string; projectId: string \} \| null>\(null\)/);
    expect(src).toMatch(/draggingSection\.projectId !== row\.pj\.id/);
    expect(src).toMatch(/const canReorderSections = !isPreview && !isMobile && canGuestEdit\(/);
    expect(src).toMatch(/canDragHere = canReorderSections && !row\.unsectioned/);
  });
  it("メニュー（Portal）のクリックが見出し行の折りたたみへ伝わらない", () => {
    expect(src).toMatch(/onClick=\{e => e\.stopPropagation\(\)\} onKeyDown=\{e => e\.stopPropagation\(\)\}/);
  });
  it("見出し行の高さは row.height のまま（左右の行ずれ防止・Section 80）", () => {
    expect(src).toMatch(/height: row\.height, display: "flex", alignItems: "center", gap: "6px", padding: "0 8px 0 22px"/);
  });
});

describe("リストの⋮メニュー（一番上へ・一番下へ）", () => {
  const menu = read("components/section/SectionMenu.tsx");
  const hdr = read("components/section/SectionHeader.tsx");
  it("メニューに4つの移動項目があり、Portal は pointerEvents:auto", () => {
    expect(menu).toMatch(/id: "top"/);
    expect(menu).toMatch(/id: "bottom"/);
    expect(menu).toMatch(/pointerEvents: "auto"/);
  });
  it("見出しは4方向とも onMove へ渡す", () => {
    expect(hdr).toMatch(/a === "top" \|\| a === "up" \|\| a === "down" \|\| a === "bottom"\) onMove\?\.\(a\)/);
  });
});
