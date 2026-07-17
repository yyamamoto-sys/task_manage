import { describe, it, expect } from "vitest";
import {
  calcGhostBar, computeDelayDays, formatDelayLabel,
  computeWeekBlocks, applyResizePreview, clampStartDate,
  computeWeekGridLines, computeMilestoneBands, getMilestoneBandColor, MS_COLOR,
} from "../ganttUtils";
import type { Task, Milestone } from "../../../lib/localData/types";
import { getDaysInRange } from "../../../lib/date";

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

const rangeStart = new Date(2026, 6, 1); // 2026-07-01
const dayWidth = 28;

describe("calcGhostBar", () => {
  it("ベースラインが両方揃っていれば座標を返す", () => {
    const task = makeTask({ id: "t1", baseline_start_date: "2026-07-05", baseline_due_date: "2026-07-10" });
    const bar = calcGhostBar(task, rangeStart, dayWidth);
    expect(bar).not.toBeNull();
    expect(bar!.barX).toBe(4 * dayWidth);
  });

  it("ベースライン未凍結（両方null）ならnull", () => {
    const task = makeTask({ id: "t1" });
    expect(calcGhostBar(task, rangeStart, dayWidth)).toBeNull();
  });

  it("ベースラインが片方だけならnull", () => {
    const task = makeTask({ id: "t1", baseline_start_date: "2026-07-05", baseline_due_date: null });
    expect(calcGhostBar(task, rangeStart, dayWidth)).toBeNull();
  });
});

describe("computeDelayDays", () => {
  it("期日が後ろ倒しになったら正の値（遅延）", () => {
    const task = makeTask({ id: "t1", baseline_due_date: "2026-07-10", due_date: "2026-07-15" });
    expect(computeDelayDays(task)).toBe(5);
  });

  it("期日が前倒しになったら負の値", () => {
    const task = makeTask({ id: "t1", baseline_due_date: "2026-07-10", due_date: "2026-07-08" });
    expect(computeDelayDays(task)).toBe(-2);
  });

  it("差分ゼロなら0", () => {
    const task = makeTask({ id: "t1", baseline_due_date: "2026-07-10", due_date: "2026-07-10" });
    expect(computeDelayDays(task)).toBe(0);
  });

  it("ベースライン未凍結ならnull", () => {
    const task = makeTask({ id: "t1", due_date: "2026-07-10" });
    expect(computeDelayDays(task)).toBeNull();
  });

  it("現在の期日が未設定ならnull", () => {
    const task = makeTask({ id: "t1", baseline_due_date: "2026-07-10", due_date: null });
    expect(computeDelayDays(task)).toBeNull();
  });
});

describe("formatDelayLabel", () => {
  it("正の値は「遅延◯日」", () => {
    expect(formatDelayLabel(5)).toBe("遅延5日");
  });

  it("負の値は「◯日前倒し」", () => {
    expect(formatDelayLabel(-3)).toBe("3日前倒し");
  });

  it("0はnull（非表示）", () => {
    expect(formatDelayLabel(0)).toBeNull();
  });

  it("nullはnull", () => {
    expect(formatDelayLabel(null)).toBeNull();
  });
});

describe("computeWeekBlocks", () => {
  it("月内日数ブロック（W1=1-7/W2=8-14/W3=15-21/W4=22-28/W5=29〜月末）に区切る", () => {
    // 2026年8月は31日まで：W1(1-7)/W2(8-14)/W3(15-21)/W4(22-28)/W5(29-31)の5ブロック
    const days = getDaysInRange(new Date(2026, 7, 1), new Date(2026, 7, 31));
    const blocks = computeWeekBlocks(days, 28);
    expect(blocks.map(b => b.label)).toEqual(["8月W1", "8月W2", "8月W3", "8月W4", "8月W5"]);
    expect(blocks.map(b => b.width)).toEqual([7 * 28, 7 * 28, 7 * 28, 7 * 28, 3 * 28]);
    expect(blocks[0].startX).toBe(0);
    expect(blocks[4].startX).toBe(28 * 28);
    expect(blocks.map(b => b.isMonthStart)).toEqual([true, false, false, false, false]);
  });

  it("月をまたぐと翌月のW1から数え直す（月をまたいだ週ブロックは作らない）", () => {
    // 2026-07-29 〜 2026-08-03：7月W5(29-31=3日) → 8月W1(1-3=3日)
    const days = getDaysInRange(new Date(2026, 6, 29), new Date(2026, 7, 3));
    const blocks = computeWeekBlocks(days, 28);
    expect(blocks.map(b => b.label)).toEqual(["7月W5", "8月W1"]);
    expect(blocks.map(b => b.width)).toEqual([3 * 28, 3 * 28]);
    expect(blocks[1].isMonthStart).toBe(true);
  });

  it("範囲の先頭が週の途中でも部分ブロックとして扱う（月をまたがない）", () => {
    // 2026-08-10（W2の途中）〜2026-08-16（W3の途中）
    const days = getDaysInRange(new Date(2026, 7, 10), new Date(2026, 7, 16));
    const blocks = computeWeekBlocks(days, 28);
    expect(blocks.map(b => b.label)).toEqual(["8月W2", "8月W3"]);
    // W2は8/8-14のうち8/10-14の5日分、W3は8/15-21のうち8/15-16の2日分
    expect(blocks.map(b => b.width)).toEqual([5 * 28, 2 * 28]);
  });

  it("dayWidthが変わればstartX/widthも比例して変わる", () => {
    const days = getDaysInRange(new Date(2026, 7, 1), new Date(2026, 7, 14));
    const blocks = computeWeekBlocks(days, 14);
    expect(blocks.map(b => b.width)).toEqual([7 * 14, 7 * 14]);
  });
});

describe("applyResizePreview", () => {
  const base = makeTask({ id: "t1", start_date: "2026-07-05", due_date: "2026-07-10" });

  it("previewが無ければtaskをそのまま返す", () => {
    expect(applyResizePreview(base, undefined)).toBe(base);
  });

  it("start だけプレビュー中ならstart_dateだけ上書きされる", () => {
    const t = applyResizePreview(base, { start: "2026-07-03" });
    expect(t.start_date).toBe("2026-07-03");
    expect(t.due_date).toBe("2026-07-10");
  });

  it("due だけプレビュー中ならdue_dateだけ上書きされる", () => {
    const t = applyResizePreview(base, { due: "2026-07-15" });
    expect(t.start_date).toBe("2026-07-05");
    expect(t.due_date).toBe("2026-07-15");
  });
});

describe("computeWeekGridLines", () => {
  it("月初（W1）を除いた週境界のx座標を返す", () => {
    // 2026年8月：W1(月初・除外)/W2/W3/W4/W5の5ブロック
    const days = getDaysInRange(new Date(2026, 7, 1), new Date(2026, 7, 31));
    const blocks = computeWeekBlocks(days, 28);
    expect(computeWeekGridLines(blocks)).toEqual([7 * 28, 14 * 28, 21 * 28, 28 * 28]);
  });

  it("先頭ブロックが月初でなければ含まれる", () => {
    // 8/10始まり：W2(先頭・月初でない)/W3
    const days = getDaysInRange(new Date(2026, 7, 10), new Date(2026, 7, 16));
    const blocks = computeWeekBlocks(days, 28);
    expect(computeWeekGridLines(blocks)).toEqual([0, 5 * 28]);
  });
});

function makeMilestone(overrides: Partial<Milestone> & { id: string; project_id: string; date: string }): Milestone {
  return { name: "ms", is_deleted: false, ...overrides };
}

describe("getMilestoneBandColor", () => {
  it("現状は全マイルストーン共通のMS_COLORを返す", () => {
    const ms = makeMilestone({ id: "m1", project_id: "p1", date: "2026-07-10" });
    expect(getMilestoneBandColor(ms)).toBe(MS_COLOR);
  });
});

describe("computeMilestoneBands", () => {
  it("マイルストーンごとにx座標を計算する", () => {
    const mss = [
      makeMilestone({ id: "m1", project_id: "p1", date: "2026-07-05" }),
      makeMilestone({ id: "m2", project_id: "p1", date: "2026-07-10" }),
    ];
    const bands = computeMilestoneBands(mss, rangeStart, dayWidth);
    expect(bands).toEqual([
      { x: 4 * dayWidth, color: MS_COLOR },
      { x: 9 * dayWidth, color: MS_COLOR },
    ]);
  });

  it("同一日に複数マイルストーンがあっても帯は1本だけ（重複除去）", () => {
    const mss = [
      makeMilestone({ id: "m1", project_id: "p1", date: "2026-07-05" }),
      makeMilestone({ id: "m2", project_id: "p1", date: "2026-07-05" }),
    ];
    expect(computeMilestoneBands(mss, rangeStart, dayWidth)).toHaveLength(1);
  });

  it("日付が無効/未設定なものはスキップする", () => {
    const mss = [makeMilestone({ id: "m1", project_id: "p1", date: "" })];
    expect(computeMilestoneBands(mss, rangeStart, dayWidth)).toEqual([]);
  });

  it("空配列なら空配列", () => {
    expect(computeMilestoneBands([], rangeStart, dayWidth)).toEqual([]);
  });
});

describe("clampStartDate", () => {
  it("開始日が期日以前ならそのまま", () => {
    expect(clampStartDate("2026-07-05", "2026-07-10")).toBe("2026-07-05");
  });

  it("開始日が期日と同日なら許可される", () => {
    expect(clampStartDate("2026-07-10", "2026-07-10")).toBe("2026-07-10");
  });

  it("開始日が期日を超えたら期日にクランプされる", () => {
    expect(clampStartDate("2026-07-15", "2026-07-10")).toBe("2026-07-10");
  });
});
