// src/lib/layout/__tests__/bottomStack.test.ts
//
// 【設計意図】
// src/lib/layout/bottomStack.ts（右下に積み上がる要素のスタックの一元管理）の各定数・関数から、
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
//
// 【v3.94：TaskSidePanelフッターをこの1次元モデルから外した】
// このテストは bottom座標と高さだけを見る1次元の検査であり、「横方向にどれだけ離れているか」
// を表現できない。v3.94でFABはTaskSidePanelが開いている間、パネル幅ぶん横へ完全に退避する
// 方式に変えた（uiLayoutStore.ts・QuickAddFab.tsx）ため、フッターとFABはもはや同じ縦列を
// 共有せず、この1次元モデルで「重ならないこと」を検査する対象ではなくなった。実際に重ならない
// ことの検証は src/lib/layout/devOverlapCheck.ts の開発ビルド限定ランタイム実測チェックに
// 委ねている（CLAUDE.md Section 49参照）。
//
// 【v3.95：固定heightをやめ、実測が必要な依存だけ関数化した】
// 文字を含む要素（ショートカットボタン・Toast・ボトムナビ・FAB展開メニュー項目）は固定height
// からminHeightへ変更し、実際の描画高さは拡大率・フォント設定次第で伸びうる前提にした。
// 残る「本当の縦の依存」は2つだけ（他はFAB本体の固定サイズからの静的な式で足りる）：
//   1. モバイルのボトムナビ→FAB（computeFabBottomMobile）
//   2. FAB展開メニュー→退避したショートカットボタン（computeFabMenuTop→computeShortcutsBottomFabOpen）
// このテストは、①未測定時のフォールバック見積もり値（旧来の定数どうしの整合性に相当）と、
// ②意図的に大きく育てた実測値（拡大率・最小フォントサイズ設定を模したシナリオ）の両方で
// 重なりが無いことを検査する。②が無いと「関数は書いたが、実測値を差し込んでも本当に
// 破綻しないか」までは固定できない。

import { describe, it, expect } from "vitest";
import {
  STACK_CLEARANCE_PX,
  BOTTOM_NAV_MIN_HEIGHT_MOBILE_PX,
  FAB_SIZE_PX,
  FAB_BOTTOM_PC_PX,
  FAB_MENU_BOTTOM_PC_PX,
  FAB_MENU_STACK_HEIGHT_ESTIMATE_PC_PX,
  FAB_MENU_STACK_HEIGHT_ESTIMATE_MOBILE_PX,
  SHORTCUTS_BUTTON_MIN_HEIGHT_PX,
  SHORTCUTS_BOTTOM_PC_PX,
  TOAST_ITEM_MIN_HEIGHT_PX,
  TOAST_BOTTOM_PC_PX,
  computeFabBottomMobile,
  computeFabMenuBottom,
  computeFabMenuTop,
  computeShortcutsBottomFabOpen,
  computeAboveFabBottom,
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

/** PC・非展開時のスタック（下から：FAB／ショートカット／Toast。TaskSidePanelフッターは
 *  v3.94でこの1次元モデルの対象外にした＝ファイル冒頭コメント参照）。PCはFAB本体のbottomが
 *  静的なため、実測値は不要（メニュー展開時のみfabMenuHeightPxが要る＝下のbuildPcOpenStack）。 */
function buildPcClosedStack(): StackInterval[] {
  return [
    { name: "fab", bottom: FAB_BOTTOM_PC_PX, height: FAB_SIZE_PX },
    { name: "shortcuts", bottom: SHORTCUTS_BOTTOM_PC_PX, height: SHORTCUTS_BUTTON_MIN_HEIGHT_PX },
    { name: "toast", bottom: TOAST_BOTTOM_PC_PX, height: TOAST_ITEM_MIN_HEIGHT_PX },
  ];
}

/** PC・FABメニュー展開時のスタック（FAB本体の上にメニュー3項目の列が乗り、
 *  ショートカットはさらにその上へ退避する。Toastは開閉によらず静的な位置のまま）。
 *  measuredFabMenuHeightPxは実測値（未測定時のフォールバックはFAB_MENU_STACK_HEIGHT_ESTIMATE_PC_PX）。 */
function buildPcOpenStack(measuredFabMenuHeightPx: number = FAB_MENU_STACK_HEIGHT_ESTIMATE_PC_PX): StackInterval[] {
  const fabMenuTopPx = computeFabMenuTop(FAB_MENU_BOTTOM_PC_PX, measuredFabMenuHeightPx);
  return [
    { name: "fab", bottom: FAB_BOTTOM_PC_PX, height: FAB_SIZE_PX },
    { name: "fabMenu", bottom: FAB_MENU_BOTTOM_PC_PX, height: measuredFabMenuHeightPx },
    { name: "shortcuts", bottom: computeShortcutsBottomFabOpen(fabMenuTopPx), height: SHORTCUTS_BUTTON_MIN_HEIGHT_PX },
    { name: "toast", bottom: TOAST_BOTTOM_PC_PX, height: TOAST_ITEM_MIN_HEIGHT_PX },
  ];
}

/** モバイル・非展開時のスタック（下から：ボトムナビ／FAB／ショートカット／Toast。
 *  TaskSidePanelはモバイルには出ないため対象外＝TaskEditModalが中央寄せの全画面モーダルで
 *  この右下スタックに参加しない。TaskSidePanel.tsx冒頭コメント参照）。
 *  measuredBottomNavHeightPxは実測値（未測定時のフォールバックはBOTTOM_NAV_MIN_HEIGHT_MOBILE_PX）。 */
function buildMobileClosedStack(measuredBottomNavHeightPx: number = BOTTOM_NAV_MIN_HEIGHT_MOBILE_PX): StackInterval[] {
  const fabBottomPx = computeFabBottomMobile(measuredBottomNavHeightPx);
  return [
    { name: "bottomNav", bottom: 0, height: measuredBottomNavHeightPx },
    { name: "fab", bottom: fabBottomPx, height: FAB_SIZE_PX },
    { name: "shortcuts", bottom: computeAboveFabBottom(fabBottomPx), height: SHORTCUTS_BUTTON_MIN_HEIGHT_PX },
    { name: "toast", bottom: computeAboveFabBottom(fabBottomPx), height: TOAST_ITEM_MIN_HEIGHT_PX },
  ];
}

/** モバイル・FABメニュー展開時のスタック */
function buildMobileOpenStack(
  measuredBottomNavHeightPx: number = BOTTOM_NAV_MIN_HEIGHT_MOBILE_PX,
  measuredFabMenuHeightPx: number = FAB_MENU_STACK_HEIGHT_ESTIMATE_MOBILE_PX,
): StackInterval[] {
  const fabBottomPx = computeFabBottomMobile(measuredBottomNavHeightPx);
  const fabMenuBottomPx = computeFabMenuBottom(fabBottomPx);
  const fabMenuTopPx = computeFabMenuTop(fabMenuBottomPx, measuredFabMenuHeightPx);
  return [
    { name: "bottomNav", bottom: 0, height: measuredBottomNavHeightPx },
    { name: "fab", bottom: fabBottomPx, height: FAB_SIZE_PX },
    { name: "fabMenu", bottom: fabMenuBottomPx, height: measuredFabMenuHeightPx },
    { name: "shortcuts", bottom: computeShortcutsBottomFabOpen(fabMenuTopPx), height: SHORTCUTS_BUTTON_MIN_HEIGHT_PX },
    { name: "toast", bottom: computeAboveFabBottom(fabBottomPx), height: TOAST_ITEM_MIN_HEIGHT_PX },
  ];
}

const ALL_SCENARIOS: [string, () => StackInterval[]][] = [
  ["PC・FABメニュー非展開", buildPcClosedStack],
  ["PC・FABメニュー展開", () => buildPcOpenStack()],
  ["モバイル・FABメニュー非展開", () => buildMobileClosedStack()],
  ["モバイル・FABメニュー展開", () => buildMobileOpenStack()],
];

describe("右下スタック（bottomStack.ts）の重なり検査：未測定時のフォールバック見積もり", () => {
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

describe("右下スタック（bottomStack.ts）の重なり検査：実測値が大きく育った場合（拡大率・最小フォントサイズ設定を模す）", () => {
  // 【v3.95で新設】固定heightをやめてminHeightにしたため、実際の描画高さは
  // フォールバック見積もりより大きくなりうる。ここでは意図的に極端な値（見積もりの3倍前後）
  // を実測値として与え、computeFabBottomMobile/computeFabMenuTop等の関数が実際に
  // 追随して衝突を避けられることを固定する。これが無いと「関数は作ったが、実測値が
  // 見積もりから乖離した瞬間に壊れる」という再発を機械的に検知できない。

  it("モバイル：ボトムナビが3倍高くなっても、FAB・ショートカット・Toastは追随してボトムナビと重ならない", () => {
    const grownNavHeightPx = BOTTOM_NAV_MIN_HEIGHT_MOBILE_PX * 3;
    const stack = buildMobileClosedStack(grownNavHeightPx);
    expect(findViolations(stack)).toEqual([]);
    // FABがボトムナビの実測高さぶん、ちゃんと押し上げられていることも確認する
    const fab = stack.find(s => s.name === "fab")!;
    expect(fab.bottom).toBe(grownNavHeightPx + STACK_CLEARANCE_PX);
  });

  it("モバイル：ボトムナビとFABメニューの両方が育っても、展開時のショートカットは重ならない", () => {
    const grownNavHeightPx = BOTTOM_NAV_MIN_HEIGHT_MOBILE_PX * 3;
    const grownMenuHeightPx = FAB_MENU_STACK_HEIGHT_ESTIMATE_MOBILE_PX * 3;
    const stack = buildMobileOpenStack(grownNavHeightPx, grownMenuHeightPx);
    expect(findViolations(stack)).toEqual([]);
  });

  it("PC：FABメニューが3倍高くなっても、退避後のショートカットはメニューと重ならない", () => {
    const grownMenuHeightPx = FAB_MENU_STACK_HEIGHT_ESTIMATE_PC_PX * 3;
    const stack = buildPcOpenStack(grownMenuHeightPx);
    expect(findViolations(stack)).toEqual([]);
    const fabMenu = stack.find(s => s.name === "fabMenu")!;
    const shortcuts = stack.find(s => s.name === "shortcuts")!;
    expect(shortcuts.bottom).toBeGreaterThanOrEqual(fabMenu.bottom + fabMenu.height + STACK_CLEARANCE_PX);
  });

  it("検出ロジックの健全性：実測値の反映を止めて意図的に古い（小さい）値のまま計算すると、育ったボトムナビとFABが重なって検出される", () => {
    // computeFabBottomMobileへ実測値を渡さず、見積もり値のまま計算してしまった場合の
    // 「壊れたコード」を模したフィクスチャ。このテスト自体が誤って常にfalseを返す
    // 壊れたテストになっていないことを確認する。
    const grownNavHeightPx = BOTTOM_NAV_MIN_HEIGHT_MOBILE_PX * 3;
    const brokenStack: StackInterval[] = [
      { name: "bottomNav", bottom: 0, height: grownNavHeightPx },
      // 本来は computeFabBottomMobile(grownNavHeightPx) を使うべきところを、
      // 見積もり値のまま固定してしまった想定（実測を無視するバグの再現）
      { name: "fab", bottom: computeFabBottomMobile(BOTTOM_NAV_MIN_HEIGHT_MOBILE_PX), height: FAB_SIZE_PX },
    ];
    expect(findViolations(brokenStack)).not.toEqual([]);
  });
});
