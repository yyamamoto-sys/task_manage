import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import App from "../App";
import { flowCounts, junctionIdsOf, KR_BAND, layoutFlow, tfInputOf } from "../flow";
import { okrItems, overridesInit, PERIOD_START, pjsInit, tasks, WEEK_START } from "../fixtures";
import { buildSummaryText, buildup, howKey, itemsInQuarter, junctionTasks, krIdsOfTask, sharedWork, TODAY, tasksDoneBetween, tasksOfKr, type LinkCtx } from "../logic";
import type { InitialView } from "../state";
import type { Task } from "../types";
import * as U from "../userState";

const items4Q = itemsInQuarter(okrItems, "4Q");
const krIds = ["kr1", "kr2", "kr3"];
const noOv: LinkCtx = { pjs: pjsInit, items: items4Q, overrides: {} };
const titled = (title: string) => tasks.find((t) => t.title === title)!;
const html = (initial?: InitialView) => renderToStaticMarkup(createElement(App, { initial }));
const withOv = (ov: Record<string, string[]>): LinkCtx => ({ ...noOv, overrides: ov });

// 見本：本人が選び直した仕事（PJ既定は1つのKR）
const A = titled("ヒアリング対象の過去取引を確認する"); // 完了済み・p3＝KR1 → KR1＋KR2
const B = titled("月次レポートを1本、自動で作る"); // p6＝KR3 → KR1＋KR3
const C = titled("価格表を最新にする"); // p1＝KR1 → KR1＋KR2＋KR3
const seeded = withOv(U.mergedOverrides(U.initialUserStates(WEEK_START)));

describe("結節点の抽出（2つ以上のKRにつながる仕事）", () => {
  it("PJの既定で複数KRにつながる仕事も、本人が選んだ仕事も含む。1つだけの仕事は含まない", () => {
    const byDefault = junctionTasks(tasks, noOv);
    expect(byDefault.length).toBeGreaterThan(0);
    expect(byDefault.every((t) => t.pjId === "p7")).toBe(true);
    expect(byDefault.map((t) => t.id)).not.toContain(A.id);
    const picked = junctionTasks(tasks, withOv({ [A.id]: ["kr1", "kr2"] }));
    expect(picked.map((t) => t.id)).toContain(A.id);
    expect(picked.some((t) => t.pjId === "p7")).toBe(true);
    expect(krIdsOfTask(titled("提案資料の骨子を決める"), noOv)).toEqual(["kr1"]);
  });
  it("0個・1個に選び直した仕事は結節点でなくなる（既定が複数でも）", () => {
    const p7 = tasks.find((t) => t.pjId === "p7" && t.status !== "完了")!;
    expect(junctionTasks([p7], noOv)).toHaveLength(1);
    expect(junctionTasks([p7], withOv({ [p7.id]: ["kr2"] }))).toHaveLength(0);
    expect(junctionTasks([p7], withOv({ [p7.id]: [] }))).toHaveLength(0);
  });
  it("共有PJの重複は1回に数える", () => {
    const twice = [...tasks, ...tasks];
    expect(junctionTasks(twice, seeded)).toHaveLength(junctionTasks(tasks, seeded).length);
  });
});

describe("KRの組ごとの共有仕事", () => {
  const ctx = withOv({ [A.id]: ["kr1", "kr2"], [B.id]: ["kr1", "kr3"] });
  const period = tasks;
  it("KR1は、KR2と共有する仕事とKR3と共有する仕事を別々に持つ", () => {
    const s = sharedWork(period, "kr1", ctx, krIds);
    expect(s.map((x) => x.krId)).toEqual(["kr2", "kr3"]);
    expect(s[0].tasks.map((t) => t.id)).toContain(A.id);
    expect(s[0].tasks.map((t) => t.id)).not.toContain(B.id);
    expect(s[1].tasks.map((t) => t.id)).toContain(B.id);
    expect(s[1].tasks.map((t) => t.id)).not.toContain(A.id);
  });
  it("共有している相手のKRだけ出る。共有が無ければ空（欄ごと出さない）", () => {
    const only = withOv({ [A.id]: ["kr1", "kr2"] });
    const none = tasks.filter((t) => t.pjId !== "p7" && t.id !== A.id);
    expect(sharedWork(none, "kr1", noOv, krIds)).toEqual([]);
    expect(sharedWork(none, "kr3", only, krIds)).toEqual([]);
    expect(sharedWork([A], "kr2", only, krIds).map((x) => x.krId)).toEqual(["kr1"]);
  });
});

describe("件数の数え方：複数KRの仕事は各KRに1回ずつ、合計では1回", () => {
  const pick = { ctx: withOv({ [A.id]: ["kr1", "kr2"] }), ownerId: "m2", periodStart: PERIOD_START };
  it("各KRの帯・仕事の件数には1回ずつ入り、PJ・O・全体の合計は1回", () => {
    const before = flowCounts({ tasks, ctx: noOv, ownerId: "m2", scope: "team", periodStart: PERIOD_START });
    const after = flowCounts({ tasks, ...pick, scope: "team" });
    const e1 = after.edges.find((e) => e.pjId === "p3" && e.krId === "kr1")!;
    const e2 = after.edges.find((e) => e.pjId === "p3" && e.krId === "kr2")!;
    expect(e1.taskIds).toContain(A.id);
    expect(e2.taskIds).toContain(A.id);
    expect(after.linkedByPj.p3.filter((t) => t.id === A.id)).toHaveLength(1);
    expect(after.linkedByPj.p3).toHaveLength(before.linkedByPj.p3.length);
    const lay = layoutFlow({ counts: after, krIds, personalIds: [], expanded: [], showLoose: false, tf: tfInputOf(noOv, true) });
    const lay0 = layoutFlow({ counts: before, krIds, personalIds: [], expanded: [], showLoose: false, tf: tfInputOf(noOv, true) });
    expect(lay.o.done + lay.o.open).toBe(lay0.o.done + lay0.o.open);
    const sumKr = lay.krNodes.reduce((s, k) => s + k.done + k.open, 0);
    const sumKr0 = lay0.krNodes.reduce((s, k) => s + k.done + k.open, 0);
    expect(sumKr).toBe(sumKr0 + 1);
    const p3 = lay.pjNodes.find((n) => n.pjId === "p3")!;
    const p30 = lay0.pjNodes.find((n) => n.pjId === "p3")!;
    expect(p3.done + p3.open).toBe(p30.done + p30.open);
  });
  it("帯の割合の合計が保たれる（各KRに流れ込む帯の太さの合計は決まった太さのまま）", () => {
    const c = flowCounts({ tasks, ctx: seeded, ownerId: "m2", scope: "team", periodStart: PERIOD_START });
    const lay = layoutFlow({ counts: c, krIds, personalIds: [], expanded: [], showLoose: false, tf: tfInputOf(noOv, true) });
    for (const k of krIds) {
      const sum = lay.tfKr.filter((r) => r.toId === k).reduce((s, r) => s + r.width, 0);
      expect(sum).toBeCloseTo(KR_BAND, 5);
    }
    expect(junctionIdsOf(c, seeded).size).toBe(junctionTasks(c.linkedByPj ? Object.values(c.linkedByPj).flat() : [], seeded).length);
  });
  it("自分の表示では、本人の結節点だけを数える", () => {
    const self = flowCounts({ tasks, ctx: seeded, ownerId: "m3", scope: "self", periodStart: PERIOD_START });
    const ids = junctionIdsOf(self, seeded);
    expect(ids.has(C.id)).toBe(true);
    expect(ids.has(A.id)).toBe(false);
    for (const id of ids) expect(tasks.find((t) => t.id === id)!.assigneeId).toBe("m3");
  });
});

describe("積み上がり・期のまとめ・完了時のつながりは、KRの集合で動く", () => {
  const done = tasks.find((t) => t.assigneeId === "m2" && t.status === "完了" && t.updated >= "2026-10-21" && t.updated <= "2026-11-03")!;
  it("積み上がり：各KRの累計に入り、全体の累計では1回", () => {
    const ctx = withOv({ [done.id]: ["kr1", "kr2", "kr3"] });
    const b0 = buildup(tasks, "m2", krIds, PERIOD_START, TODAY, noOv);
    const b = buildup(tasks, "m2", krIds, PERIOD_START, TODAY, ctx);
    const last = b.weeks.length - 1;
    for (const k of krIds) expect(b.cumulative[k][last]).toBeGreaterThanOrEqual(b0.cumulative[k][last]);
    expect(b.total[last]).toBe(b0.total[last]);
    expect(b.cumulative.kr2[last]).toBe(b0.cumulative.kr2[last] + (krIdsOfTask(done, noOv).includes("kr2") ? 0 : 1));
  });
  it("期のまとめ：選んだ各KRの下に1回ずつ載り、合計は1回。「どう役立つか」はそのKRにだけ付く", () => {
    const ctx = withOv({ [done.id]: ["kr1", "kr3"] });
    const how = { [howKey(done.id, "kr3")]: "手作業を自動化して、時間を減らす" };
    const text = buildSummaryText({ period: "p", owner: "o", krs: okrItems.filter((i) => i.kind === "kr"), tasks, memberId: "m2", start: PERIOD_START, today: TODAY, ctx, how });
    const lines = text.split("\n").filter((l) => l.includes(done.title));
    expect(lines).toHaveLength(2);
    expect(lines.filter((l) => l.includes("（手作業を自動化して、時間を減らす）"))).toHaveLength(1);
    const total = Number(/合計：(\d+)件/.exec(text)![1]);
    const base = Number(/合計：(\d+)件/.exec(buildSummaryText({ period: "p", owner: "o", krs: okrItems.filter((i) => i.kind === "kr"), tasks, memberId: "m2", start: PERIOD_START, today: TODAY, ctx: noOv, how: {} }))![1]);
    expect(total).toBe(base);
  });
  it("完了した仕事のつながり：選んだ集合が完了時の記録より優先され、動きの間の集計にも各KRで入る", () => {
    const ctx = withOv({ [done.id]: ["kr2", "kr3"] });
    expect(krIdsOfTask(done, ctx)).toEqual(["kr2", "kr3"]);
    expect(tasksOfKr([done], "kr2", ctx)).toHaveLength(1);
    expect(tasksOfKr([done], "kr3", ctx)).toHaveLength(1);
    expect(tasksOfKr([done], "kr1", ctx)).toHaveLength(0);
    for (const k of ["kr2", "kr3"]) expect(tasksDoneBetween([done], "m2", k, "2026-10-20", "2026-11-03", ctx)).toHaveLength(1);
  });
});

describe("個人OKR→グループKRは多対多", () => {
  it("1つの個人OKRから複数のKRへ、複数の個人OKRから同じKRへつなげられ、解除もできる", () => {
    let s = U.initialUserStates(WEEK_START);
    s = U.toggleLink(s, "m2", "po3", "kr1");
    s = U.toggleLink(s, "m2", "po3", "kr3");
    const links = s.m2.personalLinks;
    expect(links.filter((l) => l.personalId === "po3").map((l) => l.krId).sort()).toEqual(["kr1", "kr2", "kr3"].sort());
    expect(links.filter((l) => l.krId === "kr1").map((l) => l.personalId).sort()).toEqual(["po1", "po3"]);
    s = U.toggleLink(s, "m2", "po3", "kr1");
    expect(s.m2.personalLinks.some((l) => l.personalId === "po3" && l.krId === "kr1")).toBe(false);
    expect(s.m2.personalLinks.some((l) => l.personalId === "po1" && l.krId === "kr1")).toBe(true);
    expect(U.userOf(s, "m3").personalLinks.some((l) => l.personalId === "po3")).toBe(false);
  });
  it("初期データにも多対多の見本がある（1つの個人OKRから複数、複数から同じKR）", () => {
    const l = U.initialUserStates(WEEK_START).m2.personalLinks;
    expect(new Set(l.filter((x) => x.personalId === "po1").map((x) => x.krId)).size).toBeGreaterThanOrEqual(2);
    expect(new Set(l.filter((x) => x.krId === "kr3").map((x) => x.personalId)).size).toBeGreaterThanOrEqual(2);
  });
});

describe("結節点の描画", () => {
  it("初期データ：3人それぞれ1〜2件、3つにまたがる仕事が1件", () => {
    for (const [uid, ov] of Object.entries(overridesInit)) {
      expect(["m1", "m2", "m3"]).toContain(uid);
      expect(Object.keys(ov).length).toBeGreaterThanOrEqual(1);
      expect(Object.keys(ov).length).toBeLessThanOrEqual(2);
    }
    expect(Object.values(overridesInit).flatMap((o) => Object.values(o)).filter((v) => v.length === 3)).toHaveLength(1);
  });
  it("地図の見出しの近くに「結節点 ◯件」の切替ボタン。押していない状態では薄くしない", () => {
    const h = html();
    const n = junctionIdsOf(flowCounts({ tasks, ctx: seeded, ownerId: "m2", scope: "team", periodStart: PERIOD_START }), seeded).size;
    expect(h).toContain(`結節点 ${n}件`);
    expect(h).toMatch(/class="mk-btn mk-btn-sm mk-jbtn"[^>]*aria-pressed="false"/);
    expect(h).not.toContain("is-dim");
    expect(h).toContain("結節点（2つ以上のKRにつながる仕事）");
  });
  it("押すと、結節点の仕事の帯だけが残り、ほかは薄くなる（class の有無）。もう一度押す＝初期状態で戻る", () => {
    const on = html({ junctionOnly: true });
    expect(on).toMatch(/class="mk-btn mk-btn-sm mk-jbtn is-on"[^>]*aria-pressed="true"/);
    expect(on).toContain("is-dim");
    const dimRibbons = on.match(/<g[^>]*class="mk-svgbtn mk-ribbon is-dim"/g) ?? [];
    const plainRibbons = on.match(/<g[^>]*class="mk-svgbtn mk-ribbon"/g) ?? [];
    expect(dimRibbons.length).toBeGreaterThan(0);
    expect(plainRibbons.length).toBeGreaterThan(0);
    expect(html({ junctionOnly: false })).not.toContain("is-dim");
  });
  it("結節点が無いとき、ボタンそのものを出さない（「0件」とは書かない）。強調が指定されていても薄くしない", () => {
    const h = html({ mode: "self", viewerId: "m3", overrides: {}, junctionOnly: true });
    expect(h).not.toContain("mk-jbtn");
    expect(h).not.toContain("結節点 0件");
    expect(h).not.toContain("is-dim");
  });
  it("結節点を含むPJノードに印と件数が出る", () => {
    const h = html();
    expect(h).toMatch(/結節点の仕事\d+件を含みます/);
    expect(h).toMatch(/結節点 \d+<\/text>/);
  });
  it("KRの詳細：ほかのKRとも重なる仕事（担当者名つき）。共有が無いとき欄ごと出ない", () => {
    const h = html({ sel: { type: "kr", id: "kr1" } });
    expect(h).toContain("ほかのKRとも重なる仕事");
    const sec = h.slice(h.indexOf("ほかのKRとも重なる仕事"), h.indexOf("この動きの間にあなたが終えた仕事"));
    expect(sec).toContain(A.title);
    expect(sec).toContain("高橋 彩");
    expect(sec).toContain("と共有している仕事");
    const none = html({ sel: { type: "kr", id: "kr1" }, overrides: {} });
    expect(none).not.toContain("ほかのKRとも重なる仕事");
  });
  it("仕事の詳細：複数つないだら「この仕事は KR1 と KR3 の結節点です」。1つだけなら出ない", () => {
    expect(html({ sel: { type: "task", id: B.id } })).toContain("この仕事は KR1 と KR3 の結節点です");
    expect(html({ sel: { type: "task", id: C.id } })).toContain("この仕事は KR1・KR2・KR3 の結節点です");
    expect(html({ sel: { type: "task", id: titled("提案資料の英語版を作る").id } })).not.toContain("の結節点です");
  });
  it("つなぎ先の選択はチェック式：AIの候補が上、ほかのKRが下。すべてのKRが選べる。もとに戻すボタンがある", () => {
    const h = html({ sel: { type: "task", id: A.id } });
    const sec = h.slice(h.indexOf("つなぎ先を変える（複数選べます）"), h.indexOf("にどう役立つか"));
    expect(sec).toContain('type="checkbox"');
    expect(sec).not.toContain('type="radio"');
    expect((sec.match(/type="checkbox"/g) ?? []).length).toBe(3);
    expect(sec.indexOf("AIの候補")).toBeLessThan(sec.indexOf("ほかのKR"));
    expect(sec).toContain("もとに戻す");
    expect(sec).toMatch(/KR1[^<]*<\/strong>/);
  });
  it("画面の文言に「シナジー」「一緒に進めるとよい」は出さない", () => {
    for (const h of [html(), html({ sel: { type: "kr", id: "kr1" } }), html({ sel: { type: "task", id: C.id } }), html({ junctionOnly: true })]) {
      expect(h).not.toContain("シナジー");
      expect(h).not.toContain("一緒に進めるとよい");
    }
  });
  it("つながらない仕事の提案：候補ごとに採る／見送るが出る", () => {
    const loose = titled("名刺の整理を終える");
    const all = html({ mode: "self", sel: { type: "task", id: loose.id } });
    const h = all.slice(all.indexOf(">AIの提案<"));
    expect((h.match(/>採る</g) ?? []).length).toBe(2);
    expect((h.match(/>見送る</g) ?? []).length).toBe(2);
    expect(h).toContain("ほかのKRにつなぐ（複数選べます）");
  });
});

describe("共有PJとの整合", () => {
  it("結節点の抽出は担当者に関わらず全員に見える（チーム表示に出る）", () => {
    const team = flowCounts({ tasks, ctx: seeded, ownerId: "m2", scope: "team", periodStart: PERIOD_START });
    const ids = junctionIdsOf(team, seeded);
    for (const t of [A, B, C] as Task[]) expect(ids.has(t.id)).toBe(true);
  });
});
