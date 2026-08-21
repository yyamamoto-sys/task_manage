// src/lib/layout/__tests__/bottomStack.test.ts
//
// 【設計意図】
// src/lib/layout/bottomStack.ts（右下に積み上がる要素のスタックの一元管理）の各定数から、
// 実際にDOM上で占有する区間 [bottom, bottom+height) を計算し、意図せず重なっている要素が
// 無いことを機械的に検査する。PC・モバイル、FABメニュー展開中・非展開中の4通り全てを検査する。
//
// 【なぜこのテストが要るか】v3.86〜v3.90時点は各要素（TaskSidePanelフッター／FAB／
// ショートカットボタン／Toast）が独立にbottom値を手書きしており、片方を直すたびに別の要素と
// 重なった（CLAUDE.md Section 43参照）。このテストはv3.90時点の値に対して実際に赤くなる
// ことを実装前に確認済み（PC：フッターとFAB、ショートカットとToastが重なる。モバイル：
// ショートカットとToastがbottom同値で重なる）。
//
// 【v3.92：「重ならない」を一律の不変条件にしない】
// v3.91は「どの2つも重ならない」を無条件の不変条件として実装した結果、Toastがショートカット
// ボタンとの重なりを避けるためだけに画面の1/3近くまで押し上げられる副作用を生んだ（統括の
// 指摘）。このスタックが守るべき本質は「操作を妨げないこと」であり、「一切重ならないこと」
// ではない。Toast（最前面・数秒で自動消去される一過性表示）とショートカットボタン（常設だが
// 補助的なaffordance）の重なりは実害が無いため、ALLOWED_OVERLAPS に理由付きで登録し、
// この重なりだけを許容する。理由の説明が無いペアは登録できない（allowOverlap()が例外を
// 投げる）——将来ここが無条件の抜け穴にならないようにするため。

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

// ===== 許容する重なりの登録（理由の説明が無いと登録できない） =====

interface AllowedOverlap {
  pair: readonly [string, string];
  reason: string;
}

const MIN_REASON_LENGTH = 20;

/**
 * 要素名のペアが重なることを許容する。理由（reason）が短すぎる・空の場合は例外を投げ、
 * このテストファイル自体がロードできなくなる（＝理由なしの許容登録を構造的に禁止する）。
 */
function allowOverlap(a: string, b: string, reason: string): AllowedOverlap {
  if (!reason || reason.trim().length < MIN_REASON_LENGTH) {
    throw new Error(
      `allowOverlap("${a}", "${b}") には重なりを許容する理由の説明（${MIN_REASON_LENGTH}文字以上）が必須です`
    );
  }
  return { pair: [a, b], reason };
}

const ALLOWED_OVERLAPS: AllowedOverlap[] = [
  allowOverlap(
    "toast",
    "shortcuts",
    "Toastはz-index最前面に出るうえ数秒で自動消去される一過性表示。ショートカットボタンは" +
      "常設だが補助的なaffordanceで、数秒間Toastに隠れても実害が無い（通知が消えれば元に" +
      "戻る）。FABのような『利用者が押したい主要な操作ボタン』ではないため許容する。"
  ),
  allowOverlap(
    "toast",
    "fabMenu",
    "Toastの位置はFAB本体の直上（ショートカットボタンの通常位置と同じ高さ）に固定している。" +
      "FABメニュー展開時（3項目が積み上がる状態）とは重なりうるが、メニュー項目はクリック" +
      "直後にメニュー自体を閉じてから処理を実行する設計（QuickAddFab.tsx）のため、ある" +
      "アクションの結果として出るToastが、そのアクションを起こした当のFABメニューと同時に" +
      "開いたまま重なることは通常起きない。別の非同期処理由来のToastが偶然メニュー展開中に" +
      "重なるケースは残るが、Toastは数秒で自動消去される一過性表示であり実害は小さいと判断する。"
  ),
];

function isAllowedOverlap(a: string, b: string): boolean {
  return ALLOWED_OVERLAPS.some(
    ({ pair }) => (pair[0] === a && pair[1] === b) || (pair[0] === b && pair[1] === a)
  );
}

/** ALLOWED_OVERLAPS に載っていない重なり（＝本当に直すべきバグ）だけを返す */
function findViolations(intervals: StackInterval[]): string[] {
  const found: string[] = [];
  for (let i = 0; i < intervals.length; i++) {
    for (let j = i + 1; j < intervals.length; j++) {
      const a = intervals[i];
      const b = intervals[j];
      if (overlaps(a, b) && !isAllowedOverlap(a.name, b.name)) {
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
 *  ショートカットはさらにその上へ退避する。Toastは開閉によらず静的な位置のまま） */
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

const ALL_SCENARIOS: [string, () => StackInterval[]][] = [
  ["PC・FABメニュー非展開", buildPcClosedStack],
  ["PC・FABメニュー展開", buildPcOpenStack],
  ["モバイル・FABメニュー非展開", buildMobileClosedStack],
  ["モバイル・FABメニュー展開", buildMobileOpenStack],
];

describe("右下スタック（bottomStack.ts）の重なり検査", () => {
  it("PC・FABメニュー非展開時：許容リスト外の重なりが無い", () => {
    expect(findViolations(buildPcClosedStack())).toEqual([]);
  });

  it("PC・FABメニュー展開時：許容リスト外の重なりが無い", () => {
    expect(findViolations(buildPcOpenStack())).toEqual([]);
  });

  it("モバイル・FABメニュー非展開時：許容リスト外の重なりが無い", () => {
    expect(findViolations(buildMobileClosedStack())).toEqual([]);
  });

  it("モバイル・FABメニュー展開時：許容リスト外の重なりが無い", () => {
    expect(findViolations(buildMobileOpenStack())).toEqual([]);
  });

  it("ALLOWED_OVERLAPSの各ペアは、少なくとも1つのシナリオで実際に重なっている（不要な許容を残さない）", () => {
    for (const { pair, reason } of ALLOWED_OVERLAPS) {
      const actuallyOverlaps = ALL_SCENARIOS.some(([, build]) => {
        const stack = build();
        const a = stack.find(s => s.name === pair[0]);
        const b = stack.find(s => s.name === pair[1]);
        return !!a && !!b && overlaps(a, b);
      });
      expect(actuallyOverlaps, `${pair[0]} x ${pair[1]}（理由: ${reason.slice(0, 20)}...）`).toBe(true);
    }
  });

  it("クリアランス：必須ペア（許容リスト外の隣接関係）はSTACK_CLEARANCE_PX以上の隙間を確保する", () => {
    const stack = buildPcClosedStack();
    const byName = (n: string) => stack.find(s => s.name === n)!;
    const gap = (lowerName: string, upperName: string): number => {
      const lower = byName(lowerName);
      const upper = byName(upperName);
      return upper.bottom - (lower.bottom + lower.height);
    };
    expect(gap("sidePanelFooter", "fab")).toBeGreaterThanOrEqual(STACK_CLEARANCE_PX);
    expect(gap("fab", "shortcuts")).toBeGreaterThanOrEqual(STACK_CLEARANCE_PX);
    expect(gap("fab", "toast")).toBeGreaterThanOrEqual(STACK_CLEARANCE_PX);
  });

  it("クリアランス：FABメニュー展開時もFAB本体とメニュー・メニューとショートカットは隙間を確保する", () => {
    const stack = buildPcOpenStack();
    const byName = (n: string) => stack.find(s => s.name === n)!;
    const gap = (lowerName: string, upperName: string): number => {
      const lower = byName(lowerName);
      const upper = byName(upperName);
      return upper.bottom - (lower.bottom + lower.height);
    };
    expect(gap("fabMenu", "shortcuts")).toBeGreaterThanOrEqual(STACK_CLEARANCE_PX);
  });
});
