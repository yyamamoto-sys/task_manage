// src/lib/layout/__tests__/floatingPanelPosition.test.ts
//
// 【設計意図】computeFloatingPanelPosition() のクランプ・反転ロジックを固定する。
// ProjectRowMenu.tsx の既存実装（移行前）と数値が一致することを最初のテストで確認し、
// 「切り出しても挙動が変わっていない」ことを担保する。

import { describe, expect, it } from "vitest";
import { computeFloatingPanelPosition, type FloatingPanelTriggerRect } from "../floatingPanelPosition";

const VIEWPORT_W = 1280;
const VIEWPORT_H = 800;

function rect(partial: Partial<FloatingPanelTriggerRect> & { top: number; left: number; width: number }): FloatingPanelTriggerRect {
  return {
    top: partial.top,
    left: partial.left,
    bottom: partial.bottom ?? partial.top + 30,
    right: partial.right ?? partial.left + partial.width,
  };
}

describe("computeFloatingPanelPosition", () => {
  it("十分な空きがある通常ケース（align='left'）：トリガー直下・左端揃え", () => {
    const pos = computeFloatingPanelPosition({
      triggerRect: rect({ top: 100, left: 100, width: 120 }),
      panelWidth: 200,
      estimatedPanelHeight: 200,
      viewportWidth: VIEWPORT_W,
      viewportHeight: VIEWPORT_H,
    });
    expect(pos).toEqual({ top: 134, left: 100 }); // bottom(130) + 4
  });

  it("align='right'：ProjectRowMenuの既存実装と同じ計算結果になる（回帰なしの確認）", () => {
    // 旧ProjectRowMenu.calcPanelStyle: left = rect.right - PANEL_WIDTH(190) / margin=8
    const trigger = rect({ top: 200, left: 1000, width: 22 }); // right=1022
    const pos = computeFloatingPanelPosition({
      triggerRect: trigger,
      panelWidth: 190,
      estimatedPanelHeight: 3 * 34 + 8, // 3項目
      viewportWidth: VIEWPORT_W,
      viewportHeight: VIEWPORT_H,
      align: "right",
    });
    expect(pos.left).toBe(1022 - 190); // 832
    expect(pos.top).toBe(230 + 4); // bottom=230
  });

  it("右端はみ出し：viewportWidth - panelWidth - margin にクランプする", () => {
    const pos = computeFloatingPanelPosition({
      triggerRect: rect({ top: 100, left: 1200, width: 120 }), // right=1320 > viewport 1280
      panelWidth: 200,
      estimatedPanelHeight: 100,
      viewportWidth: VIEWPORT_W,
      viewportHeight: VIEWPORT_H,
    });
    expect(pos.left).toBe(VIEWPORT_W - 200 - DEFAULT_MARGIN_FOR_TEST());
  });

  it("左端はみ出し：margin にクランプする", () => {
    const pos = computeFloatingPanelPosition({
      triggerRect: rect({ top: 100, left: -50, width: 30 }),
      panelWidth: 200,
      estimatedPanelHeight: 100,
      viewportWidth: VIEWPORT_W,
      viewportHeight: VIEWPORT_H,
    });
    expect(pos.left).toBe(8);
  });

  it("パネル幅がビューポートより広い極端なケースでも左端(margin)を保証する", () => {
    const pos = computeFloatingPanelPosition({
      triggerRect: rect({ top: 100, left: 500, width: 100 }),
      panelWidth: 2000,
      estimatedPanelHeight: 100,
      viewportWidth: VIEWPORT_W,
      viewportHeight: VIEWPORT_H,
    });
    expect(pos.left).toBe(8);
  });

  it("下に十分な空きが無い場合、トリガーの上へ反転する", () => {
    const pos = computeFloatingPanelPosition({
      triggerRect: rect({ top: 700, left: 100, width: 120, bottom: 730 }), // bottom+4+height(200) > 800-8
      panelWidth: 200,
      estimatedPanelHeight: 200,
      viewportWidth: VIEWPORT_W,
      viewportHeight: VIEWPORT_H,
    });
    expect(pos.top).toBe(700 - 200 - 4); // triggerRect.top - height - 4
  });

  it("反転しても画面外に出る場合は margin まで押し上げる（それ以上は上げない）", () => {
    const pos = computeFloatingPanelPosition({
      triggerRect: rect({ top: 50, left: 100, width: 120, bottom: 780 }), // 巨大なトリガー想定
      panelWidth: 200,
      estimatedPanelHeight: 500,
      viewportWidth: VIEWPORT_W,
      viewportHeight: VIEWPORT_H,
    });
    // bottom(780)+4+500 > 800-8 → 反転: top(50)-500-4 = -454 < margin(8) → margin
    expect(pos.top).toBe(8);
  });

  it("margin を明示指定すると反映される", () => {
    const pos = computeFloatingPanelPosition({
      triggerRect: rect({ top: 100, left: 1200, width: 120 }),
      panelWidth: 200,
      estimatedPanelHeight: 100,
      viewportWidth: VIEWPORT_W,
      viewportHeight: VIEWPORT_H,
      margin: 20,
    });
    expect(pos.left).toBe(VIEWPORT_W - 200 - 20);
  });
});

function DEFAULT_MARGIN_FOR_TEST(): number {
  return 8;
}
