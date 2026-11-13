import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import App from "../App";
import { mineLine, mineLineText, mineTaskIds, summaryCards } from "../allPage";
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

const layoutFor = (viewerId: string, reach: "all" | "pjs" | "solo" = "all") => {
  const ts = registeredTasks(tasks, reach, viewerId, REACH_PJ_IDS);
  const counts = flowCounts({ tasks: ts, ctx, ownerId: viewerId, scope: "team", periodStart: PERIOD_START });
  const layout = layoutFlow({ counts, krIds, personalIds: [], expanded: [], showLoose: false, mineIds: mineTaskIds(counts, viewerId) });
  return { counts, layout };
};

describe("メニューと最初のページ", () => {
  it("メニューは「全て・チーム・わたし」の順。最初は「全て」が選ばれている", () => {
    const s = sidebarOf(html());
    const i = ["全て", "チーム", "わたし"].map((w) => s.indexOf(w));
    expect(i.every((x) => x >= 0)).toBe(true);
    expect([...i].sort((a, b) => a - b)).toEqual(i);
    expect(s.match(/aria-current="page"/g)?.length).toBe(1);
    expect(s).toMatch(/aria-current="page"[^>]*>(?:(?!<\/button>).)*全て/s);
    expect(s).toContain("🗺");
  });
  it("折りたたんでも、全てのアイコンは 🗺 で読み上げ名は「全て」", () => {
    const s = sidebarOf(html({ collapsed: true }));
    expect(s).toContain("🗺");
    expect(s).toContain('aria-label="全て"');
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
    const a = html({ viewerId: "m2" }).match(/うちあなたの仕事 \d+件/g);
    const b = html({ viewerId: "m3" }).match(/うちあなたの仕事 \d+件/g);
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
    const h = html({ viewerId: "m2" });
    expect(h.match(/aria-label="[^"]*うちあなたの仕事 \d+件/g)?.length).toBe(withMine);
    expect(html({ mode: "team" })).not.toContain("うちあなたの仕事");
  });
});

describe("全ての流れの図：見出し・凡例・説明・印", () => {
  it("見出し・凡例・図の下の説明が全て用。完了／残りの濃淡の凡例は出ない", () => {
    const h = html();
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
    const h = html({ viewerId: "m2" });
    for (const p of mine) expect(h).toContain(`個人OKR「${p.text}」`);
    for (const p of others) expect(h).not.toContain(p.text);
    expect(h).toContain("個人OKR（あなただけ）");
    const h3 = html({ viewerId: "m3" });
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
    expect(html({ viewerId: "m2" })).toContain(`チームの仕事 ${line.total}件のうち、あなたの仕事は ${line.mine}件です。`);
  });
  it("あなたの仕事が無いときの文。「0件」とは書かない", () => {
    expect(mineLineText({ total: 9, mine: 0, krs: [] }, String)).toBe("あなたの仕事はまだ登録されていません。");
    const counts = flowCounts({ tasks: tasks.filter((t) => t.assigneeId !== "m3"), ctx, ownerId: "m3", scope: "team", periodStart: PERIOD_START });
    expect(mineLine(counts, "m3", krIds, ctx).mine).toBe(0);
    expect(mineLineText({ total: 5, mine: 2, krs: [] }, String)).not.toContain("につながっています");
  });
});

describe("わたしの要約", () => {
  it("件数が無い項目はカードごと出さない。3つとも無ければ空", () => {
    expect(summaryCards({ picks: 0, pending: 0, reflectKrs: 0, reflectDone: 0 })).toEqual([]);
    expect(summaryCards({ picks: 2, pending: 0, reflectKrs: 0, reflectDone: 0 }).map((c) => c.key)).toEqual(["picks"]);
    expect(summaryCards({ picks: 0, pending: 1, reflectKrs: 2, reflectDone: 0 }).map((c) => c.key)).toEqual(["claims", "reflect"]);
    const all = summaryCards({ picks: 3, pending: 1, reflectKrs: 2, reflectDone: 2 });
    expect(all.map((c) => `${c.label}:${c.value}`)).toEqual(["今週やる仕事:3件", "確かめる:1件", "今週の振り返り:済み"]);
    expect(summaryCards({ picks: 0, pending: 0, reflectKrs: 2, reflectDone: 1 })[0].value).toBe("まだ");
  });
  it("押すと「わたし」のページの該当箇所へ移る（移動先の見出しにidがある）", () => {
    const anchors = summaryCards({ picks: 1, pending: 1, reflectKrs: 1, reflectDone: 0 }).map((c) => c.anchor);
    const selfHtml = html({ mode: "self" });
    for (const a of anchors) expect(selfHtml).toContain(`id="${a}"`);
  });
  it("全てのページに、見出し「わたしの要約」と「（あなただけ）」が出る。「決定事項と宿題」などは置かない", () => {
    const h = html({ viewerId: "m2" });
    expect(h).toContain("わたしの要約");
    expect(h).toContain("（あなただけ）");
    expect(h).toContain("なぜこのOか");
    expect(h).toContain("チームはいま、どの段にいるか");
    for (const w of ["決定事項と宿題", "今週ここに力を", "振り返りの入力", "期のまとめを出す"]) expect(h).not.toContain(w);
    const order = ["なぜこのOか", "チームはいま、どの段にいるか", "チームの仕事", "仕事がどこへ流れているか（チームとあなた）", "わたしの要約"].map((s) => h.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});
