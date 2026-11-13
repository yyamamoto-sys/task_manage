import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import App from "../App";
import { mineLine, mineLineText, mineTaskIds } from "../allPage";
import { flowAllInit, flowViewOf, selectionAfterFlowSwitch, setFlowAllFor, switchPage, visibleTaskIds } from "../nav";
import { flowCounts, layoutFlow, mineSegments } from "../flow";
import { okrItems, PERIOD_START, personalOkrs, pjsInit, REACH_PJ_IDS, tasks, WEEK_START } from "../fixtures";
import { itemsInQuarter, type LinkCtx } from "../logic";
import { registeredTasks } from "../reach";
import type { InitialView } from "../state";
import * as U from "../userState";

const html = (initial?: InitialView) => renderToStaticMarkup(createElement(App, { initial }));
const sidebarOf = (h: string) => h.slice(h.indexOf('<aside class="mk-sidebar'), h.indexOf("</aside>", h.indexOf('<aside class="mk-sidebar')));
const ctx: LinkCtx = { pjs: pjsInit, items: itemsInQuarter(okrItems, "4Q"), overrides: U.mergedOverrides(U.initialUserStates(WEEK_START)) };
const krIds = ["kr1", "kr2", "kr3"];
const allView = (initial: InitialView = {}): InitialView => ({ ...initial, flowAll: { [initial.mode ?? "team"]: true } });
const allHtml = (initial: InitialView = {}) => html(allView(initial));

const layoutFor = (viewerId: string, reach: "all" | "pjs" | "solo" = "all") => {
  const ts = registeredTasks(tasks, reach, viewerId, REACH_PJ_IDS);
  const counts = flowCounts({ tasks: ts, ctx, ownerId: viewerId, scope: "team", periodStart: PERIOD_START });
  const layout = layoutFlow({ counts, krIds, personalIds: [], expanded: [], showLoose: false, mineIds: mineTaskIds(counts, viewerId) });
  return { counts, layout };
};

describe("メニューと最初のページ", () => {
  it("メニューは「チーム・わたし」の2つ。最初は「チーム」が選ばれ、「全て」は無い", () => {
    const s = sidebarOf(html());
    const i = ["チーム", "わたし"].map((w) => s.indexOf(w));
    expect(i.every((x) => x >= 0)).toBe(true);
    expect([...i].sort((a, b) => a - b)).toEqual(i);
    expect(s.match(/aria-current="page"/g)?.length).toBe(1);
    expect(s).toMatch(/aria-current="page"[^>]*>(?:(?!<\/button>).)*チーム/s);
    expect(s).not.toContain("全て");
    expect(s).not.toContain("🗺");
  });
  it("折りたたんでも、ページのボタンは2つだけで「全て」は出ない", () => {
    const s = sidebarOf(html({ collapsed: true }));
    expect(s).toContain('aria-label="チーム"');
    expect(s).toContain('aria-label="わたし（本人だけ）"');
    expect(s).not.toContain('aria-label="全て"');
  });
});

describe("流れの図の切り替え（純関数）", () => {
  it("初期はどのページもそのページの図。ページごとに覚え、他のページには影響しない", () => {
    const f0 = flowAllInit();
    expect(flowViewOf("team", f0)).toBe("team");
    expect(flowViewOf("self", f0)).toBe("self");
    const f1 = setFlowAllFor(f0, "team", true);
    expect(flowViewOf("team", f1)).toBe("all");
    expect(flowViewOf("self", f1)).toBe("self");
    expect(setFlowAllFor(f1, "team", true)).toBe(f1);
    expect(flowViewOf("team", setFlowAllFor(f1, "team", false))).toBe("team");
    expect(switchPage({ mode: "team", sel: { type: "kr", id: "kr1" } }, "self")).toEqual({ mode: "self", sel: null });
  });
  it("選択：KRは残る。仕事は切り替え先の図に出ているときだけ残り、無ければ外れる", () => {
    const ids = new Set(["t1", "t2"]);
    expect(selectionAfterFlowSwitch({ type: "kr", id: "kr9" }, ids)).toEqual({ type: "kr", id: "kr9" });
    expect(selectionAfterFlowSwitch({ type: "task", id: "t1" }, ids)).toEqual({ type: "task", id: "t1" });
    expect(selectionAfterFlowSwitch({ type: "task", id: "zz" }, ids)).toBeNull();
    expect(selectionAfterFlowSwitch(null, ids)).toBeNull();
  });
  it("選べる仕事：わたしの図は自分の仕事（つながらない仕事を含む）、全体の図は人の仕事も含む", () => {
    const own = flowCounts({ tasks, ctx, ownerId: "m2", scope: "self", periodStart: PERIOD_START });
    const team = flowCounts({ tasks, ctx, ownerId: "m2", scope: "team", periodStart: PERIOD_START });
    const mineIds = visibleTaskIds(own, true);
    const teamIds = visibleTaskIds(team, false);
    for (const t of own.loose) expect(mineIds.has(t.id)).toBe(true);
    for (const t of team.loose) expect(teamIds.has(t.id)).toBe(false);
    expect(teamIds.size).toBeGreaterThan(0);
    for (const id of [...mineIds]) if (!own.loose.some((t) => t.id === id)) expect(teamIds.has(id)).toBe(true);
  });
});

describe("流れの図：切り替えボタンと「全体」だけの表示", () => {
  it("チームとわたしの両方に、aria-pressed つきの2択ボタンがある（初期はそのページの図が押された状態）", () => {
    const t = html();
    expect(t).toMatch(/<button[^>]*aria-pressed="true"[^>]*>チーム<\/button><button[^>]*aria-pressed="false"[^>]*>全体<\/button>/);
    const m = html({ mode: "self" });
    expect(m).toMatch(/<button[^>]*aria-pressed="true"[^>]*>わたし<\/button><button[^>]*aria-pressed="false"[^>]*>全体<\/button>/);
    expect(allHtml()).toMatch(/aria-pressed="false"[^>]*>チーム<\/button><button[^>]*aria-pressed="true"[^>]*>全体<\/button>/);
    expect(allHtml({ mode: "self" })).toMatch(/aria-pressed="false"[^>]*>わたし<\/button><button[^>]*aria-pressed="true"[^>]*>全体<\/button>/);
  });
  it("そのページの図では MineLine と「（チームとあなた）」が出ない。「全体」では出る", () => {
    for (const mode of ["team", "self"] as const) {
      const page = html({ mode });
      expect(page).not.toContain("（チームとあなた）");
      expect(page).not.toContain("あなたの仕事は");
      expect(page).not.toContain("mk-mineline");
      const all = allHtml({ mode });
      expect(all).toContain("仕事がどこへ流れているか（チームとあなた）");
      expect(all).toContain("mk-mineline");
      expect(all).toContain("あなたの仕事は");
    }
  });
  it("凡例：そのページの図は完了／残り、「全体」は あなたの分／ほかの人の分", () => {
    for (const mode of ["team", "self"] as const) {
      const page = html({ mode });
      expect(page).toContain("濃い＝完了");
      expect(page).toContain("薄い＝残り");
      expect(page).not.toContain("濃い＝あなたの仕事の分");
      const all = allHtml({ mode });
      expect(all).toContain("濃い＝あなたの仕事の分");
      expect(all).toContain("薄い＝ほかの人の分");
      expect(all).not.toContain("濃い＝完了");
    }
  });
  it("切り替えは片方のページだけに効く。チームを「全体」にしても、わたしの図は元のまま", () => {
    const h = html({ mode: "self", flowAll: { team: true } });
    expect(h).toContain("あなたの仕事の地図");
    expect(h).not.toContain("mk-mineline");
  });
  it("「全体」にしても、開いている詳細と選択中の対象は残る", () => {
    const h = allHtml({ sel: { type: "kr", id: "kr2" } });
    expect(h).toContain("KRの詳細");
    expect(sidebarOf(h).match(/mk-sb-btn mk-sb-kr is-active/g)?.length).toBe(1);
  });
  it("「最近の学び」はチームのページにあり、「全て」の要約カードは無い", () => {
    expect(html()).toContain("最近の学び");
    expect(html()).not.toContain("わたしの要約");
    expect(allHtml()).not.toContain("わたしの要約");
  });
  it("利用の広がり＝1人だけ の「全体」でも、0件・0／0 を出さない", () => {
    const h = allHtml({ reach: "solo", viewerId: "m3" });
    expect(h).toContain("あなたの仕事は");
    expect(h).not.toMatch(/(^|[^\d])0件/);
    expect(h).not.toContain("0／0");
  });
});

describe("帯をあなたの分とほかの人の分に分ける計算", () => {
  it("合計が帯の太さに一致し、あなたの分が上側（offset 0）", () => {
    const segs = mineSegments(3, 10, 40);
    expect(segs.map((s) => s.kind)).toEqual(["mine", "others"]);
    expect(segs.reduce((s, x) => s + x.thickness, 0)).toBeCloseTo(40);
    expect(segs[0].offset).toBe(0);
    expect(segs[0].thickness).toBeCloseTo(12);
  });
  it("あなたの分が0のときは全体が「ほかの人の分」、全部あなたのときは全体が「あなたの分」", () => {
    expect(mineSegments(0, 6, 30)).toEqual([{ kind: "others", count: 6, offset: 0, thickness: 30 }]);
    expect(mineSegments(6, 6, 30)).toEqual([{ kind: "mine", count: 6, offset: 0, thickness: 30 }]);
    expect(mineSegments(0, 0, 30)).toEqual([]);
  });
  it("全ての帯で、区切りの太さの合計が帯の太さと等しく、あなたの件数は全体を超えない", () => {
    const { layout } = layoutFor("m2");
    for (const r of [...layout.pjKr, ...layout.krO]) {
      expect(r.mineSegs).toBeDefined();
      expect(r.mineSegs!.reduce((s, x) => s + x.thickness, 0)).toBeCloseTo(r.width);
      expect(r.mine!).toBeLessThanOrEqual(r.done + r.open);
    }
  });
  it("見ている人を切り替えると、濃い部分が変わる（鈴木と高橋で計算結果が違う）", () => {
    const sig = (id: string) => layoutFor(id).layout.pjKr.map((r) => `${r.id}:${r.mine}`).join(",");
    expect(sig("m2")).not.toBe(sig("m3"));
    expect(layoutFor("m2").layout.pjKr.some((r) => (r.mine ?? 0) > 0)).toBe(true);
    expect(layoutFor("m3").layout.pjKr.some((r) => (r.mine ?? 0) > 0)).toBe(true);
    const a = allHtml({ viewerId: "m2" }).match(/うちあなたの仕事 \d+件/g);
    const b = allHtml({ viewerId: "m3" }).match(/うちあなたの仕事 \d+件/g);
    expect(a).not.toEqual(b);
  });
  it("利用の広がり＝1人だけ のときは、全部の帯があなたの分（全体が濃い）", () => {
    const { layout } = layoutFor("m3", "solo");
    expect(layout.pjKr.length).toBeGreaterThan(0);
    for (const r of [...layout.pjKr, ...layout.krO]) {
      expect(r.mine).toBe(r.done + r.open);
      expect(r.mineSegs!.map((s) => s.kind)).toEqual(["mine"]);
    }
  });
  it("帯の aria-label には、あなたの分があるときだけ「うちあなたの仕事 ◯件」が付く", () => {
    const { layout } = layoutFor("m2");
    const withMine = [...layout.pjKr, ...layout.krO].filter((r) => (r.mine ?? 0) > 0).length;
    const h = allHtml({ viewerId: "m2" });
    expect(h.match(/aria-label="[^"]*うちあなたの仕事 \d+件/g)?.length).toBe(withMine);
    expect(html({ mode: "team" })).not.toContain("うちあなたの仕事");
  });
});

describe("全体の流れの図：見出し・凡例・説明・印", () => {
  it("全体の図：見出し・凡例・図の下の説明が全体用。完了／残りの濃淡の凡例は出ない", () => {
    const h = allHtml();
    expect(h).toContain("仕事がどこへ流れているか（チームとあなた）");
    expect(h).toContain("濃い＝あなたの仕事の分");
    expect(h).toContain("薄い＝ほかの人の分");
    expect(h).not.toContain("濃い＝完了");
    expect(h).toContain("左のあなたの個人OKRとチームのPJから、中央のKR、右のO（めざす姿）へ。濃い部分が、あなたの仕事の分です。");
    expect(h).toMatch(/完了 \d+／残り \d+/);
    expect(h).toContain("成果につながった仕事");
    expect(h).toContain("結節点（2つ以上のKRにつながる仕事）");
  });
  it("チームの図の凡例は従来のまま", () => {
    const h = html({ mode: "team" });
    expect(h).toContain("濃い＝完了");
    expect(h).toContain("薄い＝残り");
    expect(h).not.toContain("あなたの仕事の分");
    expect(h).toContain("仕事がどこへ流れているか<");
  });
  it("個人OKRは見ている本人の分だけが出る。他人の個人OKRは出ない", () => {
    const mine = personalOkrs.filter((p) => p.ownerId === "m2");
    const others = personalOkrs.filter((p) => p.ownerId !== "m2");
    const h = allHtml({ viewerId: "m2" });
    for (const p of mine) expect(h).toContain(`個人OKR「${p.text}」`);
    for (const p of others) expect(h).not.toContain(p.text);
    expect(h).toContain("個人OKR（あなただけ）");
    const h3 = allHtml({ viewerId: "m3" });
    for (const p of mine) expect(h3).not.toContain(p.text);
    expect(h3).toContain("個人OKR「展示会のフォローを最後までやりきる」");
    expect(html({ mode: "team" })).not.toContain("個人OKR（あなただけ）");
  });
});

describe("あなたの分の1行", () => {
  it("件数とKRの並び（KRの並び順・「・」区切り）", () => {
    const counts = flowCounts({ tasks, ctx, ownerId: "m2", scope: "team", periodStart: PERIOD_START });
    const line = mineLine(counts, "m2", krIds, ctx);
    expect(line.total).toBe(Object.values(counts.linkedByPj).flat().length + counts.loose.length);
    expect(line.mine).toBeGreaterThan(0);
    expect(line.mine).toBeLessThan(line.total);
    const text = mineLineText({ total: 12, mine: 4, krs: ["kr1", "kr3"] }, (k) => k.toUpperCase());
    expect(text).toBe("チームの仕事 12件のうち、あなたの仕事は 4件です。KR1・KR3 につながっています。");
    expect(allHtml({ viewerId: "m2" })).toContain(`チームの仕事 ${line.total}件のうち、あなたの仕事は ${line.mine}件です。`);
  });
  it("あなたの仕事が無いときの文。「0件」とは書かない", () => {
    expect(mineLineText({ total: 9, mine: 0, krs: [] }, String)).toBe("あなたの仕事はまだ登録されていません。");
    const counts = flowCounts({ tasks: tasks.filter((t) => t.assigneeId !== "m3"), ctx, ownerId: "m3", scope: "team", periodStart: PERIOD_START });
    expect(mineLine(counts, "m3", krIds, ctx).mine).toBe(0);
    expect(mineLineText({ total: 5, mine: 2, krs: [] }, String)).not.toContain("につながっています");
  });
});
