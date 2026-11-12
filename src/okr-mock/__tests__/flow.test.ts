import { describe, expect, it } from "vitest";
import { okrItems, PERIOD_START, pjsInit, tasks } from "../fixtures";
import {
  bandSegments,
  flowCounts,
  KR_BAND,
  KR_H,
  layoutFlow,
  MAX_PJ,
  MIN_BAND,
  O_BAND,
  O_H,
  OTHER_PJ,
  proportionalWidths,
  ribbonPath,
} from "../flow";
import { isOpen, itemsInQuarter, linkedTasks, PERSONAL_PJ, type LinkCtx } from "../logic";
import type { Pj, Task } from "../types";

const items4Q = itemsInQuarter(okrItems, "4Q");
const ctx: LinkCtx = { pjs: pjsInit, items: items4Q, overrides: {} };
const krIds = ["kr1", "kr2", "kr3"];
const base = { ctx, ownerId: "m2", periodStart: PERIOD_START };
const team = flowCounts({ tasks, ...base, scope: "team" });
const edge = (c: typeof team, pj: string, kr: string) => c.edges.find((e) => e.pjId === pj && e.krId === kr);
const lay = (c = team, over: Partial<Parameters<typeof layoutFlow>[0]> = {}) => layoutFlow({ counts: c, krIds, personalIds: [], expanded: [], showLoose: false, ...over });

describe("帯の太さは件数ではなく割合", () => {
  it("proportionalWidths：合計は決まった太さのまま、件数に比例する", () => {
    const w = proportionalWidths([30, 20, 50], 100, 5);
    expect(w.reduce((s, v) => s + v, 0)).toBeCloseTo(100, 5);
    expect(w[0] / w[1]).toBeCloseTo(1.5, 5);
    expect(w[2] / w[0]).toBeCloseTo(50 / 30, 5);
  });
  it("proportionalWidths：細くなりすぎる帯は最小に固定し、残りを割合で分け直す（合計は変わらない）", () => {
    const w = proportionalWidths([1, 1, 98], 100, 10);
    expect(w[0]).toBe(10);
    expect(w[1]).toBe(10);
    expect(w[2]).toBeCloseTo(80, 5);
    expect(w.reduce((s, v) => s + v, 0)).toBeCloseTo(100, 5);
  });
  it("proportionalWidths：帯が多すぎて最小を並べても収まらないときは均等", () => {
    expect(proportionalWidths([1, 2, 3], 20, 10)).toEqual([20 / 3, 20 / 3, 20 / 3]);
    expect(proportionalWidths([], 100, 10)).toEqual([]);
  });
  it("1つのKRに流れ込む帯の太さの合計は一定で、件数の多いPJほど太い", () => {
    const l = lay();
    for (const k of krIds) {
      const inc = l.pjKr.filter((r) => r.toId === k);
      expect(inc.reduce((s, r) => s + r.width, 0)).toBeCloseTo(KR_BAND, 5);
      for (const r of inc) expect(r.width).toBeGreaterThanOrEqual(MIN_BAND - 0.001);
      const sorted = [...inc].sort((a, b) => a.done + a.open - (b.done + b.open));
      for (let i = 1; i < sorted.length; i++) expect(sorted[i].width).toBeGreaterThanOrEqual(sorted[i - 1].width - 0.001);
    }
    expect(l.krO.reduce((s, r) => s + r.width, 0)).toBeCloseTo(O_BAND, 5);
  });
  it("帯の中の濃い部分（終えた）と薄い部分（残り）は件数の割合で、帯の太さは変わらない", () => {
    const s = bandSegments({ done: 5, open: 3 }, 40);
    expect(s.map((x) => x.kind)).toEqual(["done", "open"]);
    expect(s[0].thickness).toBeCloseTo(25, 5);
    expect(s[1].thickness).toBeCloseTo(15, 5);
    expect(s.reduce((a, x) => a + x.thickness, 0)).toBeCloseTo(40, 5);
    expect(bandSegments({ done: 0, open: 3 }, 40)).toHaveLength(1);
    expect(bandSegments({ done: 0, open: 0 }, 40)).toEqual([]);
  });
  it("帯のKR側の端に「完了◯／残り◯」の件数が入る", () => {
    const l = lay();
    const r = l.pjKr.find((x) => x.id === "p1>kr1")!;
    const e = edge(team, "p1", "kr1")!;
    expect(r.done).toBe(e.done);
    expect(r.open).toBe(e.open);
    expect(r.labelX).toBeGreaterThan(r.tx);
    expect(r.labelX).toBeLessThan(l.cols.kr.x);
  });
  it("同じKRの帯の件数ラベルは重ならない", () => {
    const l = lay();
    for (const k of krIds) {
      const ys = l.pjKr.filter((r) => r.toId === k).map((r) => r.labelY).sort((a, b) => a - b);
      for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(12);
    }
  });
  it("仕事が10倍になっても、図の高さ・KRとOの高さ・帯の太さは変わらない", () => {
    const x10: Task[] = Array.from({ length: 10 }, (_, i) => tasks.map((t) => ({ ...t, id: `${t.id}#${i}` }))).flat();
    const big = flowCounts({ tasks: x10, ...base, scope: "team" });
    const a = lay();
    const b = lay(big);
    expect(b.height).toBe(a.height);
    expect(b.krNodes.map((n) => n.h)).toEqual(a.krNodes.map((n) => n.h));
    expect(b.o.h).toBe(a.o.h);
    expect(b.pjNodes.map((n) => n.h)).toEqual(a.pjNodes.map((n) => n.h));
    expect(b.pjKr.map((r) => Math.round(r.width * 1000))).toEqual(a.pjKr.map((r) => Math.round(r.width * 1000)));
    expect(big.edges.reduce((s, e) => s + e.done + e.open, 0)).toBe(10 * team.edges.reduce((s, e) => s + e.done + e.open, 0));
  });
  it("KRとOの高さは固定", () => {
    const l = lay();
    for (const n of l.krNodes) expect(n.h).toBe(KR_H);
    expect(l.o.h).toBe(O_H);
  });
});

describe("流れの図：件数の数え方", () => {
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
    const l = lay();
    const unique = linkedTasks(tasks.filter((t) => t.status !== "完了" || t.updated >= PERIOD_START), ctx).length;
    expect(l.o.done + l.o.open).toBe(unique);
    expect(team.edges.reduce((s, e) => s + e.done + e.open, 0)).toBeGreaterThan(unique);
  });
  it("終えた仕事と未完了が、同じ帯の濃い部分と薄い部分になる", () => {
    const p1 = tasks.filter((t) => t.pjId === "p1" && (t.status !== "完了" || t.updated >= PERIOD_START));
    const e = edge(team, "p1", "kr1")!;
    expect(e.done).toBe(p1.filter((t) => t.status === "完了").length);
    expect(e.open).toBe(p1.filter(isOpen).length);
  });
  it("今期の仕事だけ：上期に終えた仕事は図に入らない", () => {
    const all = Object.values(team.linkedByPj).flat().concat(team.loose);
    expect(all.map((t) => t.title)).not.toContain("旧期の提案テンプレを整える");
    expect(all).toHaveLength(tasks.length - 1);
  });
  it("3Qだけにあった TF の仕事（完了済み）は、4Qの構成でも図に残る。未完了なら残らず、つながらない仕事になる", () => {
    expect(edge(team, "p9", "kr1")!.done).toBe(3);
    const open: Task = { ...tasks.find((t) => t.pjId === "p9")!, id: "p9-open", status: "進行中", doneKrIds: undefined };
    const c = flowCounts({ tasks: [open], ...base, scope: "team" });
    expect(c.loose).toHaveLength(1);
    expect(c.edges).toHaveLength(0);
  });
  it("つながらない仕事は帯を作らない。PJに属さない個人の仕事も数える（図から消えない）", () => {
    const p8 = tasks.filter((t) => t.pjId === "p8");
    const personal = tasks.filter((t) => t.pjId === PERSONAL_PJ);
    expect(personal.length).toBeGreaterThan(0);
    expect(team.loose).toHaveLength(p8.length + personal.length);
    expect(team.edges.some((e) => e.pjId === "p8" || e.pjId === PERSONAL_PJ)).toBe(false);
  });
  it("個人の仕事につなぎ先を付けると、「個人の仕事」のまとまりとして図に現れる", () => {
    const t = tasks.find((x) => x.pjId === PERSONAL_PJ && x.assigneeId === "m2")!;
    const c = flowCounts({ tasks, ...base, ctx: { ...ctx, overrides: { [t.id]: ["kr3"] } }, scope: "team" });
    expect(edge(c, PERSONAL_PJ, "kr3")!.open).toBe(1);
    expect(c.loose).toHaveLength(team.loose.length - 1);
  });
  it("提案を採る（上書き）とつながる", () => {
    const first = tasks.find((t) => t.pjId === "p8")!;
    const after = flowCounts({ tasks, ...base, ctx: { ...ctx, overrides: { [first.id]: ["kr1"] } }, scope: "team" });
    expect(after.loose).toHaveLength(team.loose.length - 1);
    expect(edge(after, "p8", "kr1")!.open).toBe(1);
  });
  it("自分の表示は本人の仕事だけを数える", () => {
    const self = flowCounts({ tasks, ...base, scope: "self" });
    const all = [...Object.values(self.linkedByPj).flat(), ...self.loose];
    expect(all.every((t: Task) => t.assigneeId === "m2")).toBe(true);
    expect(all).toHaveLength(tasks.filter((t) => t.assigneeId === "m2" && t.title !== "旧期の提案テンプレを整える").length);
  });
});

describe("つながらない仕事の見せ方", () => {
  it("チーム表示は件数だけ（名前つきの行を持たない）", () => {
    const l = lay(team, { showLoose: false });
    expect(l.loose).toHaveLength(0);
    expect(l.looseCount).toBe(team.loose.length);
    expect(l.height).toBeGreaterThan(l.looseTop);
  });
  it("自分の表示では、名前つきで下の点線の列に並ぶ", () => {
    const self = flowCounts({ tasks, ...base, scope: "self" });
    const l = lay(self, { showLoose: true });
    expect(l.loose).toHaveLength(self.loose.length);
    expect(l.loose[0].y).toBeGreaterThan(Math.max(...l.pjNodes.map((n) => n.y + n.h)));
  });
});

describe("PJが9以上のときは8つ＋「ほか◯PJ」", () => {
  const many = 12;
  const pjs: Pj[] = Array.from({ length: many }, (_, i) => ({ id: `x${i}`, name: `PJ${i}`, tfIds: ["tf11"] }));
  const mk = (pjId: string, n: number): Task[] =>
    Array.from({ length: n }, (_, i) => ({ id: `${pjId}-${i}`, pjId, title: `${pjId}-${i}`, assigneeId: "m2", due: "2026-12-01", status: i % 2 ? "完了" : "進行中", updated: "2026-11-01", doneKrIds: i % 2 ? ["kr1"] : undefined }) as Task);
  const ts = pjs.flatMap((p, i) => mk(p.id, i + 1));
  const c = flowCounts({ tasks: ts, ...base, ctx: { pjs, items: items4Q, overrides: {} }, scope: "team" });
  const l = layoutFlow({ counts: c, krIds, personalIds: [], expanded: [], showLoose: false });
  it("件数の多い順に8つ並べ、残りは1つの枠にまとめる", () => {
    expect(l.pjNodes).toHaveLength(MAX_PJ + 1);
    const other = l.pjNodes.find((n) => n.pjId === OTHER_PJ)!;
    expect(other.members).toHaveLength(many - MAX_PJ);
    const shown = l.pjNodes.filter((n) => n.pjId !== OTHER_PJ).map((n) => n.pjId);
    expect(shown).toContain("x11");
    expect(shown).not.toContain("x0");
    expect(other.members.map((m) => m.pjId).sort()).toEqual(["x0", "x1", "x2", "x3"]);
    expect(other.done + other.open).toBe(1 + 2 + 3 + 4);
  });
  it("まとめた枠の帯の件数は、中身のPJの合計。KRへの帯の太さの合計は変わらない", () => {
    const r = l.pjKr.filter((x) => x.fromId === OTHER_PJ);
    expect(r.reduce((s, x) => s + x.done + x.open, 0)).toBe(10);
    expect(l.pjKr.filter((x) => x.toId === "kr1").reduce((s, x) => s + x.width, 0)).toBeCloseTo(KR_BAND, 5);
  });
  it("8個以下のときはまとめない", () => {
    const c8 = flowCounts({ tasks: ts.filter((t) => Number(t.pjId.slice(1)) >= 4), ...base, ctx: { pjs, items: items4Q, overrides: {} }, scope: "team" });
    const l8 = layoutFlow({ counts: c8, krIds, personalIds: [], expanded: [], showLoose: false });
    expect(l8.pjNodes).toHaveLength(8);
    expect(l8.pjNodes.some((n) => n.pjId === OTHER_PJ)).toBe(false);
  });
  it("押すとPJの一覧が開く（まとめた枠を開くと、中身のPJの行が出る）", () => {
    const open = layoutFlow({ counts: c, krIds, personalIds: [], expanded: [OTHER_PJ], showLoose: false });
    const other = open.pjNodes.find((n) => n.pjId === OTHER_PJ)!;
    expect(other.rows).toHaveLength(4);
    expect(other.rows.every((r) => r.kind === "pj")).toBe(true);
  });
});

describe("流れの図：配置", () => {
  const l = lay();
  it("PJノードは重ならず、帯はノードの中に収まる", () => {
    const sorted = [...l.pjNodes].sort((a, b) => a.y - b.y);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i].y).toBeGreaterThanOrEqual(sorted[i - 1].y + sorted[i - 1].h);
    for (const n of l.pjNodes) {
      const out = l.pjKr.filter((r) => r.fromId === n.pjId);
      expect(out.reduce((s, r) => s + r.width, 0)).toBeLessThanOrEqual(n.h + 0.001);
      for (const r of out) {
        expect(r.sy).toBeGreaterThanOrEqual(n.y - 0.001);
        expect(r.sy + r.width).toBeLessThanOrEqual(n.y + n.h + 0.001);
      }
    }
  });
  it("KRノードは重ならず、入る帯はノードの中に収まる", () => {
    for (let i = 1; i < l.krNodes.length; i++) expect(l.krNodes[i].y).toBeGreaterThanOrEqual(l.krNodes[i - 1].y + l.krNodes[i - 1].h);
    for (const k of l.krNodes) {
      for (const r of l.pjKr.filter((x) => x.toId === k.krId)) {
        expect(r.ty).toBeGreaterThanOrEqual(k.y - 0.001);
        expect(r.ty + r.width).toBeLessThanOrEqual(k.y + k.h + 0.001);
      }
    }
  });
  it("KRの列はデータから作る（KRが3つなら3つ、4つなら4つ）", () => {
    expect(l.krNodes).toHaveLength(3);
    expect(l.krO).toHaveLength(3);
    const l4 = layoutFlow({ counts: team, krIds: [...krIds, "krX"], personalIds: [], expanded: [], showLoose: false });
    expect(l4.krNodes).toHaveLength(4);
    expect(l4.krO).toHaveLength(3);
  });
  it("PJを開くと仕事の行が増え、下のノードが押し下がる", () => {
    const open = lay(team, { expanded: ["p1"] });
    const p1 = open.pjNodes.find((n) => n.pjId === "p1")!;
    expect(p1.rows).toHaveLength(team.linkedByPj.p1.length);
    expect(open.height).toBeGreaterThan(l.height);
  });
  it("個人OKRの列があると左端に並び、PJの列が右へ寄る", () => {
    const self = flowCounts({ tasks, ...base, scope: "self" });
    const withP = lay(self, { personalIds: ["po1", "po2", "po3"] });
    expect(withP.personal).toHaveLength(3);
    expect(withP.cols.pj.x).toBeGreaterThan(withP.cols.personal.x + withP.cols.personal.w);
  });
  it("帯のパスは数値だけで組み立てられる", () => {
    const d = ribbonPath({ sx: 0, sy: 0, tx: 100, ty: 50 }, 0, 10);
    expect(d.startsWith("M 0 0 C")).toBe(true);
    expect(d).not.toMatch(/NaN|undefined/);
  });
  it("どの座標も有限の数", () => {
    for (const r of [...l.pjKr, ...l.krO]) for (const v of [r.sx, r.sy, r.tx, r.ty, r.width, r.labelX, r.labelY]) expect(Number.isFinite(v)).toBe(true);
  });
});
