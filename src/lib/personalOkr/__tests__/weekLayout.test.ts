// src/lib/personalOkr/__tests__/weekLayout.test.ts
//
// 🔴 5週固定・6週打ち切りにしないことの回帰テスト（CLAUDE.md Section 24・
// docs/dev/okr-redesign-plan.md §3-3）。2026年8月は実際に6週になる月。

import { describe, expect, it } from "vitest";
import { buildWeekCards } from "../weekLayout";
import { computeMonthWeekSegments } from "../../date/monthWeeks";
import type { PersonalKrWeek } from "../../localData/types";

function makeWeek(overrides: Partial<PersonalKrWeek>): PersonalKrWeek {
  return {
    id: "w-1",
    personal_kr_id: "kr-1",
    month: "2026-08-01",
    week_index: 1,
    week_start: "2026-08-01",
    week_end: "2026-08-02",
    goal_state: null,
    self_rating: null,
    is_deleted: false,
    ...overrides,
  };
}

describe("buildWeekCards", () => {
  it("2026年8月（6週になる月）は6件のカードを返す。5列に切り詰めない", () => {
    const segments = computeMonthWeekSegments(new Date(2026, 7, 1));
    const cards = buildWeekCards(segments, []);
    expect(cards).toHaveLength(6);
    expect(cards.map(c => c.weekIndex)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("2026年2月（5週になる月）は5件のカードを返す", () => {
    const segments = computeMonthWeekSegments(new Date(2026, 1, 1));
    const cards = buildWeekCards(segments, []);
    expect(cards).toHaveLength(5);
  });

  it("1日だけの週（W1）も破綻せずweekStartStr===weekEndStrで表現される", () => {
    const segments = computeMonthWeekSegments(new Date(2026, 1, 1)); // 2026-02-01は日曜→W1は1日だけ
    const cards = buildWeekCards(segments, []);
    expect(cards[0].weekStartStr).toBe("2026-02-01");
    expect(cards[0].weekStartStr).toBe(cards[0].weekEndStr);
  });

  it("既存の週レコードをweek_indexで突き合わせる。データが無いセグメントはexisting:null", () => {
    const segments = computeMonthWeekSegments(new Date(2026, 7, 1));
    const existing = makeWeek({ id: "w-2", week_index: 2, week_start: "2026-08-03", week_end: "2026-08-09", goal_state: "判定基準の合意" });
    const cards = buildWeekCards(segments, [existing]);
    expect(cards.find(c => c.weekIndex === 2)?.existing?.id).toBe("w-2");
    expect(cards.find(c => c.weekIndex === 1)?.existing).toBeNull();
    expect(cards.find(c => c.weekIndex === 6)?.existing).toBeNull();
  });
});
