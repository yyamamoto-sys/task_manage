// src/lib/layout/__tests__/bottomStack.test.ts
//
// 【設計意図】
// src/lib/layout/bottomStack.ts（右下に積み上がる要素のスタックの一元管理）の各定数から、
// 実際にDOM上で占有する区間 [bottom, bottom+height) を計算し、どの2つの要素も重ならないことを
// 機械的に検査する。PC・モバイル、FABメニュー展開中・非展開中の4通り全てを検査する。
//
// 【なぜこのテストが要るか】v3.86〜v3.90時点は各要素（TaskSidePanelフッター／FAB／
// ショートカットボタン／Toast）が独立にbottom値を手書きしており、片方を直すたびに別の要素と
// 重なった（CLAUDE.md Section 43参照）。このテストはv3.90時点の値に対して実際に赤くなる
// ことを実装前に確認済み（PC：フッターとFAB、ショートカットとToastが重なる。モバイル：
// ショートカットとToastがbottom同値で重なる）。

import { describe, it, expect } from "vitest";
import {
  STACK_CLEARANCE_PX,
  SIDE_PANEL_FOOTER_HEIGHT_PX,
  BOTTOM_NAV_HEIGHT_MOBILE_PX,
  FAB_SIZE_PX,
  FAB_BOTTOM_PC_PX,
  FAB_BOTTOM_MOBILE_PX,
  FAB_MENU_BOTTOM_PC_PX,
  FAB_MENU_BOTTOM_MOBILE_PX,
  FAB_MENU_TOP_PC_PX,
  FAB_MENU_TOP_MOBILE_PX,
  SHORTCUTS_BUTTON_HEIGHT_PX,
  SHORTCUTS_BOTTOM_PC_PX,
  SHORTCUTS_BOTTOM_MOBILE_PX,
  SHORTCUTS_BOTTOM_FAB_OPEN_PC_PX,
  SHORTCUTS_BOTTOM_FAB_OPEN_MOBILE_PX,
  TOAST_ITEM_HEIGHT_PX,
  TOAST_BOTTOM_PC_PX,
  TOAST_BOTTOM_MOBILE_PX,
} from "../bottomStack";

interface StackInterval {
  name: string;
  /** 画面下端からの距離[px]（この値からheightぶん上に伸びる） */
  bottom: number;
  height: number;
}

function toRange(i: StackInterval): { from: number; to: number } {
  return { from: i.bottom, to: i.bottom + i.height };
}

/** [from,to) 同士が重なっているか（端点が接するだけ＝隙間0はclearance未確保として重なり扱いにする） */
function overlaps(a: StackInterval, b: StackInterval): boolean {
  const ra = toRange(a);
  const rb = toRange(b);
  return ra.from < rb.to && rb.from < ra.to;
}

function findOverlaps(intervals: StackInterval[]): string[] {
  const found: string[] = [];
  for (let i = 0; i < intervals.length; i++) {
    for (let j = i + 1; j < intervals.length; j++) {
      if (overlaps(intervals[i], intervals[j])) {
        const a = intervals[i];
        const b = intervals[j];
        found.push(`${a.name}[${a.bottom},${a.bottom + a.height}) x ${b.name}[${b.bottom},${b.bottom + b.height})`);
      }
    }
  }
  return found;
}

/** PC・非展開時のスタック（下から：TaskSidePanelフッター／FAB／ショートカット／Toast） */
function buildPcClosedStack(): StackInterval[] {
  return [
    { name: "sidePanelFooter", bottom: 0, height: SIDE_PANEL_FOOTER_HEIGHT_PX },
    { name: "fab", bottom: FAB_BOTTOM_PC_PX, height: FAB_SIZE_PX },
    { name: "shortcuts", bottom: SHORTCUTS_BOTTOM_PC_PX, height: SHORTCUTS_BUTTON_HEIGHT_PX },
    { name: "toast", bottom: TOAST_BOTTOM_PC_PX, height: TOAST_ITEM_HEIGHT_PX },
  ];
}

/** PC・FABメニュー展開時のスタック（FAB本体の上にメニュー3項目の列が乗り、
 *  ショートカット・Toastはさらにその上へ退避する） */
function buildPcOpenStack(): StackInterval[] {
  return [
    { name: "sidePanelFooter", bottom: 0, height: SIDE_PANEL_FOOTER_HEIGHT_PX },
    { name: "fab", bottom: FAB_BOTTOM_PC_PX, height: FAB_SIZE_PX },
    { name: "fabMenu", bottom: FAB_MENU_BOTTOM_PC_PX, height: FAB_MENU_TOP_PC_PX - FAB_MENU_BOTTOM_PC_PX },
    { name: "shortcuts", bottom: SHORTCUTS_BOTTOM_FAB_OPEN_PC_PX, height: SHORTCUTS_BUTTON_HEIGHT_PX },
    { name: "toast", bottom: TOAST_BOTTOM_PC_PX, height: TOAST_ITEM_HEIGHT_PX },
  ];
}

/** モバイル・非展開時のスタック（下から：ボトムナビ／FAB／ショートカット／Toast。
 *  TaskSidePanelはモバイルには出ないため対象外＝TaskEditModalが中央寄せの全画面モーダルで
 *  この右下スタックに参加しない。TaskSidePanel.tsx冒頭コメント参照） */
function buildMobileClosedStack(): StackInterval[] {
  return [
    { name: "bottomNav", bottom: 0, height: BOTTOM_NAV_HEIGHT_MOBILE_PX },
    { name: "fab", bottom: FAB_BOTTOM_MOBILE_PX, height: FAB_SIZE_PX },
    { name: "shortcuts", bottom: SHORTCUTS_BOTTOM_MOBILE_PX, height: SHORTCUTS_BUTTON_HEIGHT_PX },
    { name: "toast", bottom: TOAST_BOTTOM_MOBILE_PX, height: TOAST_ITEM_HEIGHT_PX },
  ];
}

/** モバイル・FABメニュー展開時のスタック */
function buildMobileOpenStack(): StackInterval[] {
  return [
    { name: "bottomNav", bottom: 0, height: BOTTOM_NAV_HEIGHT_MOBILE_PX },
    { name: "fab", bottom: FAB_BOTTOM_MOBILE_PX, height: FAB_SIZE_PX },
    { name: "fabMenu", bottom: FAB_MENU_BOTTOM_MOBILE_PX, height: FAB_MENU_TOP_MOBILE_PX - FAB_MENU_BOTTOM_MOBILE_PX },
    { name: "shortcuts", bottom: SHORTCUTS_BOTTOM_FAB_OPEN_MOBILE_PX, height: SHORTCUTS_BUTTON_HEIGHT_PX },
    { name: "toast", bottom: TOAST_BOTTOM_MOBILE_PX, height: TOAST_ITEM_HEIGHT_PX },
  ];
}

describe("右下スタック（bottomStack.ts）の重なり検査", () => {
  it("PC・FABメニュー非展開時：どの2要素も重ならない", () => {
    expect(findOverlaps(buildPcClosedStack())).toEqual([]);
  });

  it("PC・FABメニュー展開時：どの2要素も重ならない", () => {
    expect(findOverlaps(buildPcOpenStack())).toEqual([]);
  });

  it("モバイル・FABメニュー非展開時：どの2要素も重ならない", () => {
    expect(findOverlaps(buildMobileClosedStack())).toEqual([]);
  });

  it("モバイル・FABメニュー展開時：どの2要素も重ならない", () => {
    expect(findOverlaps(buildMobileOpenStack())).toEqual([]);
  });

  it("隣接する要素どうしは必ずSTACK_CLEARANCE_PX以上の隙間を確保する（PC非展開）", () => {
    const stack = buildPcClosedStack().sort((a, b) => a.bottom - b.bottom);
    for (let i = 0; i < stack.length - 1; i++) {
      const gap = stack[i + 1].bottom - (stack[i].bottom + stack[i].height);
      expect(gap).toBeGreaterThanOrEqual(STACK_CLEARANCE_PX);
    }
  });
});
