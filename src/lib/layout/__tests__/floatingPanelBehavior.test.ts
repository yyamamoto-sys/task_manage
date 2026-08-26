// src/lib/layout/__tests__/floatingPanelBehavior.test.ts
//
// 【設計意図・2026-08-26】
// トリガー追従型ポップオーバーの2つの判断をDOM抜きで固定する。
//   1) スクロールしたときに閉じるべきか（computeFloatingPanelCloseOnScroll）
//   2) パネルの maxHeight をいくつにするか（computeFloatingPanelMaxHeight）
// テスト環境は environment:"node" でDOMが無いため、判断そのものを純粋関数に切り出して
// ここで検査する（computeFloatingPanelPosition と同じ流儀）。

import { describe, expect, it } from "vitest";
import {
  computeFloatingPanelCloseOnScroll,
  computeFloatingPanelMaxHeight,
  computeFloatingPanelPosition,
  FLOATING_PANEL_OVERSCROLL_BEHAVIOR,
  type FloatingPanelTriggerRect,
} from "../floatingPanelPosition";

const VIEWPORT_W = 1280;
const VIEWPORT_H = 800;

function rect(top: number, left: number, width: number, height: number): FloatingPanelTriggerRect {
  return { top, left, bottom: top + height, right: left + width };
}

// ============================================================
// 1) スクロール時に閉じるかの判断
// ============================================================
describe("computeFloatingPanelCloseOnScroll", () => {
  const visibleTrigger = rect(300, 400, 60, 20);
  const listContainer = rect(200, 0, 1280, 500); // ListViewの表本体のような祖先スクロール容器

  it("パネル内部のスクロールでは閉じない（目的の項目まで送れる）", () => {
    expect(computeFloatingPanelCloseOnScroll({
      scrolledInsidePanel: true,
      triggerRect: visibleTrigger,
      clipRect: listContainer,
      viewportWidth: VIEWPORT_W,
      viewportHeight: VIEWPORT_H,
    })).toBe(false);
  });

  it("パネル内部のスクロールなら、トリガーが可視範囲外でも閉じない（判定を先に打ち切る）", () => {
    expect(computeFloatingPanelCloseOnScroll({
      scrolledInsidePanel: true,
      triggerRect: rect(-100, 400, 60, 20),
      clipRect: listContainer,
      viewportWidth: VIEWPORT_W,
      viewportHeight: VIEWPORT_H,
    })).toBe(false);
  });

  it("祖先がスクロールしても、トリガーが可視範囲内にとどまる限り閉じない", () => {
    expect(computeFloatingPanelCloseOnScroll({
      scrolledInsidePanel: false,
      triggerRect: visibleTrigger,
      clipRect: listContainer,
      viewportWidth: VIEWPORT_W,
      viewportHeight: VIEWPORT_H,
    })).toBe(false);
  });

  it("トリガーがスクロール容器の上に流れて隠れたら閉じる", () => {
    expect(computeFloatingPanelCloseOnScroll({
      scrolledInsidePanel: false,
      triggerRect: rect(150, 400, 60, 20), // bottom=170 < container.top=200
      clipRect: listContainer,
      viewportWidth: VIEWPORT_W,
      viewportHeight: VIEWPORT_H,
    })).toBe(true);
  });

  it("トリガーがスクロール容器の下に流れて隠れたら閉じる", () => {
    expect(computeFloatingPanelCloseOnScroll({
      scrolledInsidePanel: false,
      triggerRect: rect(720, 400, 60, 20), // top=720 > container.bottom=700
      clipRect: listContainer,
      viewportWidth: VIEWPORT_W,
      viewportHeight: VIEWPORT_H,
    })).toBe(true);
  });

  it("スクロール容器の縁に少しだけかかっている間は閉じない（境界で点滅しない）", () => {
    // container.top=200 に対しトリガーは 190..210 → 10px 見えている
    expect(computeFloatingPanelCloseOnScroll({
      scrolledInsidePanel: false,
      triggerRect: rect(190, 400, 60, 20),
      clipRect: listContainer,
      viewportWidth: VIEWPORT_W,
      viewportHeight: VIEWPORT_H,
    })).toBe(false);
  });

  it("ビューポート外に出たら（スクロール容器が無い場合でも）閉じる", () => {
    expect(computeFloatingPanelCloseOnScroll({
      scrolledInsidePanel: false,
      triggerRect: rect(VIEWPORT_H + 40, 400, 60, 20),
      clipRect: null,
      viewportWidth: VIEWPORT_W,
      viewportHeight: VIEWPORT_H,
    })).toBe(true);
  });

  it("横方向に流れて隠れた場合も閉じる", () => {
    expect(computeFloatingPanelCloseOnScroll({
      scrolledInsidePanel: false,
      triggerRect: rect(300, -100, 60, 20), // right=-40
      clipRect: null,
      viewportWidth: VIEWPORT_W,
      viewportHeight: VIEWPORT_H,
    })).toBe(true);
  });

  it("トリガーが外れている（アンマウント済み）なら閉じる", () => {
    expect(computeFloatingPanelCloseOnScroll({
      scrolledInsidePanel: false,
      triggerRect: null,
      viewportWidth: VIEWPORT_W,
      viewportHeight: VIEWPORT_H,
    })).toBe(true);
  });
});

// ============================================================
// 2) パネル高さ（固定値の見積もりをやめる）
// ============================================================
describe("computeFloatingPanelMaxHeight", () => {
  const PREFERRED = 320;
  const MIN = 120;

  it("下に十分な余白があれば希望値をそのまま使い、下に出す", () => {
    const r = computeFloatingPanelMaxHeight({
      triggerRect: rect(100, 400, 60, 20),
      viewportHeight: VIEWPORT_H,
      preferredHeight: PREFERRED,
      minHeight: MIN,
    });
    expect(r).toMatchObject({ maxHeight: PREFERRED, placement: "below" });
  });

  it("下が足りず上が足りるなら、希望値のまま上に出す", () => {
    // bottom=620 → 下の余白 = 800-8-624 = 168 < 320 ／ 上の余白 = 600-4-8 = 588 >= 320
    const r = computeFloatingPanelMaxHeight({
      triggerRect: rect(600, 400, 60, 20),
      viewportHeight: VIEWPORT_H,
      preferredHeight: PREFERRED,
      minHeight: MIN,
    });
    expect(r).toMatchObject({ maxHeight: PREFERRED, placement: "above" });
  });

  it("上下とも希望値に足りないときは、広い側を選んでその余白に収める", () => {
    // viewportHeight=400 / トリガー 150..170 → 下=400-8-174=218 ／ 上=150-4-8=138
    const r = computeFloatingPanelMaxHeight({
      triggerRect: rect(150, 400, 60, 20),
      viewportHeight: 400,
      preferredHeight: PREFERRED,
      minHeight: MIN,
    });
    expect(r.placement).toBe("below");
    expect(r.maxHeight).toBe(218);
    expect(r.maxHeight).toBeLessThan(PREFERRED);
  });

  it("上のほうが広ければ上を選ぶ", () => {
    // viewportHeight=400 / トリガー 300..320 → 下=400-8-324=68 ／ 上=300-4-8=288
    const r = computeFloatingPanelMaxHeight({
      triggerRect: rect(300, 400, 60, 20),
      viewportHeight: 400,
      preferredHeight: PREFERRED,
      minHeight: MIN,
    });
    expect(r.placement).toBe("above");
    expect(r.maxHeight).toBe(288);
  });

  it("極端に狭いときでも minHeight を下回らない（1〜2行しか出ない状態を作らない）", () => {
    // viewportHeight=200 / トリガー 90..110 → 下=200-8-114=78 ／ 上=90-4-8=78
    const r = computeFloatingPanelMaxHeight({
      triggerRect: rect(90, 400, 60, 20),
      viewportHeight: 200,
      preferredHeight: PREFERRED,
      minHeight: MIN,
    });
    expect(r.maxHeight).toBe(MIN);
  });

  it("希望値を超えることはない", () => {
    const r = computeFloatingPanelMaxHeight({
      triggerRect: rect(10, 400, 60, 20),
      viewportHeight: 4000,
      preferredHeight: PREFERRED,
      minHeight: MIN,
    });
    expect(r.maxHeight).toBe(PREFERRED);
  });

  it("算出した高さを位置計算に渡すと、パネルはビューポート内に収まる", () => {
    // 実測後の再クランプ相当。下端に近いトリガーでも画面外に出ないこと
    const trigger = rect(700, 1100, 60, 20);
    const h = computeFloatingPanelMaxHeight({
      triggerRect: trigger,
      viewportHeight: VIEWPORT_H,
      preferredHeight: PREFERRED,
      minHeight: MIN,
    });
    const pos = computeFloatingPanelPosition({
      triggerRect: trigger,
      panelWidth: 220,
      estimatedPanelHeight: h.maxHeight,
      viewportWidth: VIEWPORT_W,
      viewportHeight: VIEWPORT_H,
    });
    expect(pos.top).toBeGreaterThanOrEqual(8);
    expect(pos.top + h.maxHeight).toBeLessThanOrEqual(VIEWPORT_H - 8);
    expect(pos.left).toBeGreaterThanOrEqual(8);
    expect(pos.left + 220).toBeLessThanOrEqual(VIEWPORT_W - 8);
  });

  it("実測値（見積もりより大きい実際の幅・高さ）で再計算してもビューポート内に収まる", () => {
    const trigger = rect(500, 1180, 40, 20);
    const measuredWidth = 340;  // 見積もり220より実測が大きかったケース
    const measuredHeight = 300;
    const pos = computeFloatingPanelPosition({
      triggerRect: trigger,
      panelWidth: measuredWidth,
      estimatedPanelHeight: measuredHeight,
      viewportWidth: VIEWPORT_W,
      viewportHeight: VIEWPORT_H,
    });
    expect(pos.left).toBeGreaterThanOrEqual(8);
    expect(pos.left + measuredWidth).toBeLessThanOrEqual(VIEWPORT_W - 8);
    expect(pos.top).toBeGreaterThanOrEqual(8);
    expect(pos.top + measuredHeight).toBeLessThanOrEqual(VIEWPORT_H - 8);
  });
});

describe("スクロール連鎖の遮断値", () => {
  it("パネルのスクロールを祖先へ連鎖させない値を共有定数として持つ", () => {
    expect(FLOATING_PANEL_OVERSCROLL_BEHAVIOR).toBe("contain");
  });
});
