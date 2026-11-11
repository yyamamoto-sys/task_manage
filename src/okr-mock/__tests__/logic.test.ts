import { describe, expect, it } from "vitest";
import { aiCandidates, howOptions, kintoneTexts, okrItems, OWNER_ID, PERIOD_START, pjsInit, recordsInit, resources, tasks } from "../fixtures";
import {
  applyDrafts,
  bandRank,
  BANDS,
  buildSummaryText,
  buildup,
  canLock,
  compareOkr,
  diffChars,
  isNotUpdated,
  itemsInQuarter,
  krGap,
  krIdsOfTask,
  krMove,
  latestCheckinDate,
  linkedTasks,
  resolvedTexts,
  tasksDoneBetween,
  tasksOfKr,
  TODAY,
  unlinkedTasks,
  weekStartOf,
  type LinkCtx,
} from "../logic";
import { checkinsInit } from "../fixtures";
import type { NumberRecord, Task } from "../types";

const ctx: LinkCtx = { pjs: pjsInit, items: okrItems, overrides: {} };
const titled = (title: string) => tasks.find((t) => t.title === title)!;

describe("対照表：差・動き・未更新", () => {
  it("数値の差は 現状−目標、動きは 現状−前回値", () => {
    const r = recordsInit.kr1 as NumberRecord;
    expect(krGap(r)).toBe(r.value - r.target);
    expect(krGap(r)).toBe(-12);
    expect(krMove(r)).toBe(3);
  });
  it("バンドの差は段数で表す（目標より下ならマイナス）", () => {
    const r = recordsInit.kr3;
    expect(r.kind).toBe("band");
    expect(krGap(r)).toBe(bandRank("C") - bandRank("A"));
    expect(krGap(r)).toBe(-2);
    expect(krMove(r)).toBe(1);
  });
  it("バンドの区分は仮の5段階で、左ほど高い", () => {
    expect(BANDS).toEqual(["S", "A", "B", "C", "D"]);
    expect(bandRank("S")).toBeGreaterThan(bandRank("D"));
  });
  it("直近のチェックイン日より前の更新は未更新", () => {
    const latest = latestCheckinDate(checkinsInit);
    expect(latest).toBe("2026-11-03");
    expect(isNotUpdated(recordsInit.kr2, latest)).toBe(true);
    expect(isNotUpdated(recordsInit.kr1, latest)).toBe(false);
  });
});

describe("資料の確定（applyDrafts）", () => {
  const deck = resources.find((r) => r.id === "deck")!;
  it("下書きに出たKRだけ更新し、前回値をずらす。出なかったKRは前回値のまま", () => {
    const out = applyDrafts(recordsInit, deck.drafts, {}, "2026-11-10");
    expect(out.kr1).toMatchObject({ value: 22, prev: 18, updatedAt: "2026-11-10", prevAt: "2026-11-03" });
    expect(out.kr3).toMatchObject({ value: "B", prev: "C" });
    expect(out.kr2).toEqual(recordsInit.kr2);
    expect(isNotUpdated(out.kr2, "2026-11-10")).toBe(true);
    expect(isNotUpdated(out.kr1, "2026-11-10")).toBe(false);
  });
  it("直した値が下書きより優先される", () => {
    const out = applyDrafts(recordsInit, deck.drafts, { kr1: 25, kr3: "A" }, "2026-11-10");
    expect(out.kr1).toMatchObject({ value: 25 });
    expect(out.kr3).toMatchObject({ value: "A" });
  });
  it("同じ日への再確定では前回値をずらさない", () => {
    const once = applyDrafts(recordsInit, deck.drafts, {}, "2026-11-10");
    const twice = applyDrafts(once, deck.drafts, { kr1: 23 }, "2026-11-10");
    expect(twice.kr1).toMatchObject({ value: 23, prev: 18, prevAt: "2026-11-03" });
  });
  it("元の記録は書き換えない", () => {
    applyDrafts(recordsInit, deck.drafts, {}, "2026-11-10");
    expect(recordsInit.kr1.updatedAt).toBe("2026-11-03");
  });
});

describe("仕事とKRのつながり", () => {
  it("既定は属するPJのKR。共有PJでも同じKRは1つ", () => {
    const p2 = titled("お礼メールの文面を作る");
    expect(p2.pjId).toBe("p2");
    expect(krIdsOfTask(p2, ctx)).toEqual(["kr1"]);
  });
  it("別のKRにまたがる共有PJは両方のKRにつながる", () => {
    const p7 = titled("資料の置き場所を決める");
    expect(krIdsOfTask(p7, ctx).sort()).toEqual(["kr2", "kr3"]);
  });
  it("上書きすると既定のつながりを置き換える", () => {
    const p7 = titled("資料の置き場所を決める");
    expect(krIdsOfTask(p7, { ...ctx, overrides: { [p7.id]: "kr1" } })).toEqual(["kr1"]);
  });
  it("PJにTFが無い仕事はつながりなし。AIの提案を採る（上書き）とつながる", () => {
    const t = titled("交流会の出し物を考える");
    expect(unlinkedTasks([t], ctx)).toHaveLength(1);
    const c = aiCandidates[t.pjId][0];
    expect(unlinkedTasks([t], { ...ctx, overrides: { [t.id]: c.krId } })).toHaveLength(0);
  });
  it("共有PJの仕事は、複数KRにつながっても「つながっている仕事」では1回", () => {
    const p7 = tasks.filter((t) => t.pjId === "p7");
    const dup = [...p7, ...p7];
    expect(linkedTasks(dup, ctx)).toHaveLength(p7.length);
    expect(tasksOfKr(dup, "kr3", ctx)).toHaveLength(p7.length);
  });
  it("AIの候補とどう効くかの案は、全KR・全PJ分そろっている", () => {
    for (const p of pjsInit) expect(aiCandidates[p.id]?.length).toBeGreaterThanOrEqual(2);
    for (const k of ["kr1", "kr2", "kr3"]) {
      expect(howOptions[k].length).toBeGreaterThanOrEqual(2);
      expect(howOptions[k].length).toBeLessThanOrEqual(3);
    }
  });
});

describe("前回更新〜今回更新の間に終えた仕事", () => {
  it("本人が完了した、そのKRの仕事だけ。開始日は含めず終了日は含める", () => {
    const r = recordsInit.kr1;
    const done = tasksDoneBetween(tasks, OWNER_ID, "kr1", r.prevAt, r.updatedAt, ctx);
    expect(done.map((t) => t.title).sort()).toEqual(["ヒアリング対象の過去取引を確認する", "提案の想定質問集を作る"]);
    for (const t of done) expect(t.updated > r.prevAt && t.updated <= r.updatedAt).toBe(true);
  });
  it("未完了・他人の仕事・期間外は入らない", () => {
    const mk = (over: Partial<Task>): Task => ({ id: "x", pjId: "p1", title: "x", assigneeId: OWNER_ID, due: TODAY, status: "完了", updated: "2026-10-25", ...over });
    const list = [
      mk({ id: "a" }),
      mk({ id: "b", status: "進行中" }),
      mk({ id: "c", assigneeId: "m3" }),
      mk({ id: "d", updated: "2026-10-20" }),
      mk({ id: "e", updated: "2026-11-03" }),
      mk({ id: "f", updated: "2026-11-04" }),
    ];
    expect(tasksDoneBetween(list, OWNER_ID, "kr1", "2026-10-20", "2026-11-03", ctx).map((t) => t.id)).toEqual(["a", "e"]);
  });
  it("別のKRにつなぎ直した仕事は、元のKRの動きには入らない", () => {
    const t = titled("提案の想定質問集を作る");
    const o = { ...ctx, overrides: { [t.id]: "kr3" } };
    expect(tasksDoneBetween(tasks, OWNER_ID, "kr1", "2026-10-20", "2026-11-03", o).map((x) => x.id)).not.toContain(t.id);
    expect(tasksDoneBetween(tasks, OWNER_ID, "kr3", "2026-10-20", "2026-11-03", o).map((x) => x.id)).toContain(t.id);
  });
});

describe("効きの積み上がり", () => {
  const krs = ["kr1", "kr2", "kr3"];
  const b = buildup(tasks, OWNER_ID, krs, PERIOD_START, TODAY, ctx);
  it("期の始めの週から今週まで、週は月曜始まりで並ぶ", () => {
    expect(b.weeks[0]).toBe(weekStartOf(PERIOD_START));
    expect(b.weeks[b.weeks.length - 1]).toBe(weekStartOf(TODAY));
    expect(b.weeks.every((w) => weekStartOf(w) === w)).toBe(true);
  });
  it("累計なので減らない", () => {
    for (const k of krs) b.cumulative[k].forEach((n, i, a) => i > 0 && expect(n).toBeGreaterThanOrEqual(a[i - 1]));
    b.total.forEach((n, i, a) => i > 0 && expect(n).toBeGreaterThanOrEqual(a[i - 1]));
  });
  it("最後の週の累計は、KRごとの完了件数と合う", () => {
    const last = b.weeks.length - 1;
    for (const k of krs) {
      const n = tasks.filter((t) => t.assigneeId === OWNER_ID && t.status === "完了" && t.updated >= PERIOD_START && krIdsOfTask(t, ctx).includes(k)).length;
      expect(b.cumulative[k][last]).toBe(n);
    }
  });
  it("複数KRにつながる仕事は各KRに積まれ、全体では1回", () => {
    const last = b.weeks.length - 1;
    const sum = krs.reduce((s, k) => s + b.cumulative[k][last], 0);
    expect(sum).toBeGreaterThan(b.total[last]);
    const p7done = tasks.filter((t) => t.assigneeId === OWNER_ID && t.pjId === "p7" && t.status === "完了").length;
    expect(sum - b.total[last]).toBe(p7done);
  });
  it("期の始めより前の完了は数えない", () => {
    const old: Task = { id: "o", pjId: "p1", title: "o", assigneeId: OWNER_ID, due: "2026-06-01", status: "完了", updated: "2026-06-20" };
    const b2 = buildup([old], OWNER_ID, krs, PERIOD_START, TODAY, ctx);
    expect(b2.total.every((n) => n === 0)).toBe(true);
  });
});

describe("期のまとめ", () => {
  it("KRごとの件数と、選んだ「どう効くか」を入れる。合計は1回に数える", () => {
    const t = titled("提案の想定質問集を作る");
    const text = buildSummaryText({
      period: "2026年 下期",
      owner: "鈴木 健",
      krs: okrItems.filter((i) => i.kind === "kr"),
      tasks,
      memberId: OWNER_ID,
      start: PERIOD_START,
      today: TODAY,
      ctx,
      how: { [t.id]: "提案の質を上げて、紹介を増やす" },
    });
    expect(text).toContain("・提案の想定質問集を作る（提案の質を上げて、紹介を増やす）");
    expect(text).toMatch(/KR1 .*：\d+件/);
    expect(text).toContain("1件に数えています");
  });
});

describe("期の切替・Kintone取込の突き合わせ（残した機能）", () => {
  it("四半期に有効なTFだけを返す", () => {
    const q3 = itemsInQuarter(okrItems, "3Q").filter((i) => i.kind === "tf");
    expect(q3.some((i) => i.id === "tf33")).toBe(false);
    expect(itemsInQuarter(okrItems, "4Q").some((i) => i.id === "tf33")).toBe(true);
  });
  it("文字単位の差分を印づける", () => {
    const d = diffChars("ボランティアを確保する", "ボランティアを継続的に確保する");
    expect(d.right.filter((s) => s.changed).map((s) => s.text).join("")).toBe("継続的に");
  });
  it("差分のある行をすべて選ぶまで確定できない", () => {
    const rows = compareOkr(
      okrItems.filter((i) => i.kind === "tf"),
      kintoneTexts,
    );
    expect(rows.filter((r) => !r.same)).toHaveLength(2);
    expect(canLock(rows, {})).toBe(false);
    const all = { tf22: "kintone", tf33: "app" } as const;
    expect(canLock(rows, all)).toBe(true);
    expect(resolvedTexts(rows, all).tf22).toBe("運営ボランティアを継続的に確保する");
  });
});
