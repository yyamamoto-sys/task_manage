import { describe, expect, it } from "vitest";
import { aiCandidates, okrItems, OWNER_ID, PERIOD_END, PERIOD_START, pjsInit, recordsInit, resources, tasks } from "../fixtures";
import { bandSegments, flowCounts, layoutFlow, ribbonPath, UNIT } from "../flow";
import {
  applyDrafts,
  crossedMilestones,
  focusKrs,
  focusTasks,
  isOpen,
  krPace,
  krProgress,
  linkedTasks,
  paceGap,
  periodElapsed,
  TODAY,
  weeklyFocus,
  type LinkCtx,
} from "../logic";
import type { Task } from "../types";

const ctx: LinkCtx = { pjs: pjsInit, items: okrItems, overrides: {} };
const krIds = ["kr1", "kr2", "kr3"];
const team = flowCounts({ tasks, pjs: pjsInit, ctx, ownerId: OWNER_ID, scope: "team" });
const edge = (c: typeof team, pj: string, kr: string) => c.edges.find((e) => e.pjId === pj && e.krId === kr);

describe("流れの図：帯の件数", () => {
  it("帯の太さ＝終えた仕事の件数、未完了は同じ帯の別枠", () => {
    const p1 = tasks.filter((t) => t.pjId === "p1");
    const e = edge(team, "p1", "kr1")!;
    expect(e.done).toBe(p1.filter((t) => t.status === "完了").length);
    expect(e.open).toBe(p1.filter(isOpen).length);
    const lay = layoutFlow({ counts: team, krIds, personalIds: [], expanded: [] });
    const r = lay.pjKr.find((x) => x.id === "p1>kr1")!;
    expect(r.width).toBe((e.done + e.open) * UNIT);
    expect(r.segments.reduce((s, g) => s + g.thickness, 0)).toBe(r.width);
  });
  it("同じKRに2つのTFで付く共有PJは、KRへの帯が1本で数も二重にならない", () => {
    const p2 = tasks.filter((t) => t.pjId === "p2");
    expect(team.edges.filter((e) => e.pjId === "p2")).toHaveLength(1);
    expect(edge(team, "p2", "kr1")!.done + edge(team, "p2", "kr1")!.open).toBe(p2.length);
  });
  it("別々のKRにまたがる共有PJは帯が分かれ、合計では1回に数える", () => {
    const p7 = tasks.filter((t) => t.pjId === "p7");
    expect(edge(team, "p7", "kr2")!.done + edge(team, "p7", "kr2")!.open).toBe(p7.length);
    expect(edge(team, "p7", "kr3")!.done + edge(team, "p7", "kr3")!.open).toBe(p7.length);
    expect(team.linkedByPj.p7).toHaveLength(p7.length);
    const lay = layoutFlow({ counts: team, krIds, personalIds: [], expanded: [] });
    const unique = linkedTasks(tasks, ctx).length;
    expect(lay.o.done + lay.o.open).toBe(unique);
    const edgeTotal = team.edges.reduce((s, e) => s + e.done + e.open, 0);
    expect(edgeTotal).toBeGreaterThan(unique);
  });
  it("本人の分の内訳が帯の中に入る", () => {
    const mineDone = tasks.filter((t) => t.pjId === "p1" && t.assigneeId === OWNER_ID && t.status === "完了").length;
    const e = edge(team, "p1", "kr1")!;
    expect(e.mineDone).toBe(mineDone);
    expect(e.mineDone).toBeLessThanOrEqual(e.done);
    const segs = bandSegments(e);
    expect(segs[0].kind).toBe("doneMine");
    expect(segs[0].count).toBe(mineDone);
    expect(segs.find((s) => s.kind === "openOther")!.count).toBe(e.open - e.mineOpen);
  });
  it("つながりのない仕事は帯を作らず、下の点線の列に並ぶ。提案を採る（上書き）とつながる", () => {
    const p8 = tasks.filter((t) => t.pjId === "p8");
    expect(team.loose).toHaveLength(p8.length);
    expect(team.edges.some((e) => e.pjId === "p8")).toBe(false);
    const lay = layoutFlow({ counts: team, krIds, personalIds: [], expanded: [] });
    expect(lay.loose).toHaveLength(p8.length);
    expect(lay.loose[0].y).toBeGreaterThan(Math.max(...lay.pjNodes.map((n) => n.y + n.h)));
    const first = p8[0];
    const cand = aiCandidates.p8[0].krId;
    const after = flowCounts({ tasks, pjs: pjsInit, ctx: { ...ctx, overrides: { [first.id]: cand } }, ownerId: OWNER_ID, scope: "team" });
    expect(after.loose).toHaveLength(p8.length - 1);
    expect(edge(after, "p8", cand)!.done + edge(after, "p8", cand)!.open).toBe(1);
  });
  it("自分の表示は本人の仕事だけを数える", () => {
    const self = flowCounts({ tasks, pjs: pjsInit, ctx, ownerId: OWNER_ID, scope: "self" });
    const all = [...Object.values(self.linkedByPj).flat(), ...self.loose];
    expect(all.every((t: Task) => t.assigneeId === OWNER_ID)).toBe(true);
    expect(all).toHaveLength(tasks.filter((t) => t.assigneeId === OWNER_ID).length);
  });
});

describe("流れの図：配置", () => {
  const lay = layoutFlow({ counts: team, krIds, personalIds: [], expanded: [] });
  it("PJノードは重ならず、帯はノードの中に収まる", () => {
    const sorted = [...lay.pjNodes].sort((a, b) => a.y - b.y);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i].y).toBeGreaterThanOrEqual(sorted[i - 1].y + sorted[i - 1].h);
    for (const n of lay.pjNodes) {
      const out = lay.pjKr.filter((r) => r.fromId === n.pjId);
      expect(out.reduce((s, r) => s + r.width, 0)).toBeLessThanOrEqual(n.h + 0.001);
      for (const r of out) {
        expect(r.sy).toBeGreaterThanOrEqual(n.y - 0.001);
        expect(r.sy + r.width).toBeLessThanOrEqual(n.y + n.h + 0.001);
      }
    }
  });
  it("KRノードは重ならず、入る帯はノードの中に収まる", () => {
    for (let i = 1; i < lay.krNodes.length; i++) expect(lay.krNodes[i].y).toBeGreaterThanOrEqual(lay.krNodes[i - 1].y + lay.krNodes[i - 1].h);
    for (const k of lay.krNodes) {
      const inc = lay.pjKr.filter((r) => r.toId === k.krId);
      for (const r of inc) {
        expect(r.ty).toBeGreaterThanOrEqual(k.y - 0.001);
        expect(r.ty + r.width).toBeLessThanOrEqual(k.y + k.h + 0.001);
      }
    }
  });
  it("PJは6〜8、KRは3〜4、全体のノードは1つ", () => {
    expect(pjsInit.length).toBeGreaterThanOrEqual(6);
    expect(pjsInit.length).toBeLessThanOrEqual(8);
    expect(lay.krNodes).toHaveLength(3);
    expect(lay.krO).toHaveLength(3);
  });
  it("PJを開くとタスクの行が増え、下のノードが押し下がる", () => {
    const open = layoutFlow({ counts: team, krIds, personalIds: [], expanded: ["p1"] });
    const p1 = open.pjNodes.find((n) => n.pjId === "p1")!;
    expect(p1.rows).toHaveLength(team.linkedByPj.p1.length);
    expect(open.height).toBeGreaterThan(lay.height);
  });
  it("個人OKRの列があると左端に並び、PJの列が右へ寄る", () => {
    const self = flowCounts({ tasks, pjs: pjsInit, ctx, ownerId: OWNER_ID, scope: "self" });
    const withP = layoutFlow({ counts: self, krIds, personalIds: ["po1", "po2", "po3"], expanded: [] });
    expect(withP.personal).toHaveLength(3);
    expect(withP.cols.pj.x).toBeGreaterThan(withP.cols.personal.x + withP.cols.personal.w);
  });
  it("帯のパスは数値だけで組み立てられる", () => {
    const d = ribbonPath({ sx: 0, sy: 0, tx: 100, ty: 50 }, 0, 10);
    expect(d.startsWith("M 0 0 C")).toBe(true);
    expect(d).not.toMatch(/NaN|undefined/);
  });
});

describe("遅れの判定と、今週ここに力を", () => {
  const elapsed = periodElapsed(PERIOD_START, PERIOD_END, TODAY);
  it("期の経過割合は日付から出る（7/1〜12/31の11/10は約72%）", () => {
    expect(elapsed).toBeCloseTo(132 / 183, 5);
    expect(periodElapsed(PERIOD_START, PERIOD_END, PERIOD_START)).toBe(0);
    expect(periodElapsed(PERIOD_START, PERIOD_END, "2027-02-01")).toBe(1);
  });
  it("進み：数値は現状÷目標、バンドは段で測る（D=0、目標=1）", () => {
    expect(krProgress(recordsInit.kr1)).toBeCloseTo(0.6, 5);
    expect(krProgress(recordsInit.kr3)).toBeCloseTo(1 / 3, 5);
  });
  it("期の経過に対して進みが下回るKRが遅れ。追いついていれば先行、届けば到達", () => {
    expect(krPace(recordsInit.kr1, elapsed)).toBe("behind");
    expect(krPace(recordsInit.kr2, elapsed)).toBe("ahead");
    expect(krPace(recordsInit.kr3, elapsed)).toBe("behind");
    expect(paceGap(recordsInit.kr3, elapsed)).toBeGreaterThan(paceGap(recordsInit.kr1, elapsed));
    expect(krPace({ ...recordsInit.kr2, value: 80 } as typeof recordsInit.kr2, elapsed)).toBe("reached");
  });
  it("遅れているKRを、遅れの大きい順に最大2個挙げる", () => {
    expect(focusKrs(recordsInit, krIds, elapsed)).toEqual(["kr3", "kr1"]);
    expect(focusKrs(recordsInit, krIds, elapsed, 1)).toEqual(["kr3"]);
  });
  it("本人の未着手・進行中の仕事を上位3件（完了・他人の仕事は入らない）", () => {
    const list = focusTasks(tasks, OWNER_ID, "kr3", ctx);
    expect(list.length).toBeGreaterThan(0);
    expect(list.length).toBeLessThanOrEqual(3);
    expect(list.every((t) => t.assigneeId === OWNER_ID && isOpen(t))).toBe(true);
    expect([...list].sort((a, b) => (a.due < b.due ? -1 : 1))).toEqual(list);
  });
  it("本人視点では仕事が付き、GM・他人視点ではKRにつながる件数だけ", () => {
    const base = { records: recordsInit, krIds, elapsed, tasks, ctx, memberId: OWNER_ID };
    const mine = weeklyFocus({ ...base, isOwnerView: true });
    const other = weeklyFocus({ ...base, isOwnerView: false });
    expect(mine.map((m) => m.krId)).toEqual(other.map((m) => m.krId));
    expect(mine[0].mine.length).toBeGreaterThan(0);
    expect(other.every((o) => o.mine.length === 0 && o.openCount > 0)).toBe(true);
  });
  it("資料を確定して追いつくと、遅れの候補から外れる", () => {
    const deck = resources.find((r) => r.id === "deck")!;
    const after = applyDrafts(recordsInit, deck.drafts, {}, "2026-11-10");
    expect(focusKrs(after, krIds, elapsed)).toEqual(["kr3"]);
  });
});

describe("節目（半分・目標到達）", () => {
  it("KR3がDからBへ上がると半分を越える。KR1の18→22は節目なし", () => {
    const deck = resources.find((r) => r.id === "deck")!;
    const after = applyDrafts(recordsInit, deck.drafts, {}, "2026-11-10");
    expect(crossedMilestones(recordsInit.kr3, after.kr3)).toEqual(["half"]);
    expect(crossedMilestones(recordsInit.kr1, after.kr1)).toEqual([]);
  });
  it("目標に届いたときは半分ではなく到達だけ", () => {
    expect(crossedMilestones(recordsInit.kr2, { ...recordsInit.kr2, value: 80 } as typeof recordsInit.kr2)).toEqual(["reached"]);
    expect(crossedMilestones(recordsInit.kr1, { ...recordsInit.kr1, value: 30 } as typeof recordsInit.kr1)).toEqual(["reached"]);
  });
  it("すでに越えているものは再び出さない", () => {
    expect(crossedMilestones(recordsInit.kr2, { ...recordsInit.kr2, value: 75 } as typeof recordsInit.kr2)).toEqual([]);
  });
});
