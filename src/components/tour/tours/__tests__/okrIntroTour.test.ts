// src/components/tour/tours/__tests__/okrIntroTour.test.ts
//
// OKRモードのガイドツアー（okr-intro.ts）が docs/dev/tour-guidelines.md の
// 基本ルール（§9・§11チェックリスト）から外れていないことを機械的に検証する。

import { describe, it, expect } from "vitest";
import { okrIntroTour } from "../okr-intro";

describe("okrIntroTour", () => {
  it("7〜9ステップの範囲に収まる（§9：長さの目安）", () => {
    expect(okrIntroTour.steps.length).toBeGreaterThanOrEqual(7);
    expect(okrIntroTour.steps.length).toBeLessThanOrEqual(9);
  });

  it("ステップidが重複しない", () => {
    const ids = okrIntroTour.steps.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("targetを持つステップは必ずskipIfMissingがtrue（UI変更耐性）", () => {
    for (const step of okrIntroTour.steps) {
      if (step.target) expect(step.skipIfMissing).toBe(true);
    }
  });

  it("タイトルは絵文字（または★等の記号）で始まり、本文は空でない", () => {
    // タイトル先頭の記号1個（サロゲートペア・異字体セレクタを含む場合がある）+ 半角スペース +
    // 日本語見出し、という既存ツアーと同じ体裁を検査する（厳密な文字種判定は行わない）。
    for (const step of okrIntroTour.steps) {
      expect(step.body.length).toBeGreaterThan(0);
      expect(step.title).toMatch(/^\S+\s/);
      expect(step.title.length).toBeLessThanOrEqual(30);
    }
  });
});
