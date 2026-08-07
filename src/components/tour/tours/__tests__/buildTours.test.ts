// src/components/tour/tours/__tests__/buildTours.test.ts
//
// ゲスト（サンプル閲覧）向けツアー定義の回帰防止テスト。CLAUDE.md Section 23参照。
// - ゲスト版に demo-ai-consult アクション（実際にAI相談を送信する）が残っていないこと
// - ゲスト版に fab ステップ（ゲストでは非表示のFABの説明）が無いこと
// - 非ゲスト版は ALL_TOURS と同一であること（通常ユーザーへの無影響）
// - buildTours({isGuest:true}) 呼び出し後も元の firstTimeTour が書き換わっていないこと

import { describe, it, expect } from "vitest";
import { buildTours, ALL_TOURS, FIRST_TIME_TOUR_ID } from "..";

describe("buildTours", () => {
  it("非ゲストではALL_TOURSをそのまま返す", () => {
    const tours = buildTours({ isGuest: false });
    expect(tours).toBe(ALL_TOURS);
  });

  it("ゲスト版にdemo-ai-consultアクションを持つステップが1つも無い", () => {
    const tours = buildTours({ isGuest: true });
    const guestTour = tours[FIRST_TIME_TOUR_ID];
    expect(guestTour).toBeDefined();
    const hasDemoAction = guestTour.steps.some(step => step.action === "demo-ai-consult");
    expect(hasDemoAction).toBe(false);
  });

  it("ゲスト版にfabステップが無い", () => {
    const tours = buildTours({ isGuest: true });
    const guestTour = tours[FIRST_TIME_TOUR_ID];
    const hasFab = guestTour.steps.some(step => step.id === "fab");
    expect(hasFab).toBe(false);
  });

  it("ai-consult-demoステップは説明のみ（target無し）に差し替わっている", () => {
    const tours = buildTours({ isGuest: true });
    const guestTour = tours[FIRST_TIME_TOUR_ID];
    const step = guestTour.steps.find(s => s.id === "ai-consult-demo");
    expect(step).toBeDefined();
    expect(step?.target).toBeUndefined();
    expect(step?.action).toBeUndefined();
    expect(step?.placement).toBe("center");
    expect(step?.body.length).toBeGreaterThan(0);
  });

  it("welcomeステップにサンプルデータである旨が1行加わっている", () => {
    const tours = buildTours({ isGuest: true });
    const guestTour = tours[FIRST_TIME_TOUR_ID];
    const welcome = guestTour.steps.find(s => s.id === "welcome");
    expect(welcome?.body).toContain("架空のサンプルデータ");
  });

  it("buildTours({isGuest:true})を呼んだ後もALL_TOURS（元のfirstTimeTour）が変化しない", () => {
    const beforeSnapshot = JSON.stringify(ALL_TOURS);
    buildTours({ isGuest: true });
    const afterSnapshot = JSON.stringify(ALL_TOURS);
    expect(afterSnapshot).toBe(beforeSnapshot);

    // fab・demo-ai-consultは元のツアーには引き続き存在すること（破壊的変更されていない証拠）
    const originalTour = ALL_TOURS[FIRST_TIME_TOUR_ID];
    expect(originalTour.steps.some(s => s.id === "fab")).toBe(true);
    expect(originalTour.steps.some(s => s.action === "demo-ai-consult")).toBe(true);
  });

  it("ゲスト版の全ステップについて、targetを持つならskipIfMissingがtrue", () => {
    const tours = buildTours({ isGuest: true });
    const guestTour = tours[FIRST_TIME_TOUR_ID];
    for (const step of guestTour.steps) {
      if (step.target) {
        expect(step.skipIfMissing).toBe(true);
      }
    }
  });
});
