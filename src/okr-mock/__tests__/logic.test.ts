import { describe, expect, it } from "vitest";
import { aiCandidates, assessInit, checkinsInit, howOptions, kintoneRows, krBands, okrItems, PERIOD_END, PERIOD_START, pjsInit, recordsInit, resources, tasks, WEEK_START } from "../fixtures";
import {
  addDays,
  answerKey,
  applyConfirm,
  buildSummaryText,
  buildup,
  candidateTasksForKr,
  compareOkr,
  diffChars,
  diffCount,
  gapPoints,
  hintProgress,
  hintTrailsPeriod,
  howKey,
  importKintone,
  isNotUpdated,
  itemsInQuarter,
  krIdsOfTask,
  latestCheckinDate,
  linkedTasks,
  periodElapsed,
  periodTasks,
  picksOutcome,
  tasksDoneBetween,
  tasksMovedInWeek,
  tasksOfKr,
  TODAY,
  trapTarget,
  unlinkedTasks,
  weekKrIds,
  weekStartOf,
  weeklyFocus,
  type LinkCtx,
} from "../logic";
import { currentAssessment } from "../steps";
import type { Assessment, Task } from "../types";

const items4Q = itemsInQuarter(okrItems, "4Q");
const ctx: LinkCtx = { pjs: pjsInit, items: items4Q, overrides: {} };
const titled = (title: string) => tasks.find((t) => t.title === title)!;
const M2 = "m2";
const krIds = ["kr1", "kr2", "kr3"];
const elapsed = periodElapsed(PERIOD_START, PERIOD_END, TODAY);
const assessOf: Record<string, Assessment | undefined> = Object.fromEntries(krIds.map((k) => [k, currentAssessment(assessInit[k])!.cur.assessment]));

describe("未更新", () => {
  it("直近のチェックイン日より前の更新は未更新", () => {
    const latest = latestCheckinDate(checkinsInit);
    expect(latest).toBe("2026-11-03");
    expect(isNotUpdated(recordsInit.kr2, latest)).toBe(true);
    expect(isNotUpdated(recordsInit.kr1, latest)).toBe(false);
  });
  it("数値のないKR（KR3）も、同じ段の見せ方の対象（手がかりを持たないだけ）", () => {
    expect(recordsInit.kr3.hint).toBeUndefined();
    expect(recordsInit.kr1.hint?.unit).toBe("社");
  });
});

describe("手がかりの数字（期首値と向き）。主役の％ではなく、KRの詳細の中だけで使う", () => {
  it("（現状−期首）÷（目標値−期首）", () => {
    expect(hintProgress(recordsInit.kr1.hint!)).toBeCloseTo((18 - 8) / (30 - 8), 5);
    expect(hintProgress(recordsInit.kr2.hint!)).toBeCloseTo(0.4, 5);
  });
  it("減らす向きでも同じ式で測れる（期首100・目標値60・現状80 → 0.5）", () => {
    expect(hintProgress({ start: 100, target: 60, value: 80, direction: "down" })).toBeCloseTo(0.5, 5);
  });
  it("期首を下回る・目標値を超えるは0〜1に収める", () => {
    expect(hintProgress({ start: 10, target: 20, value: 5, direction: "up" })).toBe(0);
    expect(hintProgress({ start: 10, target: 20, value: 25, direction: "up" })).toBe(1);
  });
  it("目標値＝期首のときは割らず、届いていれば1・届いていなければ0", () => {
    expect(hintProgress({ start: 80, target: 80, value: 80, direction: "up" })).toBe(1);
    expect(hintProgress({ start: 80, target: 80, value: 79, direction: "up" })).toBe(0);
    expect(hintProgress({ start: 80, target: 80, value: 81, direction: "down" })).toBe(0);
  });
  it("期の経過割合は日付から出る（7/1〜12/31の11/10は約72%）", () => {
    expect(elapsed).toBeCloseTo(132 / 183, 5);
    expect(periodElapsed(PERIOD_START, PERIOD_END, PERIOD_START)).toBe(0);
    expect(periodElapsed(PERIOD_START, PERIOD_END, "2027-02-01")).toBe(1);
  });
  it("期の経過より後ろか：ちょうどは後ろでない。1ポイント下回ると後ろ。届いていれば後ろでない", () => {
    const h = (value: number) => ({ unit: "x", start: 0, direction: "up" as const, target: 100, value, prev: 0 });
    expect(hintTrailsPeriod(h(50), 0.5)).toBe(false);
    expect(hintTrailsPeriod(h(49), 0.5)).toBe(true);
    expect(hintTrailsPeriod(h(100), 1)).toBe(false);
    expect(gapPoints(0.496, 0.5)).toBe(0);
    expect(gapPoints(0.494, 0.5)).toBe(1);
  });
  it("数値のないKRは判定の対象外（常に false）", () => {
    expect(hintTrailsPeriod(undefined, 1)).toBe(false);
    expect(hintTrailsPeriod(recordsInit.kr3.hint, 1)).toBe(false);
  });
  it("初期データ：KR1・KR2の手がかりは期の経過より後ろ。KR3は対象外", () => {
    expect(hintTrailsPeriod(recordsInit.kr1.hint, elapsed)).toBe(true);
    expect(hintTrailsPeriod(recordsInit.kr2.hint, elapsed)).toBe(true);
    expect(hintTrailsPeriod(recordsInit.kr3.hint, elapsed)).toBe(false);
  });
});

describe("今週ここに力を（次の段への手がかり）", () => {
  const latest = latestCheckinDate(checkinsInit);
  const base = { records: recordsInit, krIds, assessOf, bandsOf: krBands, tasks, ctx, latest };
  it("次の段の要件に「まだ／一部」があり、自分の仕事がつながるKRを挙げる（遅れは使わない）", () => {
    const list = weeklyFocus({ ...base, memberId: M2 });
    expect(list.map((f) => [f.krId, f.kind, f.step])).toEqual([
      ["kr1", "next", 70],
      ["kr3", "next", 70],
    ]);
    expect(list[0].pendingCount).toBe(3);
  });
  it("要件があっても、自分の仕事がつながっていないKR（m2のKR2）は挙げない", () => {
    const list = weeklyFocus({ ...base, memberId: M2 });
    expect(list.map((f) => f.krId)).not.toContain("kr2");
  });
  it("未更新のKRにも印が付く", () => {
    const list = weeklyFocus({ ...base, memberId: "m3", max: 3 });
    expect(list.find((f) => f.krId === "kr2")?.stale ?? true).toBe(true);
  });
  it("要件が出そろっているときは、自分の仕事が最も多くつながるKRを1つ挙げる", () => {
    const done: Record<string, Assessment | undefined> = Object.fromEntries(
      krIds.map((k) => [k, { value: 66, summary: "", basis: [{ requirement: "x", status: "確認できた" as const, quote: "q" }] }]),
    );
    const list = weeklyFocus({ ...base, assessOf: done, memberId: M2 });
    expect(list).toHaveLength(1);
    expect(list[0].kind).toBe("most");
    expect(list[0].mine.length).toBeGreaterThan(0);
  });
  it("自分の仕事が1つもつながっていなければ空", () => {
    expect(weeklyFocus({ ...base, tasks: [], memberId: M2 })).toEqual([]);
  });
  it("最上段にいるKRは次の段が無いので挙げない", () => {
    const top: Record<string, Assessment | undefined> = { ...assessOf, kr1: { value: 100, summary: "", basis: [{ requirement: "x", status: "まだ", quote: "" }] } };
    expect(weeklyFocus({ ...base, assessOf: top, memberId: M2 }).map((f) => f.krId)).not.toContain("kr1");
  });
  it("自分の仕事は誰に切り替えても、その人の未完了だけが付く", () => {
    for (const id of ["m1", "m2", "m3"]) {
      for (const f of weeklyFocus({ ...base, memberId: id, max: 3 })) {
        expect(f.mine.every((t) => t.assigneeId === id && t.status !== "完了")).toBe(true);
        expect(f.mine.length).toBeLessThanOrEqual(3);
      }
    }
  });
  it("そのKRに自分の仕事が無いときは、つなげられそうな自分の仕事をAI候補（固定データ）から出す", () => {
    const c = candidateTasksForKr(tasks, M2, "kr2", ctx, aiCandidates);
    expect(c.length).toBeGreaterThan(0);
    for (const x of c) {
      expect(x.task.assigneeId).toBe(M2);
      expect(x.task.status).not.toBe("完了");
      expect(krIdsOfTask(x.task, ctx)).not.toContain("kr2");
      expect(x.reason).toBeTruthy();
    }
  });
  it("候補を採る（上書き）とそのKRにつながり、候補から外れる", () => {
    const c = candidateTasksForKr(tasks, M2, "kr2", ctx, aiCandidates)[0];
    const o: LinkCtx = { ...ctx, overrides: { [c.task.id]: ["kr2"] } };
    expect(krIdsOfTask(c.task, o)).toEqual(["kr2"]);
    expect(candidateTasksForKr(tasks, M2, "kr2", o, aiCandidates).map((x) => x.task.id)).not.toContain(c.task.id);
  });
});

describe("資料の確定（applyConfirm）", () => {
  const deck = resources.find((r) => r.id === "deck")!;
  const assessed = deck.assessments.map((a) => ({ krId: a.krId, source: a.source }));
  it("資料に出たKR（下書き・見立てのどちらか）だけ更新し、手がかりの前回値をずらす。出なかったKRは前回のまま", () => {
    const out = applyConfirm(recordsInit, deck.drafts, {}, assessed, "2026-11-10");
    expect(out.kr1.hint).toMatchObject({ value: 22, prev: 18 });
    expect(out.kr1).toMatchObject({ updatedAt: "2026-11-10", prevAt: "2026-11-03" });
    expect(out.kr3).toMatchObject({ updatedAt: "2026-11-10", prevAt: "2026-11-03" });
    expect(out.kr3.hint).toBeUndefined();
    expect(out.kr2).toEqual(recordsInit.kr2);
    expect(isNotUpdated(out.kr2, "2026-11-10")).toBe(true);
    expect(isNotUpdated(out.kr1, "2026-11-10")).toBe(false);
  });
  it("見立てだけの資料に出たKR（手がかりの下書きが無い）は、手がかりの数字を動かさず更新日だけ進む", () => {
    const out = applyConfirm(recordsInit, [], {}, [{ krId: "kr2", source: { doc: "d", page: "p" } }], "2026-11-10");
    expect(out.kr2.hint).toEqual(recordsInit.kr2.hint);
    expect(out.kr2.updatedAt).toBe("2026-11-10");
  });
  it("直した値が下書きより優先される", () => {
    const out = applyConfirm(recordsInit, deck.drafts, { kr1: 25 }, assessed, "2026-11-10");
    expect(out.kr1.hint).toMatchObject({ value: 25 });
  });
  it("同じ日への再確定では前回値をずらさない", () => {
    const once = applyConfirm(recordsInit, deck.drafts, {}, assessed, "2026-11-10");
    const twice = applyConfirm(once, deck.drafts, { kr1: 23 }, assessed, "2026-11-10");
    expect(twice.kr1.hint).toMatchObject({ value: 23, prev: 18 });
    expect(twice.kr1.prevAt).toBe("2026-11-03");
  });
  it("元の記録は書き換えない", () => {
    applyConfirm(recordsInit, deck.drafts, {}, assessed, "2026-11-10");
    expect(recordsInit.kr1.updatedAt).toBe("2026-11-03");
  });
});

describe("仕事とKRのつながり", () => {
  it("既定は属するPJのKR。共有PJでも同じKRは1つ", () => {
    const p2 = titled("展示会アンケートを集計する");
    expect(p2.status).toBe("完了");
    expect(krIdsOfTask(p2, ctx)).toEqual(["kr1"]);
    const open = titled("商談の候補先を絞る");
    expect(krIdsOfTask(open, ctx)).toEqual(["kr1"]);
  });
  it("別のKRにまたがる共有PJは両方のKRにつながる", () => {
    const p7 = titled("資料の置き場所を決める");
    expect(krIdsOfTask(p7, ctx).sort()).toEqual(["kr2", "kr3"]);
  });
  it("上書きすると既定のつながりを置き換える", () => {
    const p7 = titled("資料の置き場所を決める");
    expect(krIdsOfTask(p7, { ...ctx, overrides: { [p7.id]: ["kr1"] } })).toEqual(["kr1"]);
  });
  it("PJにTFが無い仕事・PJに属さない個人の仕事はつながりなし。AIの提案を採る（上書き）とつながる", () => {
    for (const title of ["交流会の出し物を考える", "AI勉強会の資料を読む"]) {
      const t = titled(title);
      expect(unlinkedTasks([t], ctx)).toHaveLength(1);
      const c = aiCandidates[t.pjId][0];
      expect(unlinkedTasks([t], { ...ctx, overrides: { [t.id]: [c.krId] } })).toHaveLength(0);
    }
  });
  it("共有PJの仕事は、複数KRにつながっても「つながっている仕事」では1回", () => {
    const p7 = tasks.filter((t) => t.pjId === "p7");
    const dup = [...p7, ...p7];
    expect(linkedTasks(dup, ctx)).toHaveLength(p7.length);
    expect(tasksOfKr(dup, "kr3", ctx)).toHaveLength(p7.length);
  });
  it("AIの候補は全PJ・個人の仕事分にあり、どう効くかの案は全KR分にある", () => {
    for (const p of pjsInit) expect(aiCandidates[p.id]?.length).toBeGreaterThanOrEqual(1);
    expect(aiCandidates.personal.length).toBeGreaterThanOrEqual(2);
    for (const k of krIds) {
      expect(howOptions[k].length).toBeGreaterThanOrEqual(2);
      expect(howOptions[k].length).toBeLessThanOrEqual(3);
    }
  });
});

describe("期間と過去のつながり", () => {
  it("今期の仕事に絞る：上期に終えた仕事は入らず、未完了は常に入る", () => {
    const old = titled("旧期の提案テンプレを整える");
    expect(old.updated < PERIOD_START).toBe(true);
    const list = periodTasks(tasks, PERIOD_START);
    expect(list.map((t) => t.id)).not.toContain(old.id);
    expect(list).toHaveLength(tasks.length - 1);
    expect(list.filter((t) => t.status !== "完了")).toHaveLength(tasks.filter((t) => t.status !== "完了").length);
  });
  it("完了した仕事は、完了した時点でつながっていたKRを記録として持つ", () => {
    for (const t of tasks.filter((x) => x.status === "完了")) expect(t.doneKrIds).toBeDefined();
    expect(titled("提案資料の骨子を決める").doneKrIds).toEqual(["kr1"]);
  });
  it("3Qだけにあった TF1-3 の仕事は、4Qの構成になっても完了した仕事のつながりが残る", () => {
    expect(items4Q.some((i) => i.id === "tf13")).toBe(false);
    const done = tasks.filter((t) => t.pjId === "p9" && t.status === "完了");
    expect(done).toHaveLength(3);
    for (const t of done) expect(krIdsOfTask(t, ctx)).toEqual(["kr1"]);
    const asOpen: Task = { ...done[0], id: "x", status: "進行中", doneKrIds: undefined };
    expect(krIdsOfTask(asOpen, ctx)).toEqual([]);
  });
  it("記録があっても、本人が後からつなぎ先を変えれば上書きが優先される", () => {
    const t = tasks.find((x) => x.pjId === "p9")!;
    expect(krIdsOfTask(t, { ...ctx, overrides: { [t.id]: ["kr3"] } })).toEqual(["kr3"]);
  });
});

describe("前回更新〜今回更新の間に終えた仕事", () => {
  it("本人が完了した、そのKRの仕事だけ。開始日は含めず終了日は含める", () => {
    const r = recordsInit.kr1;
    const done = tasksDoneBetween(tasks, M2, "kr1", r.prevAt, r.updatedAt, ctx);
    expect(done.map((t) => t.title).sort()).toEqual(["ヒアリング対象の過去取引を確認する", "提案の想定質問集を作る"]);
    for (const t of done) expect(t.updated > r.prevAt && t.updated <= r.updatedAt).toBe(true);
  });
  it("未完了・他人の仕事・期間外は入らない", () => {
    const mk = (over: Partial<Task>): Task => ({ id: "x", pjId: "p1", title: "x", assigneeId: M2, due: TODAY, status: "完了", updated: "2026-10-25", ...over });
    const list = [
      mk({ id: "a" }),
      mk({ id: "b", status: "進行中" }),
      mk({ id: "c", assigneeId: "m3" }),
      mk({ id: "d", updated: "2026-10-20" }),
      mk({ id: "e", updated: "2026-11-03" }),
      mk({ id: "f", updated: "2026-11-04" }),
    ];
    expect(tasksDoneBetween(list, M2, "kr1", "2026-10-20", "2026-11-03", ctx).map((t) => t.id)).toEqual(["a", "e"]);
  });
  it("別のKRにつなぎ直した仕事は、元のKRの動きには入らない", () => {
    const t = titled("提案の想定質問集を作る");
    const o = { ...ctx, overrides: { [t.id]: ["kr3"] } };
    expect(tasksDoneBetween(tasks, M2, "kr1", "2026-10-20", "2026-11-03", o).map((x) => x.id)).not.toContain(t.id);
    expect(tasksDoneBetween(tasks, M2, "kr3", "2026-10-20", "2026-11-03", o).map((x) => x.id)).toContain(t.id);
  });
});

describe("効きの積み上がり", () => {
  const b = buildup(tasks, M2, krIds, PERIOD_START, TODAY, ctx);
  it("期の始めの週から今週まで、週は月曜始まりで並ぶ", () => {
    expect(b.weeks[0]).toBe(weekStartOf(PERIOD_START));
    expect(b.weeks[b.weeks.length - 1]).toBe(weekStartOf(TODAY));
    expect(b.weeks.every((w) => weekStartOf(w) === w)).toBe(true);
  });
  it("累計なので減らない", () => {
    for (const k of krIds) b.cumulative[k].forEach((n, i, a) => i > 0 && expect(n).toBeGreaterThanOrEqual(a[i - 1]));
    b.total.forEach((n, i, a) => i > 0 && expect(n).toBeGreaterThanOrEqual(a[i - 1]));
  });
  it("最後の週の累計は、KRごとの完了件数と合う（今期だけ）", () => {
    const last = b.weeks.length - 1;
    for (const k of krIds) {
      const n = tasks.filter((t) => t.assigneeId === M2 && t.status === "完了" && t.updated >= PERIOD_START && krIdsOfTask(t, ctx).includes(k)).length;
      expect(b.cumulative[k][last]).toBe(n);
    }
  });
  it("複数KRにつながる仕事は各KRに積まれ、全体では1回", () => {
    const last = b.weeks.length - 1;
    const sum = krIds.reduce((s, k) => s + b.cumulative[k][last], 0);
    const p7done = tasks.filter((t) => t.assigneeId === M2 && t.pjId === "p7" && t.status === "完了").length;
    expect(sum - b.total[last]).toBe(p7done);
  });
  it("期の始めより前の完了は数えない。3Qだけにあった TF の仕事は今期なので数える", () => {
    const old = titled("旧期の提案テンプレを整える");
    const b2 = buildup([old], M2, krIds, PERIOD_START, TODAY, ctx);
    expect(b2.total.every((n) => n === 0)).toBe(true);
    const p9 = titled("紹介ルートの候補を洗い出す");
    const b3 = buildup([p9], M2, krIds, PERIOD_START, TODAY, ctx);
    expect(b3.total[b3.total.length - 1]).toBe(1);
  });
});

describe("期のまとめ", () => {
  it("「どう効くか」は仕事×KR。該当のKRの行にだけ付き、合計は1回に数える", () => {
    const t = titled("集計の手順を書き出す");
    const text = buildSummaryText({
      period: "2026年 下期",
      owner: "鈴木 健",
      krs: okrItems.filter((i) => i.kind === "kr"),
      tasks,
      memberId: M2,
      start: PERIOD_START,
      today: TODAY,
      ctx,
      how: { [howKey(t.id, "kr3")]: "手作業を自動化して、時間を減らす" },
    });
    expect(text).toContain("・集計の手順を書き出す（手作業を自動化して、時間を減らす）");
    expect(text.split("集計の手順を書き出す").length - 1).toBe(1);
    expect(text).toMatch(/KR1 .*：\d+件/);
    expect(text).toContain("1件に数えています");
  });
  it("2つのKRにつながる仕事は、答えを付けたKRの行にだけ答えが出る", () => {
    const t = titled("フォルダ構成案を作る");
    expect(krIdsOfTask(t, ctx).sort()).toEqual(["kr2", "kr3"]);
    const text = buildSummaryText({
      period: "p",
      owner: "o",
      krs: okrItems.filter((i) => i.kind === "kr"),
      tasks,
      memberId: M2,
      start: PERIOD_START,
      today: TODAY,
      ctx,
      how: { [howKey(t.id, "kr2")]: "探す手間を減らして、時間を減らす" },
    });
    expect(text.split("探す手間を減らして、時間を減らす").length - 1).toBe(1);
    expect(text.split("・フォルダ構成案を作る").length - 1).toBe(2);
  });
  it("今期だけ：上期に終えた仕事は入らない", () => {
    const text = buildSummaryText({ period: "p", owner: "o", krs: okrItems.filter((i) => i.kind === "kr"), tasks, memberId: M2, start: PERIOD_START, today: TODAY, ctx, how: {} });
    expect(text).not.toContain("旧期の提案テンプレを整える");
    expect(text).toContain("紹介ルートの候補を洗い出す");
  });
});

describe("今週の振り返りと今週やる", () => {
  it("振り返りの対象KRは、その週に動いた仕事がつながるKR（人ごと）", () => {
    expect(tasksMovedInWeek(tasks, M2, WEEK_START).length).toBeGreaterThan(0);
    expect(weekKrIds(tasks, M2, WEEK_START, ctx, krIds)).toEqual(["kr1", "kr3"]);
    expect(weekKrIds(tasks, "m3", WEEK_START, ctx, krIds)).toContain("kr1");
  });
  it("先週の最終日に動いた仕事は、今週の対象に入らない", () => {
    const t: Task = { id: "z", pjId: "p4", title: "z", assigneeId: M2, due: TODAY, status: "進行中", updated: addDays(WEEK_START, -1) };
    expect(weekKrIds([t], M2, WEEK_START, ctx, krIds)).toEqual([]);
    expect(weekKrIds([{ ...t, updated: WEEK_START }], M2, WEEK_START, ctx, krIds)).toEqual(["kr2"]);
  });
  it("答えの持ち方は週×KR", () => {
    expect(answerKey("2026-11-09", "kr1")).not.toBe(answerKey("2026-11-02", "kr1"));
    expect(answerKey("2026-11-09", "kr1")).not.toBe(answerKey("2026-11-09", "kr2"));
  });
  it("今週やると選んだ仕事のその後を、終えた／進行中／未着手で数える", () => {
    const a = titled("提案資料の骨子を決める");
    const b = titled("デザインの初稿を作る");
    const c = titled("提案資料の英語版を作る");
    const out = picksOutcome(tasks, [a.id, b.id, c.id, "none"]);
    expect(out.counts).toEqual({ 終えた: 1, 進行中: 1, 未着手: 1 });
    expect(out.total).toBe(3);
  });
});

describe("期の切替・Kintone（正）の取り込み", () => {
  it("四半期に有効なTFだけを返す", () => {
    expect(itemsInQuarter(okrItems, "3Q").some((i) => i.id === "tf33")).toBe(false);
    expect(itemsInQuarter(okrItems, "3Q").some((i) => i.id === "tf13")).toBe(true);
    expect(items4Q.some((i) => i.id === "tf33")).toBe(true);
  });
  it("文字単位の差分を印づける", () => {
    const d = diffChars("ボランティアを確保する", "ボランティアを継続的に確保する");
    expect(d.right.filter((s) => s.changed).map((s) => s.text).join("")).toBe("継続的に");
  });
  it("文言の違いと、行の過不足（Kintoneにだけある／アプリにだけある）を見せる", () => {
    const rows = compareOkr(
      items4Q.filter((i) => i.kind === "tf"),
      kintoneRows,
    );
    const by = (s: string) => rows.filter((r) => r.status === s).map((r) => r.id).sort();
    expect(by("changed")).toEqual(["tf22", "tf32"]);
    expect(by("kintoneOnly")).toEqual(["tf23"]);
    expect(by("appOnly")).toEqual(["tf33"]);
    expect(diffCount(rows)).toBe(4);
  });
  it("取り込むとアプリはKintoneと同じになる（文言の差し替え・追加・取り外し）", () => {
    const next = importKintone(items4Q, kintoneRows, "4Q");
    const tfs = next.filter((i) => i.kind === "tf");
    expect(tfs.map((i) => i.id).sort()).toEqual(kintoneRows.map((r) => r.id).sort());
    expect(tfs.find((i) => i.id === "tf22")!.text).toBe("運営ボランティアを継続的に確保する");
    expect(tfs.find((i) => i.id === "tf23")!.parentId).toBe("kr2");
    expect(next.filter((i) => i.kind !== "tf")).toHaveLength(items4Q.filter((i) => i.kind !== "tf").length);
    const after = compareOkr(tfs, kintoneRows);
    expect(diffCount(after)).toBe(0);
  });
});

describe("フォーカスの輪", () => {
  it("端で Tab を押したときだけ回す", () => {
    expect(trapTarget(3, 2, false)).toBe(0);
    expect(trapTarget(3, 0, true)).toBe(2);
    expect(trapTarget(3, 1, false)).toBeNull();
    expect(trapTarget(3, 1, true)).toBeNull();
    expect(trapTarget(0, 0, false)).toBeNull();
    expect(trapTarget(1, 0, false)).toBe(0);
  });
});
