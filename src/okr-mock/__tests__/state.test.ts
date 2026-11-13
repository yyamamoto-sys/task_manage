import { describe, expect, it } from "vitest";
import { detectConflicts, mergeDecisions, mergeDrafts, unresolved } from "../confirm";
import { checkinsInit, decisionsInit, KR_PALETTE, krStyle, krStyleAt, nextCheckin, okrItems, pjsInit, recordsInit, resources, tasks, WEEK_START } from "../fixtures";
import { answerKey, applyConfirm, defaultKrIdsOfTask, howKey, itemsInQuarter, krIdsOfTask, type LinkCtx, unlinkedTasks } from "../logic";
import type { Task } from "../types";
import * as U from "../userState";

const baseCtx: LinkCtx = { pjs: pjsInit, items: itemsInQuarter(okrItems, "4Q"), overrides: {} };
/** その仕事の既定のつなぎ先（本人が選ぶ前） */
const dk = (t: Task) => defaultKrIdsOfTask(t, baseCtx);

const t2 = tasks.find((t) => t.assigneeId === "m3" && t.pjId === "p1" && t.status !== "完了")!;
const t2m2 = tasks.find((t) => t.assigneeId === "m2" && t.pjId === "p1" && t.status !== "完了")!;
const fresh = () => U.initialUserStates(WEEK_START);
const deck = resources.find((r) => r.id === "deck")!;
const minutes = resources.find((r) => r.id === "minutes")!;

describe("状態は利用者IDごとに分かれる（本人＝見ている人）", () => {
  it("鈴木以外（高橋）でも、自分の仕事のつなぎ先を変えられる。他の人の状態は動かない", () => {
    const before = fresh();
    const after = U.setOverride(before, "m3", t2, ["kr3"], dk(t2));
    expect(after.m3.overrides[t2.id]).toEqual(["kr3"]);
    expect(U.userOf(after, "m2").overrides).toEqual(U.userOf(before, "m2").overrides);
    expect(U.userOf(after, "m1").overrides).toEqual(U.userOf(before, "m1").overrides);
    expect(U.mergedOverrides(after)[t2.id]).toEqual(["kr3"]);
  });
  it("他の人の仕事のつなぎ先は変えられない（状態も変わらない）", () => {
    const before = fresh();
    expect(U.setOverride(before, "m3", t2m2, ["kr3"], dk(t2m2))).toBe(before);
    expect(U.takeProposal(before, "m3", t2m2, "kr3", [], [])).toBe(before);
    expect(U.togglePick(before, "m3", WEEK_START, t2m2)).toBe(before);
  });
  it("どう役立つか・提案の採否・個人OKRのつなぎ・振り返り・今週やるは、人ごとに別", () => {
    let s = fresh();
    s = U.setHow(s, "m3", t2.id, "kr1", "提案の質を上げて、紹介を増やす");
    s = U.setProposal(s, "m3", "any", "kr1", "skipped");
    s = U.toggleLink(s, "m3", "po5", "kr2");
    s = U.setAnswer(s, "m3", WEEK_START, "kr1", { effect: "少し役立った" });
    s = U.togglePick(s, "m3", WEEK_START, t2);
    for (const other of ["m2", "m1"]) {
      const u = U.userOf(s, other);
      expect(Object.keys(u.how)).not.toContain(howKey(t2.id, "kr1"));
      expect(u.proposals.any).toBeUndefined();
      expect(u.personalLinks.some((l) => l.personalId === "po5")).toBe(false);
      expect(u.answers[answerKey(WEEK_START, "kr1")]).toBeUndefined();
      expect(u.picks[WEEK_START] ?? []).not.toContain(t2.id);
    }
    expect(s.m3.answers[answerKey(WEEK_START, "kr1")]).toEqual({ effect: "少し役立った" });
    expect(s.m3.picks[WEEK_START]).toContain(t2.id);
  });
  it("3人それぞれに個人OKRのつなぎと今週やるの初期データがある", () => {
    const s = fresh();
    for (const id of ["m1", "m2", "m3"]) expect(s[id].personalLinks.length).toBeGreaterThan(0);
    expect(s.m2.picks[WEEK_START].length).toBeGreaterThan(0);
  });
});

describe("「どう役立つか」は仕事×KR。つなぎ先を変えたら消える", () => {
  const two = tasks.find((t) => t.title === "ルールを全員に説明する")!;
  it("同じ仕事でもKRごとに別の答えを持つ", () => {
    let s = fresh();
    const mine = tasks.find((t) => t.assigneeId === "m1" && t.pjId === "p7")!;
    s = U.setHow(s, "m1", mine.id, "kr2", "A");
    s = U.setHow(s, "m1", mine.id, "kr3", "B");
    expect(s.m1.how[howKey(mine.id, "kr2")]).toBe("A");
    expect(s.m1.how[howKey(mine.id, "kr3")]).toBe("B");
    s = U.setHow(s, "m1", mine.id, "kr2", undefined);
    expect(Object.keys(s.m1.how)).toEqual([howKey(mine.id, "kr3")]);
    expect(two.assigneeId).toBe("m1");
  });
  it("つなぎ先から外したKRの答えだけ消える。残したKR・他の仕事の答えは残る", () => {
    let s = U.setOverride(fresh(), "m3", t2, ["kr1", "kr2"], dk(t2));
    s = U.setHow(s, "m3", t2.id, "kr1", "x");
    s = U.setHow(s, "m3", t2.id, "kr2", "z");
    s = U.setHow(s, "m3", "other", "kr1", "y");
    s = U.setOverride(s, "m3", t2, ["kr1", "kr3"], dk(t2));
    expect(Object.keys(s.m3.how).sort()).toEqual([howKey(t2.id, "kr1"), howKey("other", "kr1")].sort());
  });
  it("同じ集合を選び直しても（変化なし）何も消さない。もとに戻すと、既定に入っていないKRの答えが消える", () => {
    let s = U.setOverride(fresh(), "m3", t2, ["kr2", "kr3"], dk(t2));
    s = U.setHow(s, "m3", t2.id, "kr2", "x");
    s = U.setHow(s, "m3", t2.id, "kr3", "w");
    expect(U.setOverride(s, "m3", t2, ["kr3", "kr2"], dk(t2))).toBe(s);
    expect(dk(t2)).toEqual(["kr1"]);
    s = U.setOverride(s, "m3", t2, undefined, dk(t2));
    expect(s.m3.how).toEqual({});
    expect(s.m3.overrides[t2.id]).toBeUndefined();
  });
  it("複数のKRを選べる。0個（どのKRにもつながない）も選べる", () => {
    let s = U.setOverride(fresh(), "m3", t2, ["kr1", "kr2", "kr3"], dk(t2));
    expect(s.m3.overrides[t2.id]).toEqual(["kr1", "kr2", "kr3"]);
    s = U.setOverride(s, "m3", t2, [], dk(t2));
    expect(s.m3.overrides[t2.id]).toEqual([]);
    const ctx: LinkCtx = { ...baseCtx, overrides: U.mergedOverrides(s) };
    expect(krIdsOfTask(t2, ctx)).toEqual([]);
    expect(unlinkedTasks([t2], ctx)).toHaveLength(1);
  });
  it("つなぎを「もとに戻す」と、採った提案の記録も戻る（見送りの記録は残る）", () => {
    const loose = tasks.find((t) => t.assigneeId === "m2" && t.pjId === "p8")!;
    let s = U.takeProposal(fresh(), "m2", loose, "kr1", [], dk(loose));
    expect(s.m2.proposals[U.proposalKey(loose.id, "kr1")]).toBe("taken");
    expect(s.m2.overrides[loose.id]).toEqual(["kr1"]);
    s = U.setOverride(s, "m2", loose, undefined, dk(loose));
    expect(s.m2.proposals[U.proposalKey(loose.id, "kr1")]).toBeUndefined();
    s = U.setProposal(s, "m2", loose.id, "kr3", "skipped");
    s = U.setOverride(s, "m2", loose, undefined, dk(loose));
    expect(s.m2.proposals[U.proposalKey(loose.id, "kr3")]).toBe("skipped");
  });
  it("提案は候補ごとに複数採れる（置き換えず足す）。1件ずつ見送れる", () => {
    const loose = tasks.find((t) => t.assigneeId === "m2" && t.pjId === "p8")!;
    let s = U.takeProposal(fresh(), "m2", loose, "kr1", [], dk(loose));
    s = U.takeProposal(s, "m2", loose, "kr3", s.m2.overrides[loose.id], dk(loose));
    expect(s.m2.overrides[loose.id]).toEqual(["kr1", "kr3"]);
    s = U.setHow(s, "m2", loose.id, "kr1", "h");
    s = U.setProposal(s, "m2", loose.id, "kr2", "skipped");
    expect(s.m2.proposals[U.proposalKey(loose.id, "kr1")]).toBe("taken");
    expect(s.m2.proposals[U.proposalKey(loose.id, "kr3")]).toBe("taken");
    expect(s.m2.proposals[U.proposalKey(loose.id, "kr2")]).toBe("skipped");
    s = U.setOverride(s, "m2", loose, ["kr3"], dk(loose));
    expect(s.m2.proposals[U.proposalKey(loose.id, "kr1")]).toBeUndefined();
    expect(s.m2.proposals[U.proposalKey(loose.id, "kr3")]).toBe("taken");
    expect(s.m2.how).toEqual({});
  });
  it("既存のつなぎ先に足す：もとの既定のKRを残したまま、提案を採ると既定＋提案になる", () => {
    const p1 = tasks.find((t) => t.pjId === "p1" && t.assigneeId === "m3" && t.status !== "完了")!;
    const s = U.takeProposal(fresh(), "m3", p1, "kr3", dk(p1), dk(p1));
    expect(s.m3.overrides[p1.id]).toEqual(["kr1", "kr3"]);
  });
});

describe("結節点の見本（初期データ）", () => {
  it("3人それぞれに1〜2件。KRの組み合わせは偏らず、3つにまたがる仕事が1件ある", () => {
    const ctx: LinkCtx = { ...baseCtx, overrides: U.mergedOverrides(fresh()) };
    const sets = new Set<string>();
    for (const id of ["m1", "m2", "m3"]) {
      const own = Object.keys(fresh()[id].overrides);
      expect(own.length).toBeGreaterThanOrEqual(1);
      expect(own.length).toBeLessThanOrEqual(2);
      for (const tid of own) {
        const t = tasks.find((x) => x.id === tid)!;
        expect(t.assigneeId).toBe(id);
        expect(dk(t)).toHaveLength(1);
        expect(krIdsOfTask(t, ctx).length).toBeGreaterThanOrEqual(2);
        sets.add(krIdsOfTask(t, ctx).join("+"));
      }
    }
    expect(sets.size).toBeGreaterThanOrEqual(4);
    expect([...sets].filter((x) => x.split("+").length === 3)).toHaveLength(1);
  });
});

describe("今週やる", () => {
  it("印を付け外しできる（自分の仕事だけ）", () => {
    let s = fresh();
    s = U.togglePick(s, "m3", WEEK_START, t2);
    expect(s.m3.picks[WEEK_START]).toContain(t2.id);
    s = U.togglePick(s, "m3", WEEK_START, t2);
    expect(s.m3.picks[WEEK_START]).not.toContain(t2.id);
  });
  it("週ごとに別に持つ", () => {
    let s = fresh();
    s = U.togglePick(s, "m3", "2026-11-02", t2);
    expect(s.m3.picks["2026-11-02"]).toEqual([t2.id]);
    expect(s.m3.picks[WEEK_START]).not.toContain(t2.id);
  });
});

describe("振り返りの答えは週×KR", () => {
  it("同じKRでも週が違えば別、同じ週でもKRが違えば別", () => {
    let s = fresh();
    s = U.setAnswer(s, "m2", WEEK_START, "kr1", { effect: "役立った" });
    s = U.setAnswer(s, "m2", "2026-11-02", "kr1", { effect: "少し役立った" });
    s = U.setAnswer(s, "m2", WEEK_START, "kr3", { match: "違う" });
    s = U.setAnswer(s, "m2", WEEK_START, "kr1", { match: "そのとおり" });
    expect(s.m2.answers[answerKey(WEEK_START, "kr1")]).toEqual({ effect: "役立った", match: "そのとおり" });
    expect(s.m2.answers[answerKey("2026-11-02", "kr1")]).toEqual({ effect: "少し役立った" });
    expect(s.m2.answers[answerKey(WEEK_START, "kr3")]).toEqual({ match: "違う" });
  });
});

describe("資料の確定：決定事項は足し合わせ、食い違いは選ばせる", () => {
  it("同じ回の2資料を確定しても、資料ごとに足し合わされる（前の回・前の資料は消えない）", () => {
    const once = mergeDecisions(decisionsInit, [deck], nextCheckin);
    const twice = mergeDecisions(once, [minutes], nextCheckin);
    expect(twice.filter((d) => d.checkinId === nextCheckin.id)).toHaveLength(deck.decisions.length + minutes.decisions.length);
    expect(twice.filter((d) => d.resourceId === "deck")).toHaveLength(deck.decisions.length);
    expect(twice.filter((d) => d.checkinId !== nextCheckin.id)).toHaveLength(decisionsInit.length);
    expect(checkinsInit.some((c) => c.id === nextCheckin.id)).toBe(false);
  });
  it("同じ資料の確定し直しは、その資料の分だけ入れ替わる（重複しない）", () => {
    const once = mergeDecisions(decisionsInit, [deck, minutes], nextCheckin);
    const again = mergeDecisions(once, [deck], nextCheckin);
    expect(again).toHaveLength(once.length);
    expect(new Set(again.map((d) => d.id)).size).toBe(again.length);
  });
  it("同じKRに資料どうしで違う値があると食い違いとして並ぶ（KR1：22と21）。片方にしか無いKRは並ばない", () => {
    const c = detectConflicts([deck, minutes], recordsInit, nextCheckin.date);
    expect(c.map((x) => x.krId)).toEqual(["kr1"]);
    expect(c[0].options.map((o) => o.value).sort()).toEqual([21, 22]);
    expect(c[0].options.every((o) => !o.existing)).toBe(true);
    expect(detectConflicts([deck], recordsInit, nextCheckin.date)).toEqual([]);
  });
  it("同じ値なら食い違いにしない", () => {
    const same = { ...minutes, drafts: [{ ...minutes.drafts[0], value: 22 }] };
    expect(detectConflicts([deck, same], recordsInit, nextCheckin.date)).toEqual([]);
  });
  it("選ぶまで確定できない。選んだ値が採られる", () => {
    const c = detectConflicts([deck, minutes], recordsInit, nextCheckin.date);
    expect(unresolved(c, {})).toEqual(["kr1"]);
    expect(unresolved(c, { kr1: 0 })).toEqual([]);
    const idx21 = c[0].options.findIndex((o) => o.value === 21);
    const drafts = mergeDrafts([deck, minutes], c, { kr1: idx21 });
    expect(drafts.find((d) => d.krId === "kr1")!.value).toBe(21);
    expect(drafts.find((d) => d.krId === "kr1")!.source.doc).toBe("議事録_20261110.txt");
    expect(drafts.map((d) => d.krId).sort()).toEqual(["kr1", "kr2"]);
    const assessed = [deck, minutes].flatMap((r) => r.assessments.map((a) => ({ krId: a.krId, source: a.source })));
    const out = applyConfirm(recordsInit, drafts, {}, assessed, nextCheckin.date);
    expect(out.kr1.hint).toMatchObject({ value: 21, prev: 18 });
    expect(out.kr2.hint).toMatchObject({ value: 73 });
    expect(out.kr3.updatedAt).toBe(nextCheckin.date);
  });
  it("すでに確定済みの値とも突き合わせる（deck確定後に minutes を読ませると 22 が候補に出る）", () => {
    const deckAssessed = deck.assessments.map((a) => ({ krId: a.krId, source: a.source }));
    const after = applyConfirm(recordsInit, deck.drafts, {}, deckAssessed, nextCheckin.date);
    const c = detectConflicts([minutes], after, nextCheckin.date);
    expect(c.map((x) => x.krId)).toEqual(["kr1"]);
    const existing = c[0].options.find((o) => o.existing)!;
    expect(existing.value).toBe(22);
    const keep = mergeDrafts([minutes], c, { kr1: c[0].options.indexOf(existing) });
    const out = applyConfirm(after, keep, {}, [], nextCheckin.date);
    expect(out.kr1.hint).toMatchObject({ value: 22, prev: 18 });
  });
});

describe("KRの色は並びから作る（決め打ちしない）", () => {
  it("KRの並び順に色が付き、色が足りなくなったら同じ色に模様番号が付く", () => {
    const krs = okrItems.filter((i) => i.kind === "kr").map((i) => i.id);
    expect(new Set(krs.map((k) => krStyle(k).color)).size).toBe(krs.length);
    expect(krStyleAt(0).pattern).toBe(0);
    expect(krStyleAt(KR_PALETTE.length)).toEqual({ color: KR_PALETTE[0], pattern: 1 });
    expect(krStyleAt(KR_PALETTE.length + 1).color).toBe(KR_PALETTE[1]);
    expect(krStyleAt(KR_PALETTE.length * 2).pattern).toBe(2);
  });
});
