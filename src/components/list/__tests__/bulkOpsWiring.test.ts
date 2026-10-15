// v3.156：一括操作（Shiftチェックボックス・PJ移動・日程ずらし・複数ドラッグ・グループ見出しのドラッグ）の配線をソース走査で固定する。
// Section 59：コメントを除去してから走査する（コメントに書いた語で緑にならない）。
// わざと壊して赤くなること（各条件を外す）を確認済み。

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

describe("リストのチェックボックス（PC・モバイルとも）", () => {
  const src = read("components/list/ListView.tsx");
  it("チェックボックスはクリックのMouseEventをShift判定の入口へ渡し、onChangeでトグルしない", () => {
    expect(src).toMatch(/onClick=\{e => onCheckboxClick\(e, task\.id\)\}/);
    expect(src).not.toMatch(/onChange=\{\(\) => (toggleSelect|onToggleSelect)\(/);
    expect(src).toMatch(/applyCheckboxClick\(/);
    expect(src).toMatch(/e\.shiftKey,/);
  });
  it("PC行・モバイル行の両方に同じハンドラを渡している", () => {
    expect((src.match(/onCheckboxClick=\{handleCheckboxClick\}/g) ?? []).length).toBe(2);
  });
});

describe("一括操作バー（リスト・カンバン共通）", () => {
  for (const file of ["components/list/ListView.tsx", "components/kanban/KanbanView.tsx"]) {
    it(`${file} は PJ移動・日程ずらしを一括操作フックの関数へ配線している`, () => {
      const src = read(file);
      expect(src).toMatch(/<BulkMoveShiftControls/);
      expect(src).toMatch(/bulkMoveToProject\(pid, name, /);
      expect(src).toMatch(/bulkShift\(days\)/);
    });
  }
  it("フックは対象決定を planProjectMove に、日程のずらしを bulkShiftTasks に委譲する", () => {
    const src = read("hooks/useBulkTaskActions.ts");
    expect(src).toMatch(/planProjectMove\(/);
    expect(src).toMatch(/bulkShiftTasks\(/);
    expect(src).toMatch(/tone: "neutral"/);
    expect(src).toMatch(/isUndo: true/);
  });
});

describe("リストのドラッグ", () => {
  const src = read("components/list/ListView.tsx");
  it("選択中の行のドラッグは複数用の関数へ回る", () => {
    expect(src).toMatch(/selectedIds\.size > 1 && selectedIds\.has\(draggedId\)/);
    expect(src).toMatch(/handleMultiTaskDrop\(/);
  });
  it("グループ見出しはつかみからだけドラッグを始め、保存は reorderSections", () => {
    expect(src).toMatch(/sectionDrag=\{/);
    expect(src).toMatch(/computeSectionDropOrder\(/);
    expect(src).toMatch(/sectionActions\.reorderSections\(/);
    const hdr = read("components/section/SectionHeader.tsx");
    expect(hdr).toMatch(/sectionDrag && canEdit && !unsectioned/);
    expect(hdr).toMatch(/draggable/);
  });
  it("複数ドラッグ・グループドラッグの採番はフック経由で saveTask を通す", () => {
    const hook = read("hooks/useTaskDragReorder.ts");
    expect(hook).toMatch(/computeMultiReorder\(/);
    expect(hook).toMatch(/isUndo: true/);
    const act = read("hooks/useSectionActions.ts");
    expect(act).toMatch(/reorderProjectSections\(projectId, orderedIds/);
  });
});
