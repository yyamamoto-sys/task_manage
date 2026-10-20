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
    expect(src).toMatch(/sectionActions\.reorderSections\(drag\.projectId, order\)/);
    expect(src).toMatch(/computeSectionDropOrder\(/);
  });
  it("見出しのドラッグはタスク行とは別の仕組み（Pointer Events のフック）・別PJへは落とせない・プレビューとモバイルは対象外", () => {
    expect(src).toMatch(/useSectionPointerDrag\(\{/);
    expect(src).toMatch(/target\.projectId !== drag\.projectId/);
    expect(src).toMatch(/draggingSection\.projectId === row\.pj\.id/);
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

describe("グループ見出しのドラッグ中の表示（v3.166・リストとガントで共通の部品）", () => {
  const gantt = read("components/gantt/GanttView.tsx");
  const list = read("components/list/ListView.tsx");
  const part = read("components/section/SectionDropIndicator.tsx");
  it("挿入位置の線（SectionDropIndicator）と案内・移動中表示・ゴーストをリスト・ガント両方が使う", () => {
    for (const src of [gantt, list]) {
      expect(src).toMatch(/<SectionDropIndicator\b/);
      expect(src).toMatch(/<SectionDragNotice\b/);
      expect(src).toMatch(/<SectionDragGhost\b/);
      expect(src).toMatch(/describeSectionDrop\(/);
      expect(src).toMatch(/sectionMovingStyle/);
    }
  });
  it("ガントは左ラベル列とバー列の両方の見出し行に線を引く（バー列は札なし）", () => {
    expect(gantt.match(/<SectionDropIndicator\b/g)?.length).toBe(2);
    expect(gantt).toMatch(/<SectionDropIndicator drop=\{barDrop\} showLabel=\{false\} \/>/);
  });
  it("線と札は重ね描き（absolute）・ポインタ無効で、行の高さを変えない", () => {
    expect(part).toMatch(/position: "absolute", left: 0, right: 0/);
    expect(part).toMatch(/pointerEvents: "none"/);
    expect(part).not.toMatch(/\bheight: row/);
  });
});

describe("グループ見出しのドラッグは Pointer Events（v3.167・ホイールでスクロールできる）", () => {
  const gantt = read("components/gantt/GanttView.tsx");
  const list = read("components/list/ListView.tsx");
  const header = read("components/section/SectionHeader.tsx");
  const hook = read("hooks/useSectionPointerDrag.ts");
  const ghost = read("components/section/SectionDragGhost.tsx");
  it("グループ見出しに HTML5 のドラッグ属性が残っていない（native drag 中はホイールが効かない）", () => {
    expect(header).not.toMatch(/\bdraggable\b/);
    expect(header).not.toMatch(/onDragStart|onDragEnd/);
    expect(header).toMatch(/onPointerDown=\{sectionDrag\.onPointerDown\}/);
    expect(header).toMatch(/touchAction: "none"/);
    // ガントの⠿（タスク行・バーの draggable は別の箇所なので、⠿ のつかみだけを切り出して見る）
    const grip = gantt.slice(gantt.indexOf("canDragHere && ("), gantt.indexOf("⠿</span>"));
    expect(grip.length).toBeGreaterThan(0);
    expect(grip).not.toMatch(/\bdraggable\b|onDragStart|onDragEnd/);
    expect(grip).toMatch(/sectionDrag\.begin\(/);
    for (const src of [gantt, list]) {
      expect(src).not.toMatch(/setDraggingSection|setSectionDropKey|useSectionDragGuard|SectionDragGhost\(e,|startSectionDragGhost|removeSectionDragGhost/);
    }
  });
  it("リスト・ガントの両画面が共通フックを使い、見出しの行に判定用の属性を付ける（コピペしない）", () => {
    for (const src of [gantt, list]) {
      expect(src).toMatch(/useSectionPointerDrag\(\{/);
      expect(src).toMatch(/data-section-drop-key=/);
      expect(src).toMatch(/data-section-key=/);
      expect(src).toMatch(/data-section-project=/);
      expect(src).toMatch(/sectionActions\.reorderSections\(drag\.projectId, order\)/);
      expect(src).toMatch(/computeSectionDropOrder\(/);
    }
    // ガントはバー列の見出し行にも同じ属性（カーソルがバー側にあっても判定できる）
    expect(gantt.match(/data-section-drop-key=/g)?.length).toBe(2);
    expect(list).toMatch(/getScrollArea: \(\) => \(\{ scrollEl: listScrollRef\.current \}\)/);
    expect(gantt).toMatch(/scrollEl: scrollRef\.current, rectEl: labelBodyRef\.current/);
  });
  it("フックは setPointerCapture を使わず、ホイールを止めず、端の自動スクロールと後片付けを持つ", () => {
    expect(hook).not.toMatch(/setPointerCapture/);
    expect(hook).not.toMatch(/["']wheel["']/);
    expect(hook).toMatch(/document\.elementFromPoint\(/);
    expect(hook).toMatch(/sectionAutoScrollDelta\(/);
    expect(hook).toMatch(/requestAnimationFrame\(tick\)/);
    expect(hook).toMatch(/cancelAnimationFrame\(raf\)/);
    expect(hook).toMatch(/addEventListener\("scroll", onScroll, true\)/);
    expect(hook).toMatch(/removeEventListener\("scroll", onScroll, true\)/);
    expect(hook).toMatch(/addEventListener\("pointercancel", cleanup\)/);
    expect(hook).toMatch(/addEventListener\("blur", cleanup\)/);
    expect(hook).toMatch(/ev\.key === "Escape"/);
    expect(hook).toMatch(/document\.body\.style\.userSelect = prevUserSelect/);
    expect(hook).toMatch(/document\.body\.style\.cursor = prevCursor/);
    expect(hook).toMatch(/e\.button !== 0/);
    expect(hook).toMatch(/SECTION_DRAG_THRESHOLD_PX/);
  });
  it("ゴーストはカーソル追従の固定位置・ポインタ無効・ツアーの吹き出しより下", () => {
    expect(ghost).toMatch(/createPortal\(/);
    expect(ghost).toMatch(/position: "fixed"/);
    expect(ghost).toMatch(/pointerEvents: "none"/);
    expect(ghost).toMatch(/zIndex: TOUR_Z\.bubble - 1/);
  });
});
