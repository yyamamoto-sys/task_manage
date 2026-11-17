import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import App from "../App";
import { addOutcomeNotes, notesOfResources } from "../confirm";
import { okrItems, pjsInit, PERIOD_START, resources, tasks } from "../fixtures";
import { buildSummaryText, TODAY, type LinkCtx } from "../logic";
import type { InitialView } from "../state";
import type { OutcomeNote } from "../types";
import * as U from "../userState";

const html = (initial?: InitialView) => renderToStaticMarkup(createElement(App, { initial }));
const taskId = (title: string) => tasks.find((t) => t.title === title)!.id;
const deck = resources.find((r) => r.id === "deck")!;
const minutes = resources.find((r) => r.id === "minutes")!;
const allNotes = notesOfResources(resources);
const noteOf = (key: string) => allNotes.find((n) => n.key === key)!;

describe("資料の記述と仕事の結びつき", () => {
  it("固定データ：数値KR 3〜5記述・達成度KR 1〜2記述・関連の仕事が無い記述がある・1記述につき0〜3件", () => {
    const num = allNotes.filter((n) => n.krId !== "kr3");
    const band = allNotes.filter((n) => n.krId === "kr3");
    expect(num.length).toBeGreaterThanOrEqual(3);
    expect(num.length).toBeLessThanOrEqual(5);
    expect(band.length).toBeGreaterThanOrEqual(1);
    expect(band.length).toBeLessThanOrEqual(2);
    expect(allNotes.some((n) => n.links.length === 0)).toBe(true);
    for (const n of allNotes) expect(n.links.length).toBeLessThanOrEqual(3);
  });
  it("資料2件の足し合わせ：同じ出来事は1つにまとまり、出典と関連の仕事は和集合。再確定しても増えない", () => {
    const a = notesOfResources([deck]);
    const both = addOutcomeNotes(a, notesOfResources([minutes]));
    const hokuto = both.filter((n) => n.key === "kr1-hokuto");
    expect(hokuto).toHaveLength(1);
    expect(hokuto[0].sources).toHaveLength(2);
    expect(hokuto[0].links.map((l) => l.taskId).sort()).toEqual([taskId("提案資料の骨子を決める"), taskId("お礼メールの文面を作る"), taskId("デザインの初稿を作る")].sort());
    const again = addOutcomeNotes(both, notesOfResources([deck, minutes]));
    expect(again).toHaveLength(both.length);
    expect(again.find((n) => n.key === "kr1-hokuto")!.links).toHaveLength(3);
    expect(new Set(again.map((n) => n.key)).size).toBe(again.length);
  });
  it("確定すると担当者本人にだけ「未回答」で届く。関連の仕事が無い記述は誰にも届かない", () => {
    const s = U.deliverClaims({}, allNotes, tasks);
    const key = U.claimKey("kr1-minato", taskId("1〜3社目のヒアリングを行う"));
    expect(U.userOf(s, "m3").claims[key]).toBe("pending");
    expect(U.userOf(s, "m2").claims[key]).toBeUndefined();
    expect(U.pendingClaimCount(U.userOf(s, "m3"))).toBeGreaterThan(0);
    const total = Object.values(s).reduce((n, u) => n + Object.keys(u.claims).length, 0);
    expect(total).toBe(allNotes.reduce((n, x) => n + x.links.length, 0));
    expect(U.confirmedLinks(s, allNotes, tasks)).toHaveLength(0);
  });
  it("「そのとおり」で全員に見える。「違う」・未回答は見えない。本人以外は答えられない", () => {
    let s = U.deliverClaims({}, allNotes, tasks);
    const minato = tasks.find((t) => t.title === "1〜3社目のヒアリングを行う")!;
    const quest = tasks.find((t) => t.title === "提案の想定質問集を作る")!;
    s = U.answerClaim(s, "m2", minato, "kr1-minato", "yes");
    expect(U.confirmedLinks(s, allNotes, tasks)).toHaveLength(0);
    s = U.answerClaim(s, "m3", minato, "kr1-minato", "yes");
    s = U.answerClaim(s, "m2", quest, "kr1-minato", "no");
    const c = U.confirmedLinks(s, allNotes, tasks);
    expect(c.map((x) => x.task.id)).toEqual([minato.id]);
  });
  it("同じ資料をもう一度確定しても、答え済みの結びつきは戻らない", () => {
    const t = tasks.find((x) => x.title === "提案資料の骨子を決める")!;
    let s = U.deliverClaims({}, allNotes, tasks);
    s = U.answerClaim(s, "m2", t, "kr1-hokuto", "yes");
    s = U.deliverClaims(s, allNotes, tasks);
    expect(U.userOf(s, "m2").claims[U.claimKey("kr1-hokuto", t.id)]).toBe("yes");
  });
  it("期のまとめに「成果につながった仕事」が入る（確かめたものがあるときだけ）", () => {
    const items = okrItems.filter((i) => i.kind === "kr");
    const ctx: LinkCtx = { pjs: pjsInit, items: okrItems, overrides: {} };
    const base = { period: "p", owner: "o", krs: items, tasks, memberId: "m2", start: PERIOD_START, today: TODAY, ctx, how: {} };
    expect(buildSummaryText(base)).not.toContain("成果につながった仕事");
    const text = buildSummaryText({ ...base, outcomes: [{ title: "提案資料の骨子を決める", krLabel: "KR1", change: "＋1社", excerpt: "北斗産業と提携" }] });
    expect(text).toContain("成果につながった仕事：1件");
    expect(text).toContain("★提案資料の骨子を決める → KR1 ＋1社");
  });
});

const outcomeView = (): InitialView => {
  const hokuto: OutcomeNote = noteOf("kr1-hokuto");
  const k = (title: string) => U.claimKey("kr1-hokuto", taskId(title));
  return {
    outcome: {
      notes: [hokuto],
      claims: {
        m2: { [k("提案資料の骨子を決める")]: "yes", [k("デザインの初稿を作る")]: "no" },
        m1: { [k("お礼メールの文面を作る")]: "pending" },
      },
    },
  };
};

describe("画面：結びつき", () => {
  it("KRの詳細：「そのとおり」の仕事だけが担当者名つきで全員に見える（違う・未回答は見えない）", () => {
    for (const viewerId of ["m3", "m1", "m2"]) {
      const h = html({ ...outcomeView(), viewerId, sel: { type: "kr", id: "kr1" } });
      expect(h).toContain("この成果につながった仕事");
      expect(h).toContain("提案資料の骨子を決める");
      expect(h).toContain("成果の記述：＋1社");
      const sec = h.slice(h.indexOf("この成果につながった仕事"), h.indexOf("このKRにつながる仕事"));
      expect(sec).not.toContain("デザインの初稿を作る");
      expect(sec).not.toContain("お礼メールの文面を作る");
    }
  });
  it("地図の該当の仕事・帯に★が付く。確かめられていなければ付かない", () => {
    const h = html({ ...outcomeView(), mode: "self" });
    expect(h).toContain("成果につながった仕事1件");
    expect(h).toMatch(/★1/);
    expect(html()).not.toMatch(/★1/);
  });
  it("チームのページの知らせと、「わたし」のページに、件数つきで届く。他の人には出ない", () => {
    const m1 = html({ ...outcomeView(), viewerId: "m1", mode: "team" });
    expect(m1).toContain("あなたの仕事が成果につながったかもしれません 1件");
    const m1self = html({ ...outcomeView(), viewerId: "m1", mode: "self" });
    expect(m1self).toContain("成果につながったかもしれない仕事");
    expect(m1self).toContain("そのとおり");
    expect(m1self).toContain("お礼メールの文面を作る");
    const m3 = html({ ...outcomeView(), viewerId: "m3", mode: "self" });
    expect(m3).not.toContain("あなたの仕事が成果につながったかもしれません");
    expect(m3).not.toContain("お礼メールの文面を作る");
  });
  it("期のまとめの元になる積み上がりに「成果につながった仕事」が出る（本人の分）", () => {
    const m2 = html({ ...outcomeView(), mode: "self" });
    expect(m2).toContain("成果につながった仕事（1件）");
    const m3 = html({ ...outcomeView(), viewerId: "m3", mode: "self" });
    expect(m3).toContain("成果につながった仕事</h4>");
    expect(m3).not.toContain("成果につながった仕事（0件）");
  });
});

describe("画面：成果と仕事", () => {
  it("用語：成果・仕事の見出し語、凡例の1行、KRの詳細の対比", () => {
    const h = html({ mode: "team", sel: { type: "kr", id: "kr1" } });
    expect(h).toContain("段の目盛りはAIの見立て（資料の記述から）、帯は仕事（完了・残り）です。仕事を終えても、見立ては資料を読ませるまで動きません");
    expect(h).toContain("手がかり 18社／30社");
    expect(h).toMatch(/仕事 完了 \d+／残り \d+/);
    expect(h).toContain('aria-label="見立てと仕事の対比"');
    expect(h).toContain("いまの段（AIの見立て）");
  });
});

describe("詳細の列は最初から確保する", () => {
  const frame = (h: string) => ({
    wrap: h.match(/<div class="mk-flowwrap[^"]*"[^>]*>/)?.[0],
    map: h.match(/<section class="mk-card mk-flow"[^>]*>/)?.[0],
    svg: h.match(/<svg[^>]*class="mk-flowsvg"[^>]*>/)?.[0],
    col: h.match(/<div class="mk-panelcol"[^>]*>/)?.[0],
  });
  it("選択なし・KR選択・仕事選択で、地図の枠の class・幅指定・SVG の viewBox が同じ", () => {
    const none = frame(html());
    const kr = frame(html({ sel: { type: "kr", id: "kr1" } }));
    const task = frame(html({ sel: { type: "task", id: taskId("提案資料の骨子を決める") } }));
    expect(none.wrap).toBeDefined();
    expect(none.svg).toContain("viewBox");
    expect(none.col).toBeDefined();
    expect(kr).toEqual(none);
    expect(task).toEqual(none);
    expect(none.wrap).not.toContain("has-panel");
  });
  it("何も選んでいないときも列があり、案内が出る（空白ではない）。閉じるボタンは出ない", () => {
    const h = html();
    expect(h).toContain('aria-label="詳細パネル"');
    expect(h).toContain("KR か仕事を押すと、ここに詳しい内容が出ます");
    const aside = h.slice(h.indexOf('aria-label="詳細パネル"'));
    expect(aside.slice(0, aside.indexOf("</aside>"))).not.toContain("詳細パネルを閉じる");
    const sel = html({ sel: { type: "kr", id: "kr1" } });
    expect(sel).not.toContain("KR か仕事を押すと");
    expect(sel).toContain("詳細パネルを閉じる");
  });
});
