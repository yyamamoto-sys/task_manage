// src/components/tour/tours/__tests__/firstTimeTour.test.ts
//
// 初回ツアー（first-time.ts）が docs/dev/tour-guidelines.md の基本ルール（§9・§11）と、
// 今の画面の構成（設定ページ・表示部署・サイドバー最下部「⋯」）から外れていないことの検査。

import { describe, it, expect } from "vitest";
import { firstTimeTour } from "../first-time";
import { buildTours, FIRST_TIME_TOUR_ID } from "..";

describe("firstTimeTour", () => {
  it("11ステップ以内に収まる", () => {
    expect(firstTimeTour.steps.length).toBeLessThanOrEqual(11);
  });

  it("ステップidが重複しない", () => {
    const ids = firstTimeTour.steps.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("targetを持つステップは必ずskipIfMissingがtrue（表示部署のセレクタは複数部署の人にしか出ない）", () => {
    for (const step of firstTimeTour.steps) {
      if (step.target) expect(step.skipIfMissing).toBe(true);
    }
  });

  it("表示部署・設定ページのステップがあり、対象のdata-tour-idを指している", () => {
    const byId = new Map(firstTimeTour.steps.map(s => [s.id, s]));
    expect(byId.get("group-selector")?.target).toBe("group-selector");
    expect(byId.get("settings")?.target).toBe("settings-btn");
  });

  it("ガイドは「⋯」の中にあると案内し、古い「左下」表記を使わない", () => {
    const text = firstTimeTour.steps.map(s => s.body).join("\n");
    expect(text).toContain("⋯");
    expect(text).not.toContain("左下");
  });

  it("タスクの編集が「保存」ボタン方式であることを案内する", () => {
    const fab = firstTimeTour.steps.find(s => s.id === "fab");
    expect(fab?.body).toContain("保存");
  });

  it("PJ分析ボタンの名称が実際の画面（✨ このPJをAI分析）と一致する", () => {
    const nav = firstTimeTour.steps.find(s => s.id === "pj-karte-nav");
    expect(nav?.body).toContain("✨ このPJをAI分析");
  });

  it("ゲスト版でも表示部署・設定のステップはskipIfMissing付きで残る（無ければ自動で飛ばされる）", () => {
    const guest = buildTours({ isGuest: true })[FIRST_TIME_TOUR_ID];
    for (const id of ["group-selector", "settings"]) {
      const step = guest.steps.find(s => s.id === id);
      expect(step?.skipIfMissing).toBe(true);
    }
  });
});
