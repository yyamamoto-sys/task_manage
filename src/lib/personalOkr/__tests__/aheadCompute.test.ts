import { describe, it, expect } from "vitest";
import { computeAheadFacts, isTargetAndEvidenceSet } from "../aheadCompute";
import type { MonthWeekSegment } from "../../date/monthWeeks";
import type { PersonalKrWeek } from "../../localData/types";

// 2026年8月（実際に6週になる月。CLAUDE.md Section 24・monthWeeks.test.ts参照）を手組みで固定する。
const AUG_SEGMENTS: MonthWeekSegment[] = [
  { weekIndex: 1, weekStart: new Date(2026, 7, 1), weekEnd: new Date(2026, 7, 2) },
  { weekIndex: 2, weekStart: new Date(2026, 7, 3), weekEnd: new Date(2026, 7, 9) },
  { weekIndex: 3, weekStart: new Date(2026, 7, 10), weekEnd: new Date(2026, 7, 16) },
  { weekIndex: 4, weekStart: new Date(2026, 7, 17), weekEnd: new Date(2026, 7, 23) },
  { weekIndex: 5, weekStart: new Date(2026, 7, 24), weekEnd: new Date(2026, 7, 30) },
  { weekIndex: 6, weekStart: new Date(2026, 7, 31), weekEnd: new Date(2026, 7, 31) },
];

function makeWeek(overrides: Partial<PersonalKrWeek> & { week_index: number }): PersonalKrWeek {
  return {
    id: `w${overrides.week_index}`,
    personal_kr_id: "kr1",
    month: "2026-08-01",
    week_start: "2026-08-01",
    week_end: "2026-08-02",
    goal_state: null,
    self_rating: null,
    is_deleted: false,
    ...overrides,
  };
}

describe("computeAheadFacts", () => {
  it("モックと同じ状況（W1=o・W2=t・W3は目標のみ・W4/W5/W6未設定、今日=8/6）", () => {
    const weeks: PersonalKrWeek[] = [
      makeWeek({ week_index: 1, goal_state: "検証ログの形式が決まっている", self_rating: "o" }),
      makeWeek({ week_index: 2, goal_state: "判定基準の合意が取れている", self_rating: "t" }),
      makeWeek({ week_index: 3, goal_state: "非名人1名が試作を1本出せている", self_rating: null }),
    ];
    const facts = computeAheadFacts(AUG_SEGMENTS, weeks, new Date(2026, 7, 6));

    expect(facts.weeksRemaining).toBe(5); // W2〜W6（W1は8/2で終わっているため対象外）
    expect(facts.daysUntilMonthEnd).toBe(26); // 8/6〜8/31（今日を含む）
    expect(facts.ratingCounts).toEqual({ o: 1, t: 1, x: 0 });
    expect(facts.unsetGoalWeekLabels).toEqual(["W4", "W5", "W6"]);
    expect(facts.unratedWeekLabels).toEqual(["W3"]);
    expect(facts.remainingUnsetGoalWeekLabels).toEqual(["W4", "W5", "W6"]);
    expect(facts.remainingUnsetGoalCount).toBe(3);
  });

  it("今日が月初なら全週が残り週になる", () => {
    const facts = computeAheadFacts(AUG_SEGMENTS, [], new Date(2026, 7, 1));
    expect(facts.weeksRemaining).toBe(6);
    expect(facts.daysUntilMonthEnd).toBe(31);
    expect(facts.unsetGoalWeekLabels).toEqual(["W1", "W2", "W3", "W4", "W5", "W6"]);
    expect(facts.remainingUnsetGoalCount).toBe(6);
  });

  it("今日が月末日なら残り週は最後の1週のみ・月末までの日数は1", () => {
    const facts = computeAheadFacts(AUG_SEGMENTS, [], new Date(2026, 7, 31));
    expect(facts.weeksRemaining).toBe(1);
    expect(facts.daysUntilMonthEnd).toBe(1);
    expect(facts.remainingUnsetGoalWeekLabels).toEqual(["W6"]);
  });

  it("週レコードが1件も無ければ全週が未設定扱いで自己評価は全て0", () => {
    const facts = computeAheadFacts(AUG_SEGMENTS, [], new Date(2026, 7, 6));
    expect(facts.ratingCounts).toEqual({ o: 0, t: 0, x: 0 });
    expect(facts.unratedWeekLabels).toEqual([]);
    expect(facts.unsetGoalWeekLabels.length).toBe(6);
  });

  it("goal_stateが空文字のみの週は未設定扱い", () => {
    const weeks: PersonalKrWeek[] = [makeWeek({ week_index: 1, goal_state: "   ", self_rating: null })];
    const facts = computeAheadFacts(AUG_SEGMENTS, weeks, new Date(2026, 7, 1));
    expect(facts.unsetGoalWeekLabels).toContain("W1");
    expect(facts.unratedWeekLabels).not.toContain("W1");
  });

  it("目標状態が無いのに自己評価だけ入っている週は、件数には数えるが未設定リストに残す（未評価リストには入れない）", () => {
    const weeks: PersonalKrWeek[] = [makeWeek({ week_index: 1, goal_state: null, self_rating: "x" })];
    const facts = computeAheadFacts(AUG_SEGMENTS, weeks, new Date(2026, 7, 1));
    expect(facts.ratingCounts.x).toBe(1);
    expect(facts.unsetGoalWeekLabels).toContain("W1");
    expect(facts.unratedWeekLabels).not.toContain("W1");
  });

  it("segmentsが空なら例外を投げず全項目が0・空配列", () => {
    const facts = computeAheadFacts([], [], new Date(2026, 7, 6));
    expect(facts).toEqual({
      weeksRemaining: 0,
      daysUntilMonthEnd: 0,
      ratingCounts: { o: 0, t: 0, x: 0 },
      unsetGoalWeekLabels: [],
      unratedWeekLabels: [],
      remainingUnsetGoalWeekLabels: [],
      remainingUnsetGoalCount: 0,
    });
  });

  it("is_deletedの週レコードが混ざっていても呼び出し側でフィルタ済み前提（この関数自体はis_deletedを見ない）", () => {
    // PersonalKrPanel側がweeks.filter(w=>!w.is_deleted)を渡す前提。関数自体は素直にbyIndexへ載せる。
    const weeks: PersonalKrWeek[] = [makeWeek({ week_index: 1, goal_state: "目標", self_rating: "o", is_deleted: true })];
    const facts = computeAheadFacts(AUG_SEGMENTS, weeks, new Date(2026, 7, 1));
    expect(facts.ratingCounts.o).toBe(1);
  });
});

describe("isTargetAndEvidenceSet", () => {
  it("null/undefined/空文字/空白のみはfalse", () => {
    expect(isTargetAndEvidenceSet(null)).toBe(false);
    expect(isTargetAndEvidenceSet(undefined)).toBe(false);
    expect(isTargetAndEvidenceSet("")).toBe(false);
    expect(isTargetAndEvidenceSet("   ")).toBe(false);
  });

  it("中身のある文字列はtrue（前後空白はtrimして判定）", () => {
    expect(isTargetAndEvidenceSet("非名人2名がテンプレのみで提案を作れている")).toBe(true);
    expect(isTargetAndEvidenceSet("  テキスト  ")).toBe(true);
  });
});
