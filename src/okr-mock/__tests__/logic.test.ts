import { describe, expect, it } from "vitest";
import { kintoneTexts, members, okrItems, pjsInit, tasks, teams } from "../fixtures";
import {
  buildMatrix,
  buildPreReport,
  buildReminderText,
  buildReportMarkdown,
  canLock,
  compareOkr,
  diffChars,
  dueBeforeCheckin,
  isStaleScope,
  isStaleTask,
  movement,
  nextCheckinDate,
  overdueTasks,
  resolvedTexts,
  tasksForKr,
  tasksForTf,
  TODAY,
  unconnectedPjs,
  weeklyCompleted,
} from "../logic";

const teamA = teams[0];
const teamB = teams[1];

describe("次回チェックイン日", () => {
  it("今日=火曜でチームA(火)は本日、B(木)は11/12", () => {
    expect(nextCheckinDate(TODAY, 2)).toBe("2026-11-10");
    expect(nextCheckinDate(TODAY, 4)).toBe("2026-11-12");
  });
  it("曜日を過ぎていれば来週", () => {
    expect(nextCheckinDate(TODAY, 1)).toBe("2026-11-16");
    expect(nextCheckinDate("2026-12-30", 5)).toBe("2027-01-01");
  });
});

describe("催促対象・停滞判定", () => {
  it("期日超過は未完了で期日が今日より前だけ", () => {
    const od = overdueTasks(tasks, TODAY);
    expect(od.length).toBeGreaterThan(0);
    expect(od.every((t) => t.status !== "完了" && t.due < TODAY)).toBe(true);
  });
  it("チェックイン日までの期日（本日〜当日）で超過は含めない", () => {
    const list = dueBeforeCheckin(tasks, TODAY, "2026-11-12");
    expect(list.every((t) => t.due >= TODAY && t.due <= "2026-11-12" && t.status !== "完了")).toBe(true);
    expect(dueBeforeCheckin(tasks, TODAY, TODAY).every((t) => t.due === TODAY)).toBe(true);
  });
  it("タスク停滞は7日以上更新なしの未完了のみ", () => {
    const base = { id: "x", pjId: "p1", title: "a", assigneeId: "m1", due: TODAY };
    expect(isStaleTask({ ...base, status: "進行中", updated: "2026-11-03" }, TODAY)).toBe(true);
    expect(isStaleTask({ ...base, status: "進行中", updated: "2026-11-04" }, TODAY)).toBe(false);
    expect(isStaleTask({ ...base, status: "完了", updated: "2026-10-01" }, TODAY)).toBe(false);
  });
  it("範囲の停滞：TF3-2のみ全タスクが停滞、タスク0件も停滞", () => {
    const stale = okrItems.filter((i) => i.kind === "tf").filter((i) => isStaleScope(tasksForTf(tasks, pjsInit, i.id), TODAY));
    expect(stale.map((i) => i.id)).toEqual(["tf32"]);
    expect(isStaleScope([], TODAY)).toBe(true);
  });
});

describe("集計", () => {
  it("1PJが同KRの2TFに紐づいてもタスクを重複数えしない", () => {
    const pjs = pjsInit.map((p) => (p.id === "p1" ? { ...p, tfIds: ["tf11", "tf12"] } : p));
    const ids = tasksForKr(tasks, pjs, okrItems, "kr1").map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("p2は2つのTFに紐づき、p8は未接続", () => {
    expect(pjsInit.find((p) => p.id === "p2")!.tfIds).toHaveLength(2);
    expect(unconnectedPjs(pjsInit).map((p) => p.id)).toEqual(["p8"]);
  });
  it("直近7日の動き", () => {
    const m = movement(tasks, TODAY);
    expect(m.updated).toBe(tasks.filter((t) => t.updated >= "2026-11-04").length);
    expect(m.completed).toBeLessThanOrEqual(m.updated);
  });
  it("週ごとの完了件数は完了タスクの合計と一致（4週内）", () => {
    const w = weeklyCompleted(tasks, TODAY, 4);
    const done = tasks.filter((t) => t.status === "完了" && t.updated >= "2026-10-14").length;
    expect(w.reduce((a, b) => a + b, 0)).toBe(done);
    expect(w).toHaveLength(4);
  });
  it("マトリクス：セルは担当者×KRの更新件数と未完了件数", () => {
    const krIds = ["kr1", "kr2", "kr3"];
    const byKr = Object.fromEntries(krIds.map((k) => [k, tasksForKr(tasks, pjsInit, okrItems, k)]));
    const rows = buildMatrix(members.filter((m) => m.teamId === "ta"), krIds, byKr, TODAY);
    expect(rows).toHaveLength(3);
    const m2kr1 = byKr.kr1.filter((t) => t.assigneeId === "m2");
    expect(rows.find((r) => r.member.id === "m2")!.cells.kr1.open).toBe(m2kr1.filter((t) => t.status !== "完了").length);
  });
});

describe("差分", () => {
  it("同一文字列は変更なし", () => {
    const d = diffChars("あいう", "あいう");
    expect(d.left).toEqual([{ text: "あいう", changed: false }]);
    expect(d.right).toEqual(d.left);
  });
  it("全角％と半角%の1文字だけが強調される", () => {
    const d = diffChars("稼働率を80%にする", "稼働率を80％にする");
    expect(d.left.filter((s) => s.changed).map((s) => s.text)).toEqual(["%"]);
    expect(d.right.filter((s) => s.changed).map((s) => s.text)).toEqual(["％"]);
  });
  it("追加された文字列は右側だけに出る", () => {
    const d = diffChars("確保する", "継続的に確保する");
    expect(d.left.every((s) => !s.changed)).toBe(true);
    expect(d.right[0]).toEqual({ text: "継続的に", changed: true });
  });
  it("確定案とKintoneは2か所だけ違い、選択が揃うまでロックできない", () => {
    const rows = compareOkr(okrItems, kintoneTexts);
    const diff = rows.filter((r) => !r.same);
    expect(diff.map((r) => r.id)).toEqual(["kr2", "tf22"]);
    expect(canLock(rows, {})).toBe(false);
    expect(canLock(rows, { kr2: "app" })).toBe(false);
    const res = { kr2: "kintone", tf22: "app" } as const;
    expect(canLock(rows, res)).toBe(true);
    const t = resolvedTexts(rows, res);
    expect(t.kr2).toBe(kintoneTexts.kr2);
    expect(t.tf22).toBe(okrItems.find((i) => i.id === "tf22")!.text);
  });
  it("差分ゼロなら最初からロックできる", () => {
    const rows = compareOkr(okrItems, Object.fromEntries(okrItems.map((i) => [i.id, i.text])));
    expect(canLock(rows, {})).toBe(true);
  });
});

describe("事前レポート", () => {
  const mk = (team: typeof teamA) => buildPreReport({ team, members, items: okrItems, pjs: pjsInit, tasks, today: TODAY });
  it("チームごとにチェックイン日が違い、担当者はチーム内だけ", () => {
    const a = mk(teamA);
    const b = mk(teamB);
    expect(a.checkin).toBe("2026-11-10");
    expect(b.checkin).toBe("2026-11-12");
    expect(a.overdue.every((g) => g.member.teamId === "ta")).toBe(true);
    expect(b.dueSoon.every((g) => g.member.teamId === "tb")).toBe(true);
    expect(b.dueSoon.flatMap((g) => g.tasks).length).toBeGreaterThan(a.dueSoon.flatMap((g) => g.tasks).length);
  });
  it("停滞したTFが出る。未接続PJのタスクは停滞に含めない", () => {
    const r = mk(teamB);
    expect(r.staleTfIds).toContain("tf32");
    expect(r.staleTasks.every((t) => t.pjId !== "p8")).toBe(true);
  });
  it("催促文面と Markdown に必要な情報が入る", () => {
    const text = buildReminderText({ toName: "鈴木", fromName: "佐藤 美咲", checkin: "2026-11-12", today: TODAY, tasks: [{ title: "資料", due: "2026-11-08" }] });
    expect(text).toContain("鈴木さん");
    expect(text).toContain("11/8(日)");
    expect(text).toContain("2日超過");
    const md = buildReportMarkdown({ report: mk(teamB), krLabel: (i) => i, tfLabel: (i) => i, pjName: (i) => i, today: TODAY });
    expect(md).toContain("チームB 事前レポート（チェックイン 11/12(木)）");
    expect(md).toContain("## 期日を過ぎているタスク");
  });
});
