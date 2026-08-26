import { describe, it, expect } from "vitest";
import { computeReviewMaterial, isGenerationMaterialEmpty } from "../reviewMaterial";
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
    expect(material.linkedTaskCount).toBe(0);
    expect(material.completedTaskCount).toBe(0);
    expect(material.incompleteTaskCount).toBe(0);
    expect(isGenerationMaterialEmpty(material, false, 0)).toBe(true);
  });

  it("週の◯／△／✕の内訳・紐づくタスクの完了/未完了件数を混在で正しく集計する", () => {
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
    expect(material.linkedTaskCount).toBe(3);
    expect(material.completedTaskCount).toBe(1);
    expect(material.incompleteTaskCount).toBe(2);
    expect(isGenerationMaterialEmpty(material, false, 0)).toBe(false);
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
    expect(isGenerationMaterialEmpty(material, false, 0)).toBe(true);
  });
});

describe("isGenerationMaterialEmpty（週次任意化・2026-08-26）", () => {
  function emptyWeekMaterial() {
    return computeReviewMaterial(AUG_SEGMENTS, [], [], [], [], TODAY);
  }

  it("週データ0＋計画欄あり → 生成可（false）", () => {
    expect(isGenerationMaterialEmpty(emptyWeekMaterial(), true, 0)).toBe(false);
  });

  it("週データ0＋タスクあり → 生成可（false）", () => {
    const linkedTask = makeTask({ id: "t1" });
    const material = computeReviewMaterial(AUG_SEGMENTS, [], [linkedTask], [linkedTask], [], TODAY);
    expect(isGenerationMaterialEmpty(material, false, 0)).toBe(false);
  });

  it("週データ0＋メモあり → 生成可（false）", () => {
    expect(isGenerationMaterialEmpty(emptyWeekMaterial(), false, 1)).toBe(false);
  });

  it("週0＋計画0＋タスク0＋メモ0 → 生成不可（true）", () => {
    expect(isGenerationMaterialEmpty(emptyWeekMaterial(), false, 0)).toBe(true);
  });

  it("週の自己評価があれば計画・タスク・メモが無くても生成可", () => {
    const weeks: PersonalKrWeek[] = [makeWeek({ week_index: 1, self_rating: "o" })];
    const material = computeReviewMaterial(AUG_SEGMENTS, weeks, [], [], [], TODAY);
    expect(isGenerationMaterialEmpty(material, false, 0)).toBe(false);
  });
});
