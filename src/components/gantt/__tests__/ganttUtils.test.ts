import { describe, it, expect } from "vitest";
import {
  calcGhostBar, computeDelayDays, formatDelayLabel,
  computeWeekBlocks, applyResizePreview, clampStartDate,
  computeWeekGridLines, computeMilestoneBands, getMilestoneBandColor, MS_COLOR,
  dayTickColorKind, dayTickColor, computeDayTicks, HOLIDAY_TICK_COLOR, SATURDAY_TICK_COLOR,
  computeMoveShift, computeBulkMoveShifts,
  clampZoom, computeVisibleOrderedTaskIds, ZOOM_LEVELS,
  xToDate, computeDragCreateRange,
  buildPjViewGanttRows, buildPersonViewGanttRows, computeGanttBlockRanges, computeGanttRowsTotalHeight,
  GANTT_GROUP_ROW_HEIGHT, GANTT_TASK_ROW_HEIGHT, QUICK_ADD_ROW_HEIGHT,
  type GanttRow,
} from "../ganttUtils";
import type { Task, Milestone, Project, Member, ToDo } from "../../../lib/localData/types";
import { getDaysInRange, toDateStr } from "../../../lib/date";
import { isHoliday } from "../../../lib/date/holidays";

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

function makeProject(overrides: Partial<Project> & { id: string }): Project {
  return {
    name: "PJ",
    purpose: "",
    contribution_memo: "",
    owner_member_id: "m1",
    owner_member_ids: ["m1"],
    status: "active",
    color_tag: "#000",
    start_date: "2026-07-01",
    end_date: "2026-07-31",
    is_deleted: false,
    ...overrides,
  };
}

function makeMember(overrides: Partial<Member> & { id: string }): Member {
  return {
    display_name: "山本",
    short_name: "山本",
    initials: "YY",
    teams_account: "",
    color_bg: "#fff",
    color_text: "#000",
    is_deleted: false,
    ...overrides,
  };
}

function makeToDo(overrides: Partial<ToDo> & { id: string }): ToDo {
  return {
    tf_id: "tf1",
    title: "ToDo",
    due_date: null,
    memo: "",
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
  it("カレンダー週（月曜始まり・日曜終わり）に区切る：1日=水（2026年7月）", () => {
    // 2026年7月1日は水曜：W1=7/1(水)〜7/5(日)=5日／W2=7/6〜7/12=7日／W3=7/13〜7/19=7日／
    // W4=7/20〜7/26=7日／W5=7/27(月)〜7/31(金)=5日
    const days = getDaysInRange(new Date(2026, 6, 1), new Date(2026, 6, 31));
    const blocks = computeWeekBlocks(days, 28);
    expect(blocks.map(b => b.label)).toEqual(["7月W1", "7月W2", "7月W3", "7月W4", "7月W5"]);
    expect(blocks.map(b => b.width)).toEqual([5 * 28, 7 * 28, 7 * 28, 7 * 28, 5 * 28]);
    expect(blocks[0].startX).toBe(0);
    expect(blocks.map(b => b.isMonthStart)).toEqual([true, false, false, false, false]);
    expect(toDateStr(blocks[0].startDate)).toBe("2026-07-01");
    expect(toDateStr(blocks[0].endDate)).toBe("2026-07-05");
    expect(toDateStr(blocks[1].startDate)).toBe("2026-07-06");
    expect(toDateStr(blocks[4].startDate)).toBe("2026-07-27");
    expect(toDateStr(blocks[4].endDate)).toBe("2026-07-31");
  });

  it("カレンダー週に区切る：1日=土（2026年8月）", () => {
    // 2026年8月1日は土曜：W1=8/1(土)〜8/2(日)=2日／W2=8/3(月)〜8/9(日)=7日／W3=8/10〜8/16=7日
    const days = getDaysInRange(new Date(2026, 7, 1), new Date(2026, 7, 16));
    const blocks = computeWeekBlocks(days, 28);
    expect(blocks.map(b => b.label)).toEqual(["8月W1", "8月W2", "8月W3"]);
    expect(blocks.map(b => b.width)).toEqual([2 * 28, 7 * 28, 7 * 28]);
    expect(blocks.map(b => b.isMonthStart)).toEqual([true, false, false]);
  });

  it("月の1日が月曜の場合、月境界と月曜が一致しW1がそのままフル週（月〜日）になる", () => {
    // 2026年6月1日は月曜：W1=6/1(月)〜6/7(日)=7日（丸ごとフル週）
    const days = getDaysInRange(new Date(2026, 5, 1), new Date(2026, 5, 14));
    const blocks = computeWeekBlocks(days, 28);
    expect(blocks.map(b => b.label)).toEqual(["6月W1", "6月W2"]);
    expect(blocks.map(b => b.width)).toEqual([7 * 28, 7 * 28]);
    expect(blocks[0].isMonthStart).toBe(true);
  });

  it("月をまたぐカレンダー週は月境界で切れ、前月の最終週と新月のW1に分かれる", () => {
    // 2026-07-29(水)〜2026-08-03(月)：7月W5(27-31のうち29-31=3日) → 8月W1(8/1-2=2日) → 8月W2(8/3のみ=1日)
    const days = getDaysInRange(new Date(2026, 6, 29), new Date(2026, 7, 3));
    const blocks = computeWeekBlocks(days, 28);
    expect(blocks.map(b => b.label)).toEqual(["7月W5", "8月W1", "8月W2"]);
    expect(blocks.map(b => b.width)).toEqual([3 * 28, 2 * 28, 1 * 28]);
    expect(blocks.map(b => b.isMonthStart)).toEqual([false, true, false]);
  });

  it("範囲の先頭が週の途中（月曜始まり）でも部分ブロックとして扱う（月をまたがない）", () => {
    // 2026-08-10（月）〜2026-08-23（日）：W3(8/10-16=7日)／W4(8/17-23=7日)
    const days = getDaysInRange(new Date(2026, 7, 10), new Date(2026, 7, 23));
    const blocks = computeWeekBlocks(days, 28);
    expect(blocks.map(b => b.label)).toEqual(["8月W3", "8月W4"]);
    expect(blocks.map(b => b.width)).toEqual([7 * 28, 7 * 28]);
    expect(blocks.map(b => b.isMonthStart)).toEqual([false, false]);
  });

  it("dayWidthが変わればstartX/widthも比例して変わる", () => {
    // 2026-08-03(月)〜2026-08-16(日)：W2(8/3-9)／W3(8/10-16)、それぞれ丸ごと7日
    const days = getDaysInRange(new Date(2026, 7, 3), new Date(2026, 7, 16));
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
  it("月初（W1）を除いた週境界（＝月曜開始のブロック）のx座標を返す", () => {
    // 2026年7月：W1(月初・除外)/W2(7/6開始)/W3(7/13開始)/W4(7/20開始)/W5(7/27開始)
    const days = getDaysInRange(new Date(2026, 6, 1), new Date(2026, 6, 31));
    const blocks = computeWeekBlocks(days, 28);
    expect(computeWeekGridLines(blocks)).toEqual([5 * 28, 12 * 28, 19 * 28, 26 * 28]);
  });

  it("先頭ブロックが月初でなければ含まれる（月曜始まりの通常ブロック）", () => {
    // 8/10(月)始まり：W3(先頭・月初でない)/W4
    const days = getDaysInRange(new Date(2026, 7, 10), new Date(2026, 7, 23));
    const blocks = computeWeekBlocks(days, 28);
    expect(computeWeekGridLines(blocks)).toEqual([0, 7 * 28]);
  });
});

describe("dayTickColorKind", () => {
  it("祝日は holiday（曜日に関わらず優先）", () => {
    expect(dayTickColorKind(new Date(2026, 0, 1), "元日")).toBe("holiday"); // 2026-01-01は木曜
  });
  it("日曜は祝日名がなければ sunday", () => {
    expect(dayTickColorKind(new Date(2026, 6, 26), null)).toBe("sunday"); // 2026-07-26は日曜
  });
  it("土曜は祝日名がなければ saturday", () => {
    expect(dayTickColorKind(new Date(2026, 6, 25), null)).toBe("saturday"); // 2026-07-25は土曜
  });
  it("平日は weekday", () => {
    expect(dayTickColorKind(new Date(2026, 6, 21), null)).toBe("weekday"); // 2026-07-21は火曜
  });
});

describe("dayTickColor", () => {
  it("holiday/sundayは赤、saturdayは青、weekdayはテキスト系トークン", () => {
    expect(dayTickColor("holiday")).toBe(HOLIDAY_TICK_COLOR);
    expect(dayTickColor("sunday")).toBe(HOLIDAY_TICK_COLOR);
    expect(dayTickColor("saturday")).toBe(SATURDAY_TICK_COLOR);
    expect(dayTickColor("weekday")).toBe("var(--color-text-tertiary)");
  });
});

describe("computeDayTicks", () => {
  it("days配列と同じ長さで、x座標がdayWidth比例・dayが日付の日部分になる", () => {
    const days = getDaysInRange(new Date(2026, 6, 18), new Date(2026, 6, 26)); // 7/18(土)〜7/26(日)
    const ticks = computeDayTicks(days, 28, isHoliday);
    expect(ticks).toHaveLength(9);
    expect(ticks[0]).toMatchObject({ x: 0, day: 18, colorKind: "saturday" });
    expect(ticks[8]).toMatchObject({ x: 8 * 28, day: 26, colorKind: "sunday" });
  });

  it("祝日を含む範囲では colorKind='holiday'・holidayNameに祝日名が入る", () => {
    const days = getDaysInRange(new Date(2026, 6, 19), new Date(2026, 6, 21)); // 7/19(日)〜7/21(火)、7/20は海の日
    const ticks = computeDayTicks(days, 28, isHoliday);
    expect(ticks[1]).toMatchObject({ day: 20, colorKind: "holiday", holidayName: "海の日" });
    expect(ticks[2]).toMatchObject({ day: 21, colorKind: "weekday", holidayName: null });
  });

  it("祝日判定は引数のisHolidayFnに委譲する（ganttUtils.tsは祝日ライブラリに直接依存しない）", () => {
    const days = getDaysInRange(new Date(2026, 6, 21), new Date(2026, 6, 21)); // 平日1日だけ
    const ticks = computeDayTicks(days, 28, () => "テスト祝日");
    expect(ticks[0]).toMatchObject({ colorKind: "holiday", holidayName: "テスト祝日" });
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

describe("computeMoveShift", () => {
  it("開始日・期日の両方があれば同じ日数だけ両方シフトする（duration保持）", () => {
    const shift = computeMoveShift("2026-07-05", "2026-07-10", 3);
    expect(shift).toEqual({ start: "2026-07-08", due: "2026-07-13" });
  });

  it("負のdeltaDays（前方向へのドラッグ）でも両方シフトする", () => {
    const shift = computeMoveShift("2026-07-05", "2026-07-10", -2);
    expect(shift).toEqual({ start: "2026-07-03", due: "2026-07-08" });
  });

  it("開始日が無い（期日のみ）タスクは期日だけシフトする", () => {
    const shift = computeMoveShift(null, "2026-07-10", 3);
    expect(shift).toEqual({ due: "2026-07-13" });
  });

  it("deltaDays===0なら{}（no-op）", () => {
    expect(computeMoveShift("2026-07-05", "2026-07-10", 0)).toEqual({});
  });

  it("期日が無効な日付なら{}", () => {
    expect(computeMoveShift("2026-07-05", "", 3)).toEqual({});
  });
});

describe("computeBulkMoveShifts", () => {
  it("複数タスクを同じ日数だけシフトする", () => {
    const tasks = [
      makeTask({ id: "t1", start_date: "2026-07-05", due_date: "2026-07-10" }),
      makeTask({ id: "t2", start_date: "2026-07-08", due_date: "2026-07-09" }),
    ];
    const shifts = computeBulkMoveShifts(tasks, 3);
    expect(shifts).toEqual([
      { taskId: "t1", oldStart: "2026-07-05", oldDue: "2026-07-10", newStart: "2026-07-08", newDue: "2026-07-13" },
      { taskId: "t2", oldStart: "2026-07-08", oldDue: "2026-07-09", newStart: "2026-07-11", newDue: "2026-07-12" },
    ]);
  });

  it("完了(done)タスクは対象外", () => {
    const tasks = [makeTask({ id: "t1", status: "done", start_date: "2026-07-05", due_date: "2026-07-10" })];
    expect(computeBulkMoveShifts(tasks, 3)).toEqual([]);
  });

  it("中止(cancelled)タスクは対象外（M34：done以外を除外していなかった漏れの回帰防止）", () => {
    const tasks = [makeTask({ id: "t1", status: "cancelled", start_date: "2026-07-05", due_date: "2026-07-10" })];
    expect(computeBulkMoveShifts(tasks, 3)).toEqual([]);
  });

  it("保留(on_hold)タスクは対象（cancelledと違い引き続きシフト可能）", () => {
    const tasks = [makeTask({ id: "t1", status: "on_hold", start_date: "2026-07-05", due_date: "2026-07-10" })];
    expect(computeBulkMoveShifts(tasks, 3)).toEqual([
      { taskId: "t1", oldStart: "2026-07-05", oldDue: "2026-07-10", newStart: "2026-07-08", newDue: "2026-07-13" },
    ]);
  });

  it("削除済みタスクは対象外", () => {
    const tasks = [makeTask({ id: "t1", is_deleted: true, start_date: "2026-07-05", due_date: "2026-07-10" })];
    expect(computeBulkMoveShifts(tasks, 3)).toEqual([]);
  });

  it("期日未設定タスクは対象外", () => {
    const tasks = [makeTask({ id: "t1", start_date: "2026-07-05", due_date: null })];
    expect(computeBulkMoveShifts(tasks, 3)).toEqual([]);
  });

  it("開始日が無い（期日のみ）タスクはnewStart=nullのまま期日だけシフトする", () => {
    const tasks = [makeTask({ id: "t1", start_date: null, due_date: "2026-07-10" })];
    expect(computeBulkMoveShifts(tasks, 3)).toEqual([
      { taskId: "t1", oldStart: null, oldDue: "2026-07-10", newStart: null, newDue: "2026-07-13" },
    ]);
  });

  it("deltaDays===0なら空配列", () => {
    const tasks = [makeTask({ id: "t1", start_date: "2026-07-05", due_date: "2026-07-10" })];
    expect(computeBulkMoveShifts(tasks, 0)).toEqual([]);
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

describe("clampZoom", () => {
  it("ズームインで次のレベルに進む", () => {
    expect(clampZoom(ZOOM_LEVELS[1], "in")).toBe(ZOOM_LEVELS[2]);
  });

  it("ズームアウトで前のレベルに戻る", () => {
    expect(clampZoom(ZOOM_LEVELS[1], "out")).toBe(ZOOM_LEVELS[0]);
  });

  it("最大レベルでズームインしても現在値のまま（clamp）", () => {
    const max = ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
    expect(clampZoom(max, "in")).toBe(max);
  });

  it("最小レベルでズームアウトしても現在値のまま（clamp）", () => {
    const min = ZOOM_LEVELS[0];
    expect(clampZoom(min, "out")).toBe(min);
  });

  it("ZOOM_LEVELSに無い値が渡されたら現在値のまま", () => {
    expect(clampZoom(999, "in")).toBe(999);
    expect(clampZoom(999, "out")).toBe(999);
  });
});

describe("computeVisibleOrderedTaskIds", () => {
  it("PJ別ビュー：PJ→親→子→ToDoグループの順に並べる", () => {
    const ids = computeVisibleOrderedTaskIds({
      viewMode: "pj",
      collapsed: {},
      personGroups: [],
      pjGroups: [
        {
          pjId: "pj1",
          rows: [
            { taskId: "t1", depth: 0, parentTaskId: null },
            { taskId: "t1a", depth: 1, parentTaskId: "t1" },
            { taskId: "t2", depth: 0, parentTaskId: null },
          ],
        },
      ],
      todoGroups: [{ todoId: "td1", taskIds: ["t3"] }],
    });
    expect(ids).toEqual(["t1", "t1a", "t2", "t3"]);
  });

  it("折りたたまれたPJのタスクは除外される", () => {
    const ids = computeVisibleOrderedTaskIds({
      viewMode: "pj",
      collapsed: { pj1: true },
      personGroups: [],
      pjGroups: [{ pjId: "pj1", rows: [{ taskId: "t1", depth: 0, parentTaskId: null }] }],
      todoGroups: [],
    });
    expect(ids).toEqual([]);
  });

  it("折りたたまれた親タスクの子は除外される（親自身は残る）", () => {
    const ids = computeVisibleOrderedTaskIds({
      viewMode: "pj",
      collapsed: { t1: true },
      personGroups: [],
      pjGroups: [
        {
          pjId: "pj1",
          rows: [
            { taskId: "t1", depth: 0, parentTaskId: null },
            { taskId: "t1a", depth: 1, parentTaskId: "t1" },
          ],
        },
      ],
      todoGroups: [],
    });
    expect(ids).toEqual(["t1"]);
  });

  it("折りたたまれたToDoグループは除外される", () => {
    const ids = computeVisibleOrderedTaskIds({
      viewMode: "pj",
      collapsed: { todo_td1: true },
      personGroups: [],
      pjGroups: [],
      todoGroups: [{ todoId: "td1", taskIds: ["t3"] }],
    });
    expect(ids).toEqual([]);
  });

  it("人別ビュー：担当者→タスクの順に並べる（PJ/ToDoグループは無視）", () => {
    const ids = computeVisibleOrderedTaskIds({
      viewMode: "person",
      collapsed: {},
      personGroups: [
        { memberId: "m1", taskIds: ["t1", "t2"] },
        { memberId: "m2", taskIds: ["t3"] },
      ],
      pjGroups: [{ pjId: "pj1", rows: [{ taskId: "t4", depth: 0, parentTaskId: null }] }],
      todoGroups: [],
    });
    expect(ids).toEqual(["t1", "t2", "t3"]);
  });

  it("折りたたまれた担当者のタスクは除外される（人別ビュー）", () => {
    const ids = computeVisibleOrderedTaskIds({
      viewMode: "person",
      collapsed: { person_m1: true },
      personGroups: [
        { memberId: "m1", taskIds: ["t1"] },
        { memberId: "m2", taskIds: ["t2"] },
      ],
      pjGroups: [],
      todoGroups: [],
    });
    expect(ids).toEqual(["t2"]);
  });
});

// computeRangeSelection のテストは src/lib/__tests__/selectionRange.test.ts に移動
// （実体を src/lib/selectionRange.ts に集約し、ListView と共有するため）。

describe("xToDate", () => {
  it("x=0はrangeStartそのもの", () => {
    expect(toDateStr(xToDate(0, rangeStart, dayWidth))).toBe("2026-07-01");
  });

  it("dayWidthの整数倍ぶん右なら、その日数だけ後ろの日付", () => {
    expect(toDateStr(xToDate(dayWidth * 5, rangeStart, dayWidth))).toBe("2026-07-06");
  });

  it("端数のxは最も近い日に丸める（四捨五入）", () => {
    // 2.4日分 → 2日に丸める
    expect(toDateStr(xToDate(dayWidth * 2.4, rangeStart, dayWidth))).toBe("2026-07-03");
    // 2.6日分 → 3日に丸める
    expect(toDateStr(xToDate(dayWidth * 2.6, rangeStart, dayWidth))).toBe("2026-07-04");
  });

  it("負のxはrangeStartより前の日付になる", () => {
    expect(toDateStr(xToDate(-dayWidth * 3, rangeStart, dayWidth))).toBe("2026-06-28");
  });
});

describe("computeDragCreateRange", () => {
  it("始点<終点ならそのままstart/dueになる", () => {
    expect(computeDragCreateRange("2026-07-01", "2026-07-05")).toEqual({ start: "2026-07-01", due: "2026-07-05" });
  });

  it("始点>終点（逆方向にドラッグ）でもstart=min, due=maxに正規化される", () => {
    expect(computeDragCreateRange("2026-07-05", "2026-07-01")).toEqual({ start: "2026-07-01", due: "2026-07-05" });
  });

  it("同日ドラッグはstart=dueの単日タスクとして許容される", () => {
    expect(computeDragCreateRange("2026-07-03", "2026-07-03")).toEqual({ start: "2026-07-03", due: "2026-07-03" });
  });
});

// ===== 共有行モデル（ganttRows）。CLAUDE.md v3.08 =====

describe("buildPjViewGanttRows", () => {
  const pj1 = makeProject({ id: "pj1" });
  const pj2 = makeProject({ id: "pj2" });
  const parent = makeTask({ id: "parent", project_id: "pj1" });
  const child = makeTask({ id: "child", project_id: "pj1", parent_task_id: "parent" });
  const pjOrderedTasksMap = new Map([
    ["pj1", [
      { task: parent, depth: 0, childCount: 1 },
      { task: child, depth: 1, childCount: 0 },
    ]],
    ["pj2", []],
  ]);

  it("PJ見出し→タスク→簡易追加行の順に組み立てる（複数PJ）", () => {
    const rows = buildPjViewGanttRows({
      visibleProjects: [pj1, pj2],
      pjOrderedTasksMap,
      todoGroups: [],
      todoGroupSortedMap: new Map(),
      collapsed: {},
      isPreview: false,
    });
    expect(rows.map(r => r.kind)).toEqual([
      "pj-header", "task", "task", "quick-add",
      "pj-header", "quick-add",
    ]);
    expect(rows.every(r => r.height > 0)).toBe(true);
  });

  it("PJが折りたたまれている間はタスク・簡易追加行を含まない（見出し行のみ残る）", () => {
    const rows = buildPjViewGanttRows({
      visibleProjects: [pj1],
      pjOrderedTasksMap,
      todoGroups: [],
      todoGroupSortedMap: new Map(),
      collapsed: { pj1: true },
      isPreview: false,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("pj-header");
  });

  it("親タスクが折りたたまれている子タスクはスキップする", () => {
    const rows = buildPjViewGanttRows({
      visibleProjects: [pj1],
      pjOrderedTasksMap,
      todoGroups: [],
      todoGroupSortedMap: new Map(),
      collapsed: { parent: true },
      isPreview: false,
    });
    const kinds = rows.filter(r => r.kind === "task").map(r => (r as { task: Task }).task.id);
    expect(kinds).toEqual(["parent"]);
  });

  it("isPreviewのときは簡易追加行を含まない", () => {
    const rows = buildPjViewGanttRows({
      visibleProjects: [pj1],
      pjOrderedTasksMap,
      todoGroups: [],
      todoGroupSortedMap: new Map(),
      collapsed: {},
      isPreview: true,
    });
    expect(rows.some(r => r.kind === "quick-add")).toBe(false);
  });

  it("ToDoグループはPJの後・折りたたみ状態も個別に判定する", () => {
    const todoTask = makeTask({ id: "todo-task", project_id: null });
    const todo = makeToDo({ id: "todo1" });
    const rows = buildPjViewGanttRows({
      visibleProjects: [],
      pjOrderedTasksMap: new Map(),
      todoGroups: [{ todo, todoId: "todo1", tasks: [todoTask] }],
      todoGroupSortedMap: new Map([["todo1", [todoTask]]]),
      collapsed: {},
      isPreview: false,
    });
    expect(rows.map(r => r.kind)).toEqual(["todo-header", "todo-task"]);
  });

  it("行の高さはGANTT_GROUP_ROW_HEIGHT/GANTT_TASK_ROW_HEIGHT/QUICK_ADD_ROW_HEIGHTのいずれかと一致する", () => {
    const rows = buildPjViewGanttRows({
      visibleProjects: [pj1],
      pjOrderedTasksMap,
      todoGroups: [],
      todoGroupSortedMap: new Map(),
      collapsed: {},
      isPreview: false,
    });
    for (const row of rows) {
      if (row.kind === "pj-header") expect(row.height).toBe(GANTT_GROUP_ROW_HEIGHT);
      if (row.kind === "task") expect(row.height).toBe(GANTT_TASK_ROW_HEIGHT);
      if (row.kind === "quick-add") expect(row.height).toBe(QUICK_ADD_ROW_HEIGHT);
    }
  });
});

describe("buildPersonViewGanttRows", () => {
  const m1 = makeMember({ id: "m1" });
  const m2 = makeMember({ id: "m2" });
  const t1 = makeTask({ id: "t1" });
  const t2 = makeTask({ id: "t2" });

  it("担当者見出し→タスクの順に組み立てる（複数担当者）", () => {
    const rows = buildPersonViewGanttRows(
      [{ member: m1, tasks: [t1, t2] }, { member: m2, tasks: [] }],
      {},
    );
    expect(rows.map(r => r.kind)).toEqual(["person-header", "person-task", "person-task", "person-header"]);
  });

  it("担当者が折りたたまれている間はタスク行を含まない", () => {
    const rows = buildPersonViewGanttRows(
      [{ member: m1, tasks: [t1, t2] }],
      { person_m1: true },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("person-header");
  });

  it("同じtaskIdが複数担当者に現れてもrow.keyは重複しない（人別ビューの前提）", () => {
    const rows = buildPersonViewGanttRows(
      [{ member: m1, tasks: [t1] }, { member: m2, tasks: [t1] }],
      {},
    );
    const keys = rows.map(r => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("computeGanttBlockRanges / computeGanttRowsTotalHeight", () => {
  it("同じblockKeyの連続する行の高さを積み上げてtop/heightを算出する", () => {
    const rows: GanttRow[] = [
      { kind: "pj-header", key: "h1", height: 36, blockKey: "pj1", pj: makeProject({ id: "pj1" }) },
      { kind: "task", key: "t1", height: 30, blockKey: "pj1", task: makeTask({ id: "t1" }), depth: 0, childCount: 0, pj: makeProject({ id: "pj1" }) },
      { kind: "quick-add", key: "qa1", height: 26, blockKey: "pj1", pj: makeProject({ id: "pj1" }) },
      { kind: "pj-header", key: "h2", height: 36, blockKey: "pj2", pj: makeProject({ id: "pj2" }) },
    ];
    const ranges = computeGanttBlockRanges(rows);
    expect(ranges.get("pj1")).toEqual({ top: 0, height: 92 });
    expect(ranges.get("pj2")).toEqual({ top: 92, height: 36 });
  });

  it("ganttRowsの全行の高さ合計は各行heightの単純合計と一致する（左右の総高さ一致の基盤）", () => {
    const rows: GanttRow[] = [
      { kind: "pj-header", key: "h1", height: 36, blockKey: "pj1", pj: makeProject({ id: "pj1" }) },
      { kind: "task", key: "t1", height: 30, blockKey: "pj1", task: makeTask({ id: "t1" }), depth: 0, childCount: 0, pj: makeProject({ id: "pj1" }) },
      { kind: "quick-add", key: "qa1", height: 26, blockKey: "pj1", pj: makeProject({ id: "pj1" }) },
    ];
    expect(computeGanttRowsTotalHeight(rows)).toBe(92);
    // ブロック範囲の最終ブロックの top+height も全体高さと一致する（左右のスクロール総高さが
    // 一致することの検証に使う不変条件）
    const ranges = computeGanttBlockRanges(rows);
    const last = ranges.get("pj1")!;
    expect(last.top + last.height).toBe(computeGanttRowsTotalHeight(rows));
  });

  it("PJ別ビューの実データでも左右の行配列（同一参照）から求めた総高さは常に一致する", () => {
    const pj1 = makeProject({ id: "pj1" });
    const parent = makeTask({ id: "parent", project_id: "pj1" });
    const child = makeTask({ id: "child", project_id: "pj1", parent_task_id: "parent" });
    const rows = buildPjViewGanttRows({
      visibleProjects: [pj1],
      pjOrderedTasksMap: new Map([["pj1", [
        { task: parent, depth: 0, childCount: 1 },
        { task: child, depth: 1, childCount: 0 },
      ]]]),
      todoGroups: [],
      todoGroupSortedMap: new Map(),
      collapsed: {},
      isPreview: false,
    });
    // 左ラベル列・右バー列は同じ rows 配列を1回ずつ map するだけの実装（GanttView.tsx）なので、
    // 「両列の総高さが常に一致する」ことは「同一配列から求めた高さの合計が1つに定まる」ことと同値
    const totalA = computeGanttRowsTotalHeight(rows);
    const totalB = computeGanttRowsTotalHeight(rows);
    expect(totalA).toBe(totalB);
    expect(totalA).toBe(GANTT_GROUP_ROW_HEIGHT * 1 + GANTT_TASK_ROW_HEIGHT * 2 + QUICK_ADD_ROW_HEIGHT);
  });
});
