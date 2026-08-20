import { describe, it, expect } from "vitest";
import { computeReviewMaterial, isReviewMaterialEmpty } from "../reviewMaterial";
import type { MonthWeekSegment } from "../../date/monthWeeks";
import type { PersonalKrWeek, Task } from "../../localData/types";

// 2026年8月（実際に6週になる月。aheadCompute.test.tsと同じ固定セグメント）
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

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    name: "task",
    project_id: null,
    todo_ids: [],
    assignee_member_id: "",
    assignee_member_ids: [],
    status: "todo",
    priority: null,
    start_date: null,
    due_date: null,
    estimated_hours: null,
    comment: "",
    is_deleted: false,
    ...overrides,
  };
}

const TODAY = new Date(2026, 7, 31); // 月末=全週を評価対象に含める

describe("computeReviewMaterial", () => {
  it("週の目標状態が0本・自己評価も0件のとき（材料なし）", () => {
    const material = computeReviewMaterial(AUG_SEGMENTS, [], [], [], [], TODAY);
    expect(material.weeksTotal).toBe(6);
    expect(material.ratingCounts).toEqual({ o: 0, t: 0, x: 0 });
    expect(material.weeksWithGoalSet).toBe(0);
    expect(material.unratedWeekCount).toBe(6);
    expect(material.linkedTaskCount).toBe(0);
    expect(material.completedTaskCount).toBe(0);
    expect(material.incompleteTaskCount).toBe(0);
    expect(isReviewMaterialEmpty(material)).toBe(true);
  });

  it("週の目標状態は書いたが自己評価が全て未評価（材料あり＝目標状態だけでも空扱いにしない）", () => {
    const weeks: PersonalKrWeek[] = [
      makeWeek({ week_index: 1, goal_state: "検証ログの形式を決める", self_rating: null }),
      makeWeek({ week_index: 2, goal_state: "判定基準の合意を取る", self_rating: null }),
    ];
    const material = computeReviewMaterial(AUG_SEGMENTS, weeks, [], [], [], TODAY);
    expect(material.weeksWithGoalSet).toBe(2);
    expect(material.unratedWeekCount).toBe(6);
    expect(isReviewMaterialEmpty(material)).toBe(false);
  });

  it("週の目標状態は0本だが自己評価は入っている（目標状態なしで評価だけ付いた特異ケースでも材料ありとみなす）", () => {
    const weeks: PersonalKrWeek[] = [makeWeek({ week_index: 1, goal_state: null, self_rating: "x" })];
    const material = computeReviewMaterial(AUG_SEGMENTS, weeks, [], [], [], TODAY);
    expect(material.weeksWithGoalSet).toBe(0);
    expect(material.ratingCounts.x).toBe(1);
    expect(isReviewMaterialEmpty(material)).toBe(false);
  });

  it("週の◯／△／✕の内訳・未評価週数・紐づくタスクの完了/未完了件数を混在で正しく集計する", () => {
    const weeks: PersonalKrWeek[] = [
      makeWeek({ week_index: 1, goal_state: "目標1", self_rating: "o" }),
      makeWeek({ week_index: 2, goal_state: "目標2", self_rating: "t" }),
      makeWeek({ week_index: 3, goal_state: "目標3", self_rating: "x" }),
      makeWeek({ week_index: 4, goal_state: "目標4", self_rating: null }),
      // week 5・6は未設定
    ];
    const doneTask = makeTask({ id: "t1", status: "done" });
    const todoTask = makeTask({ id: "t2", status: "todo" });
    const inProgressTask = makeTask({ id: "t3", status: "in_progress" });
    const linkedTasks = [doneTask, todoTask, inProgressTask];

    const material = computeReviewMaterial(AUG_SEGMENTS, weeks, linkedTasks, linkedTasks, [], TODAY);

    expect(material.ratingCounts).toEqual({ o: 1, t: 1, x: 1 });
    expect(material.weeksWithGoalSet).toBe(4);
    expect(material.unratedWeekCount).toBe(3); // 6週中、評価済みはo/t/xの3件のみ
    expect(material.linkedTaskCount).toBe(3);
    expect(material.completedTaskCount).toBe(1);
    expect(material.incompleteTaskCount).toBe(2);
    expect(isReviewMaterialEmpty(material)).toBe(false);
  });

  it("taskStatsは既存のsummarizeLinkedTaskStatusをそのまま再利用する（遅延・停滞・先行待ちの再実装をしない）", () => {
    const delayed = makeTask({ id: "t1", baseline_due_date: "2026-07-10", due_date: "2026-07-15" });
    const material = computeReviewMaterial(AUG_SEGMENTS, [], [delayed], [delayed], [], TODAY);
    expect(material.taskStats.delayedCount).toBe(1);
    expect(material.taskStats.stagnantCount).toBe(0);
    expect(material.taskStats.blockedCount).toBe(0);
  });

  it("segmentsが空でも例外を投げない", () => {
    const material = computeReviewMaterial([], [], [], [], [], TODAY);
    expect(material.weeksTotal).toBe(0);
    expect(isReviewMaterialEmpty(material)).toBe(true);
  });
});
