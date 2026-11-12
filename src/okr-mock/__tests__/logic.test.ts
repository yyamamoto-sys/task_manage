import { describe, expect, it } from "vitest";
import { aiCandidates, checkinsInit, howOptions, kintoneRows, okrItems, PERIOD_END, PERIOD_START, pjsInit, recordsInit, resources, tasks, WEEK_START } from "../fixtures";
import {
  addDays,
  answerKey,
  applyDrafts,
  bandKrIds,
  bandRank,
  BANDS,
  buildSummaryText,
  buildup,
  candidateTasksForKr,
  compareOkr,
  deltaText,
  diffChars,
  diffCount,
  focusKrs,
  gapPoints,
  howKey,
  importKintone,
  isNotUpdated,
  itemsInQuarter,
  krGap,
  krIdsOfTask,
  krMove,
  krPace,
  krProgress,
  latestCheckinDate,
  linkedTasks,
  numberProgress,
  overallProgress,
  paceOfProgress,
  periodElapsed,
  periodTasks,
  picksOutcome,
  stepKrs,
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
import type { KrRecord, NumberRecord, Task } from "../types";

const items4Q = itemsInQuarter(okrItems, "4Q");
const ctx: LinkCtx = { pjs: pjsInit, items: items4Q, overrides: {} };
const titled = (title: string) => tasks.find((t) => t.title === title)!;
const M2 = "m2";
const krIds = ["kr1", "kr2", "kr3"];
const elapsed = periodElapsed(PERIOD_START, PERIOD_END, TODAY);
const num = (over: Partial<NumberRecord>): NumberRecord => ({ ...(recordsInit.kr2 as NumberRecord), ...over });

describe("対照表：差・動き・未更新", () => {
  it("数値の差は 現状−目標値、動きは 現状−前回値", () => {
    const r = recordsInit.kr1 as NumberRecord;
    expect(krGap(r)).toBe(-12);
    expect(krMove(r)).toBe(3);
  });
  it("達成度の差は段数で表す（目標より下ならマイナス）", () => {
    const r = recordsInit.kr3;
    expect(r.kind).toBe("band");
    expect(krGap(r)).toBe(bandRank("C") - bandRank("A"));
    expect(krMove(r)).toBe(1);
  });
  it("達成度の区分は仮の5段階で、左ほど高い", () => {
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

describe("進みの測り方（期首値と向き）", () => {
  it("数値KRは（現状−期首）÷（目標値−期首）", () => {
    expect(krProgress(recordsInit.kr1)).toBeCloseTo((18 - 8) / (30 - 8), 5);
    expect(krProgress(recordsInit.kr2)).toBeCloseTo(0.4, 5);
  });
  it("減らす向きでも同じ式で測れる（期首100・目標値60・現状80 → 0.5）", () => {
    expect(numberProgress({ start: 100, target: 60, value: 80, direction: "down" })).toBeCloseTo(0.5, 5);
  });
  it("期首を下回る・目標値を超えるは0〜1に収める", () => {
    expect(numberProgress({ start: 10, target: 20, value: 5, direction: "up" })).toBe(0);
    expect(numberProgress({ start: 10, target: 20, value: 25, direction: "up" })).toBe(1);
  });
  it("目標値＝期首のときは割らず、届いていれば1・届いていなければ0", () => {
    expect(numberProgress({ start: 80, target: 80, value: 80, direction: "up" })).toBe(1);
    expect(numberProgress({ start: 80, target: 80, value: 79, direction: "up" })).toBe(0);
    expect(numberProgress({ start: 80, target: 80, value: 81, direction: "down" })).toBe(0);
  });
  it("達成度は最下段を0、目標の区分を1として段で測る", () => {
    expect(krProgress(recordsInit.kr3)).toBeCloseTo(1 / 3, 5);
  });
  it("全体の進みは数値KRの平均。達成度のKRは含めず、別に取り出す", () => {
    expect(overallProgress(recordsInit, krIds)).toBeCloseTo((krProgress(recordsInit.kr1) + krProgress(recordsInit.kr2)) / 2, 5);
    expect(bandKrIds(recordsInit, krIds)).toEqual(["kr3"]);
  });
});

describe("遅れの判定（丸めを1つに統一）", () => {
  it("期の経過割合は日付から出る（7/1〜12/31の11/10は約72%）", () => {
    expect(elapsed).toBeCloseTo(132 / 183, 5);
    expect(periodElapsed(PERIOD_START, PERIOD_END, PERIOD_START)).toBe(0);
    expect(periodElapsed(PERIOD_START, PERIOD_END, "2027-02-01")).toBe(1);
  });
  it("進み＝経過ちょうどは遅れではない。1ポイント下回ると遅れ", () => {
    const at = (value: number) => krPace(num({ start: 0, target: 100, value }), 0.5);
    expect(at(50)).toBe("ahead");
    expect(at(49)).toBe("behind");
    expect(at(51)).toBe("ahead");
  });
  it("0.5ポイント未満の差は、表示も判定も0ポイント＝遅れにしない（krPace と全体の判定が同じ）", () => {
    expect(gapPoints(0.496, 0.5)).toBe(0);
    expect(paceOfProgress(0.496, 0.5)).toBe("ahead");
    expect(krPace(num({ start: 0, target: 1000, value: 496 }), 0.5)).toBe(paceOfProgress(0.496, 0.5));
    expect(paceOfProgress(0.494, 0.5)).toBe("behind");
    expect(gapPoints(0.494, 0.5)).toBe(1);
  });
  it("目標値＝期首の数値KR：届いていれば到達、届いていなければ遅れ", () => {
    expect(krPace(num({ start: 80, target: 80, value: 80 }), 0.5)).toBe("reached");
    expect(krPace(num({ start: 80, target: 80, value: 70 }), 0.5)).toBe("behind");
  });
  it("初期データ：KR1・KR2は遅れ。達成度のKR3は遅れ判定の対象外", () => {
    expect(krPace(recordsInit.kr1, elapsed)).toBe("behind");
    expect(krPace(recordsInit.kr2, elapsed)).toBe("behind");
    expect(krPace(recordsInit.kr3, elapsed)).toBeNull();
    expect(focusKrs(recordsInit, krIds, elapsed)).toEqual(["kr2", "kr1"]);
  });
  it("達成度のKRは、目標の区分に届いたときだけ到達", () => {
    const r = { ...recordsInit.kr3, value: "A" } as KrRecord;
    expect(krPace(r, elapsed)).toBe("reached");
  });
  it("達成度のKRは、いくら期が進んでも遅れ扱いにならない", () => {
    expect(krPace(recordsInit.kr3, 1)).toBeNull();
    expect(focusKrs(recordsInit, ["kr3"], 1)).toEqual([]);
  });
});

describe("今週ここに力を", () => {
  const latest = latestCheckinDate(checkinsInit);
  const base = { records: recordsInit, krIds, elapsed, tasks, ctx, latest };
  it("遅れている数値KRに加え、達成度のKRは残り2段以上のとき「目標まで◯段」として挙げる", () => {
    expect(stepKrs(recordsInit, krIds)).toEqual(["kr3"]);
    const list = weeklyFocus({ ...base, memberId: M2 });
    expect(list.map((f) => [f.krId, f.kind])).toEqual([
      ["kr2", "behind"],
      ["kr1", "behind"],
      ["kr3", "steps"],
    ]);
    expect(list[2].steps).toBe(2);
    expect(list[0].points).toBe(gapPoints(krProgress(recordsInit.kr2), elapsed));
  });
  it("達成度が残り1段になったら挙げない", () => {
    const deck = resources.find((r) => r.id === "deck")!;
    const after = applyDrafts(recordsInit, deck.drafts, {}, "2026-11-10");
    expect(stepKrs(after, krIds)).toEqual([]);
  });
  it("未更新のKRにも印が付く（判定には含める）", () => {
    const list = weeklyFocus({ ...base, memberId: M2 });
    expect(list.find((f) => f.krId === "kr2")!.stale).toBe(true);
    expect(list.find((f) => f.krId === "kr1")!.stale).toBe(false);
  });
  it("自分の仕事は誰に切り替えても、その人の未完了だけが付く", () => {
    for (const id of ["m1", "m2", "m3"]) {
      for (const f of weeklyFocus({ ...base, memberId: id })) {
        expect(f.mine.every((t) => t.assigneeId === id && t.status !== "完了")).toBe(true);
        expect(f.mine.length).toBeLessThanOrEqual(3);
      }
    }
  });
  it("そのKRに自分の仕事が無いときは、つなげられそうな自分の仕事をAI候補（固定データ）から出す", () => {
    const f = weeklyFocus({ ...base, memberId: M2 }).find((x) => x.krId === "kr2")!;
    expect(f.mine).toHaveLength(0);
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
  it("資料を確定すると、KR1の数値は動く（遅れは残る）", () => {
    const deck = resources.find((r) => r.id === "deck")!;
    const after = applyDrafts(recordsInit, deck.drafts, {}, "2026-11-10");
    expect(krProgress(after.kr1)).toBeGreaterThan(krProgress(recordsInit.kr1));
    expect(focusKrs(after, krIds, elapsed)).toEqual(["kr2", "kr1"]);
  });
});

describe("増減の札", () => {
  it("数値は＋4社、達成度は＋1段。動かなければ出さない", () => {
    const deck = resources.find((r) => r.id === "deck")!;
    const after = applyDrafts(recordsInit, deck.drafts, {}, "2026-11-10");
    expect(deltaText(recordsInit.kr1, after.kr1)).toBe("＋4社");
    expect(deltaText(recordsInit.kr3, after.kr3)).toBe("＋1段");
    expect(deltaText(recordsInit.kr2, after.kr2)).toBeNull();
    expect(deltaText(after.kr1, recordsInit.kr1)).toBe("−4社");
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
