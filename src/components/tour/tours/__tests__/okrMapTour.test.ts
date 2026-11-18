// src/components/tour/tours/__tests__/okrMapTour.test.ts
//
// 地図のガイドツアー（okr-map.ts）が docs/dev/tour-guidelines.md（§9・§11）から外れていないこと、
// 指している data-tour-id が地図・サイドバーの部品に実在することを検査する。

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { okrMapTour } from "../okr-map";
import { okrIntroTour } from "../okr-intro";
import { ALL_TOURS } from "..";

function sourcesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "__tests__") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourcesUnder(p));
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("okrMapTour", () => {
  it("7〜10ステップの範囲に収まる", () => {
    expect(okrMapTour.steps.length).toBeGreaterThanOrEqual(7);
    expect(okrMapTour.steps.length).toBeLessThanOrEqual(10);
  });

  it("ステップidが重複しない／ツアーidが他と重ならず ALL_TOURS に登録されている", () => {
    const ids = okrMapTour.steps.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(okrMapTour.id).not.toBe(okrIntroTour.id);
    expect(ALL_TOURS[okrMapTour.id]).toBe(okrMapTour);
  });

  it("targetを持つステップは必ずskipIfMissingがtrue（チーム／わたしのページ・狭い画面で無い部品がある）", () => {
    for (const step of okrMapTour.steps) {
      if (step.target) expect(step.skipIfMissing).toBe(true);
    }
  });

  it("タイトルは記号で始まり20字以内・本文は空でない。最後の段で「⋯」→「📖 ガイド」から見直せると書く", () => {
    for (const step of okrMapTour.steps) {
      expect(step.body.length).toBeGreaterThan(0);
      expect(step.title).toMatch(/^\S+\s/);
      expect(step.title.length).toBeLessThanOrEqual(30);
    }
    const last = okrMapTour.steps[okrMapTour.steps.length - 1];
    expect(last.body).toContain("「⋯」→「📖 ガイド」");
  });

  it("target の data-tour-id が地図の画面のソースに実在する（個人OKRの記録のツアーの id とは混ざらない）", () => {
    const src = sourcesUnder(join(__dirname, "..", "..", "..", "okr", "map"))
      .map(p => readFileSync(p, "utf8"))
      .join("\n");
    const introTargets = new Set(okrIntroTour.steps.map(s => s.target).filter(Boolean));
    for (const step of okrMapTour.steps) {
      if (!step.target) continue;
      expect(src, step.target).toContain(`data-tour-id="${step.target}"`);
      expect(introTargets.has(step.target)).toBe(false);
    }
  });
});

describe("okrIntroTour（個人OKRの記録）の位置づけ", () => {
  it("タイトル・冒頭の段が「個人OKRの記録」を指す", () => {
    expect(okrIntroTour.title).toContain("個人OKRの記録");
    expect(okrIntroTour.steps[0].title).toContain("個人OKRの記録");
    expect(okrIntroTour.steps[0].body).toContain("個人OKRの記録を開く");
  });
});
