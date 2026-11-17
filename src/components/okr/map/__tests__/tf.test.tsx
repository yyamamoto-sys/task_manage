import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import App from "../App";
import { mineTaskIds } from "../allPage";
import { flowCounts, KR_BAND, LABEL_GAP, layoutFlow, routeTfIds, tfInputOf, WIDTH, type FlowCounts, type FlowLayout } from "../flow";
import * as F from "../fixtures";
import { okrItems, PERIOD_START, pjsInit, REACH_PJ_IDS, tasks, WEEK_START } from "../fixtures";
import { itemsInQuarter, type LinkCtx } from "../logic";
import { selectionAfterFlowSwitch } from "../nav";
import { registeredTasks } from "../reach";
import type { InitialView } from "../state";
import * as U from "../userState";

const html = (initial?: InitialView) => renderToStaticMarkup(createElement(App, { initial }));
const items4Q = itemsInQuarter(okrItems, "4Q");
const ctx: LinkCtx = { pjs: pjsInit, items: items4Q, overrides: U.mergedOverrides(U.initialUserStates(WEEK_START)) };
const krIds = ["kr1", "kr2", "kr3"];
const tfItems = items4Q.filter((i) => i.kind === "tf");
const tfLabel = (id: string) => okrItems.find((i) => i.id === id)!.label;
const panelOf = (h: string) => h.match(/<aside tabindex="-1" class="mk-card mk-panel[\s\S]*?<\/aside>/)![0];

const build = (opts: { scope?: "team" | "self"; reach?: "all" | "pjs" | "solo"; showEmpty?: boolean; mine?: boolean; personal?: boolean } = {}) => {
  const scope = opts.scope ?? "team";
  const ts = registeredTasks(tasks, opts.reach ?? "all", "m2", REACH_PJ_IDS);
  const counts: FlowCounts = flowCounts({ tasks: ts, ctx, ownerId: "m2", scope, periodStart: PERIOD_START });
  const layout: FlowLayout = layoutFlow({
    counts,
    krIds,
    personalIds: opts.personal ? ["po1"] : [],
    expanded: [],
    showLoose: scope === "self",
    mineIds: opts.mine ? mineTaskIds(counts, "m2") : undefined,
    tf: tfInputOf(ctx, opts.showEmpty ?? scope !== "self"),
  });
  return { counts, layout };
};

describe("データ：TFは1系統（取り込み側の OkrItem）。PJは必ずTFにつながる", () => {
  it("地図用の別のTF定義は無い。どのKRも1つ以上のTFを持つ。TFの呼び名は「TF1-1」形式", () => {
    expect((F as Record<string, unknown>).tfsInit).toBeUndefined();
    for (const k of krIds) expect(tfItems.filter((t) => t.parentId === k).length).toBeGreaterThanOrEqual(1);
    for (const t of tfItems) expect(t.label).toMatch(/^TF\d+-\d+$/);
  });
  it("すべてのPJが1つ以上のTFを持ち、そのTFは実在する。今期のどのTFにも、PJが1つはつながる", () => {
    for (const p of pjsInit) {
      expect(p.tfIds.length).toBeGreaterThanOrEqual(1);
      expect((p as unknown as Record<string, unknown>).tfId).toBeUndefined();
      for (const id of p.tfIds) expect(okrItems.some((i) => i.id === id && i.kind === "tf")).toBe(true);
    }
    for (const t of tfItems) expect(pjsInit.some((p) => p.tfIds.includes(t.id))).toBe(true);
  });
  it("経由するTF：PJがそのKRの下に持つTF（複数なら全部）。持たないときだけ、そのKRの先頭のTFを仮の経由にする", () => {
    const tfs = tfItems.map((t) => ({ id: t.id, krId: t.parentId as string }));
    const map = tfInputOf(ctx, true).pjTfIds;
    expect(routeTfIds("p2", "kr1", tfs, map)).toEqual(["tf11", "tf12"]);
    expect(routeTfIds("p7", "kr2", tfs, map)).toEqual(["tf22"]);
    expect(routeTfIds("p7", "kr3", tfs, map)).toEqual(["tf32"]);
    expect(routeTfIds("p1", "kr3", tfs, map)).toEqual(["tf31"]);
    expect(routeTfIds("p1", "krX", tfs, map)).toEqual([]);
  });
});

describe("layoutFlow：PJとKRを直接つなぐ帯は、どの表示にも1本も無い", () => {
  for (const [name, opts] of [
    ["チーム", {}],
    ["わたし", { scope: "self" as const }],
    ["全体", { mine: true, personal: true }],
    ["利用の広がり＝一部のPJ", { reach: "pjs" as const }],
    ["利用の広がり＝1人だけ", { reach: "solo" as const }],
  ] as const) {
    it(`${name}：PJから出る帯の行き先はすべてTF、KRに入る帯の出どころはすべてTF`, () => {
      const { layout } = build(opts);
      expect(Object.keys(layout)).not.toContain("pjKr");
      const tfIds = new Set(layout.tfNodes.map((n) => n.tfId));
      const pjIds = new Set(layout.pjNodes.map((n) => n.pjId));
      expect(layout.pjTf.length).toBeGreaterThan(0);
      for (const r of layout.pjTf) {
        expect(pjIds.has(r.fromId)).toBe(true);
        expect(tfIds.has(r.toId)).toBe(true);
      }
      for (const r of layout.tfKr) {
        expect(tfIds.has(r.fromId)).toBe(true);
        expect(krIds).toContain(r.toId);
      }
    });
  }
  it("PJごとの出る帯の太さは、そのPJの枠の高さに収まる（まとめた「ほか◯PJ」も同じ）", () => {
    const ts = registeredTasks(tasks, "all", "m2", REACH_PJ_IDS);
    const counts = flowCounts({ tasks: ts, ctx, ownerId: "m2", scope: "team", periodStart: PERIOD_START });
    const layout = layoutFlow({ counts, krIds, personalIds: [], expanded: [], showLoose: false, maxPj: 3, tf: tfInputOf(ctx, true) });
    expect(layout.pjNodes.some((n) => n.pjId === "__other")).toBe(true);
    for (const n of layout.pjNodes) expect(layout.pjTf.filter((r) => r.fromId === n.pjId).reduce((s, r) => s + r.width, 0)).toBeLessThanOrEqual(n.h + 0.001);
  });
});

describe("layoutFlow：TFの列", () => {
  it("列の並びは 個人OKR／PJ／TF／KR／O。TFとKRの間に最低 LABEL_GAP の幅があり、全体の幅（1000）に収まる", () => {
    for (const personal of [false, true]) {
      const { layout } = build({ personal });
      const c = layout.cols;
      expect(layout.width).toBe(WIDTH);
      if (personal) expect(c.pj.x).toBeGreaterThanOrEqual(c.personal.x + c.personal.w);
      expect(c.tf.x).toBeGreaterThan(c.pj.x + c.pj.w);
      expect(c.kr.x - (c.tf.x + c.tf.w)).toBeGreaterThanOrEqual(LABEL_GAP);
      expect(c.o.x).toBeGreaterThan(c.kr.x + c.kr.w);
      expect(c.o.x + c.o.w).toBeLessThanOrEqual(WIDTH);
    }
  });
  it("KR3にもTFの枠と帯がある（TF3-1〜3-3）。TF→KRの帯はKRの枠の左端まで届く", () => {
    const { layout } = build();
    expect(layout.tfNodes.filter((n) => n.krId === "kr3").map((n) => n.tfId)).toEqual(["tf31", "tf32", "tf33"]);
    expect(layout.tfKr.some((r) => r.toId === "kr3")).toBe(true);
    for (const r of layout.tfKr) expect(r.tx).toBe(layout.krNodes.find((k) => k.krId === r.toId)!.x);
  });
  it("PJが複数のKRにつながるとき、それぞれのKRのTFへつなぐ（p7＝TF3-2経由でKR3、TF2-2経由でKR2）", () => {
    const { layout } = build();
    const ids = layout.pjTf.map((r) => r.id);
    expect(ids).toContain("p7>tf32");
    expect(ids).toContain("p7>tf22");
  });
  it("同じKRの下に複数のTFを持つPJは、その各TFへ帯を出す（p2＝TF1-1とTF1-2）。KRの件数は重ね数えない", () => {
    const { layout, counts } = build();
    const ids = layout.pjTf.map((r) => r.id);
    expect(ids).toContain("p2>tf11");
    expect(ids).toContain("p2>tf12");
    const kr1 = layout.krNodes.find((k) => k.krId === "kr1")!;
    const e = counts.edges.filter((x) => x.krId === "kr1");
    expect(kr1.done).toBe(e.reduce((s, x) => s + x.done, 0));
    expect(kr1.open).toBe(e.reduce((s, x) => s + x.open, 0));
  });
  it("KRに入る帯の太さの合計は、どのKRも同じ（KR_BAND）", () => {
    const { layout } = build();
    for (const k of krIds) expect(layout.tfKr.filter((r) => r.toId === k).reduce((s, r) => s + r.width, 0)).toBeCloseTo(KR_BAND, 5);
  });
  it("TFに入る帯（PJ→TF）の合計は、TFから出る帯（TF→KR）の太さと同じ。TFの件数はPJの帯の件数の和", () => {
    const { layout } = build();
    for (const tn of layout.tfNodes.filter((n) => !n.empty)) {
      const out = layout.tfKr.find((r) => r.fromId === tn.tfId)!;
      const inc = layout.pjTf.filter((r) => r.toId === tn.tfId);
      expect(inc.reduce((s, r) => s + r.width, 0)).toBeCloseTo(out.width, 5);
      expect(inc.reduce((s, r) => s + r.done, 0)).toBe(tn.done);
      expect(inc.reduce((s, r) => s + r.open, 0)).toBe(tn.open);
      expect([out.done, out.open]).toEqual([tn.done, tn.open]);
      expect(tn.h).toBeGreaterThanOrEqual(out.width - 0.001);
    }
  });
  it("「全体」：TFの区間の帯にも あなたの分／ほかの人の分 の濃淡が出る（太さの合計は帯の太さと同じ）", () => {
    const { layout } = build({ mine: true });
    expect(layout.pjTf.length).toBeGreaterThan(0);
    for (const r of [...layout.pjTf, ...layout.tfKr]) {
      expect(r.mineSegs).toBeDefined();
      expect(r.mineSegs!.reduce((s, x) => s + x.thickness, 0)).toBeCloseTo(r.width);
      expect(r.mine!).toBeLessThanOrEqual(r.done + r.open);
    }
    expect(layout.tfKr.some((r) => (r.mine ?? 0) > 0)).toBe(true);
    expect(build().layout.tfKr.every((r) => r.mineSegs === undefined)).toBe(true);
  });
  it("登録された仕事の無いTFは、チーム・全体の図では空の枠（empty）。「わたし」の図では出ない", () => {
    const team = build({ reach: "pjs" }).layout;
    const empties = team.tfNodes.filter((n) => n.empty).map((n) => n.tfId);
    expect(empties.length).toBeGreaterThan(0);
    for (const id of empties) expect(team.tfKr.some((r) => r.fromId === id)).toBe(false);
    const self = build({ scope: "self", reach: "pjs" }).layout;
    expect(self.tfNodes.every((n) => !n.empty)).toBe(true);
    expect(self.tfNodes.map((n) => n.tfId)).not.toEqual(team.tfNodes.map((n) => n.tfId));
  });
  it("全員が登録しているとき、空のTFは1つも無い", () => {
    expect(build().layout.tfNodes.filter((n) => n.empty)).toHaveLength(0);
  });
  it("縦の並び：TFの枠は重ならず、帯の始点・終点は枠の中にある", () => {
    const { layout } = build();
    const nodes = [...layout.tfNodes].sort((a, b) => a.y - b.y);
    for (let i = 1; i < nodes.length; i++) expect(nodes[i].y).toBeGreaterThanOrEqual(nodes[i - 1].y + nodes[i - 1].h);
    for (const r of layout.tfKr) {
      const tn = layout.tfNodes.find((n) => n.tfId === r.fromId)!;
      expect(r.sy).toBeGreaterThanOrEqual(tn.y - 0.001);
      expect(r.sy + r.width).toBeLessThanOrEqual(tn.y + tn.h + 0.001);
    }
    for (const r of layout.pjTf) {
      const tn = layout.tfNodes.find((n) => n.tfId === r.toId)!;
      expect(r.ty).toBeGreaterThanOrEqual(tn.y - 0.001);
      expect(r.ty + r.width).toBeLessThanOrEqual(tn.y + tn.h + 0.001);
    }
  });
});

describe("画面：TFの枠・TFの詳細・KRの詳細のTF一覧", () => {
  it("地図にTFの列の見出しと、TFの枠（呼び名＋名前）が出る。KR3にもTFがある。「TFなし」は出ない", () => {
    const h = html();
    expect(h).toContain(">TF</text>");
    for (const t of tfItems) expect(h).toContain(`aria-label="${t.label} ${t.text}（${(t.parentId as string).toUpperCase()}）：`);
    expect(h).not.toContain("TFなし");
    expect(h).not.toContain("TF1-3 ");
    expect(h).toContain("TF3-1からKR3へ：");
    expect(h).toContain("TF2-2からKR2へ：");
  });
  it("PJからKRへ直接つながる帯のラベルは無い（PJの帯の行き先はTFだけ）", () => {
    const h = html();
    const toKr = [...h.matchAll(/aria-label="([^"]*?)から(KR\d)へ：/g)];
    expect(toKr.length).toBeGreaterThan(0);
    for (const m of toKr) expect(m[1]).toMatch(/^TF\d+-\d+$/);
    expect(h).toContain("から" + "TF1-1へ：");
  });
  it("仕事の無いTFは「仕事の登録なし」の点線の枠。「0件」「0／0」は出ない", () => {
    const h = html({ reach: "pjs" });
    expect((h.match(/mk-tf-empty/g) ?? []).length).toBe(4);
    expect(h).toContain("TF1-1 新規開拓の進め方を仕組みにする（KR1）：仕事の登録なし");
    expect(h).not.toMatch(/0件|0／0/);
  });
  it("TFの詳細：名前・属するKR・つながるPJ・仕事の件数・関わる人。AIの見立て（段の値）は出ない", () => {
    const h = html({ sel: { type: "tf", id: "tf22" } });
    const p = panelOf(h);
    expect(p).toContain("TFの詳細");
    expect(p).toContain("TF2-2");
    expect(p).toContain("運営ボランティアを確保する");
    expect(p).toContain("KR2 地域拠点の稼働率を80%にする");
    expect(p).toContain("ボランティア募集キャンペーン");
    expect(p).toContain("社内ナレッジの整理");
    expect(p).not.toContain("既存のお客様ヒアリング");
    expect(p).toMatch(/終えた仕事\d+件、残り\d+件|終えた仕事はまだありません|残りはありません/);
    expect(p).toContain("関わる人");
    for (const s of ["AIの見立て", "いまの段", "段の基準", "mk-stepscale"]) expect(p).not.toContain(s);
  });
  it("仕事の無いTFの詳細：件数・関わる人は出さず、1行だけ（「0件」は出ない）", () => {
    const p = panelOf(html({ reach: "pjs", sel: { type: "tf", id: "tf11" } }));
    expect(p).toContain("TF1-1");
    expect(p).toContain("このTFには、仕事の登録がありません");
    expect(p).not.toContain("関わる人");
    expect(p).not.toMatch(/0件|0／0/);
  });
  it("KRの詳細：そのKRのTFの一覧（押すとTFの詳細へ）。KR3にも出る", () => {
    const p1 = panelOf(html({ sel: { type: "kr", id: "kr1" } }));
    expect(p1).toContain("このKRのTF");
    for (const t of tfItems.filter((x) => x.parentId === "kr1")) expect(p1).toContain(`${t.label} ${t.text}`);
    expect(p1).not.toContain("TF2-1 ");
    const p3 = panelOf(html({ sel: { type: "kr", id: "kr3" } }));
    expect(p3).toContain("このKRのTF");
    for (const t of tfItems.filter((x) => x.parentId === "kr3")) expect(p3).toContain(`${t.label} ${t.text}`);
  });
  it("PJの詳細：TFを複数出せる。つなぎ先はTF経由（KRを直接並べない）・仕事の一覧", () => {
    const p = panelOf(html({ sel: { type: "pj", id: "p5" } }));
    expect(p).toContain("PJの詳細");
    expect(p).toContain("ボランティア募集キャンペーン");
    expect(p).toContain("TF2-2 運営ボランティアを確保する");
    expect(p).toContain("TF2-2→KR2");
    expect(p).toContain("募集媒体を調べる");
    const p7 = panelOf(html({ sel: { type: "pj", id: "p7" } }));
    expect(p7).toContain("TF3-2 社内の情報共有を一本化する");
    expect(p7).toContain("TF2-2 運営ボランティアを確保する");
    expect(p7).toContain("TF3-2→KR3");
    expect(p7).toContain("TF2-2→KR2");
  });
  it("サイドバーのKR一覧は変えない（TFを出さない）", () => {
    const h = html();
    const s = h.slice(h.indexOf('<aside class="mk-sidebar'), h.indexOf("</aside>", h.indexOf('<aside class="mk-sidebar')));
    expect(s).not.toMatch(/TF\d/);
  });
  it("地図の帯の端の文字（完了／残り）が、TFからKRへの帯ごとに出る", () => {
    const h = html();
    const n = (h.match(/mk-halo/g) ?? []).length;
    expect(n).toBe(tfItems.length);
  });
});

describe("切り替えでの選択：TFも、切り替え先の図に出ていれば保つ", () => {
  it("TF・PJは切り替え先の図に出ているときだけ残す。集合を渡さないときは残す", () => {
    const none = new Set<string>();
    expect(selectionAfterFlowSwitch({ type: "tf", id: "tf11" }, none, new Set(["tf11"]))).toEqual({ type: "tf", id: "tf11" });
    expect(selectionAfterFlowSwitch({ type: "tf", id: "tf11" }, none, new Set(["tf22"]))).toBeNull();
    expect(selectionAfterFlowSwitch({ type: "tf", id: "tf11" }, none)).toEqual({ type: "tf", id: "tf11" });
    expect(selectionAfterFlowSwitch({ type: "pj", id: "p1" }, none, new Set(), new Set(["p1"]))).toEqual({ type: "pj", id: "p1" });
    expect(selectionAfterFlowSwitch({ type: "pj", id: "p1" }, none, new Set(), new Set(["p2"]))).toBeNull();
    expect(selectionAfterFlowSwitch({ type: "kr", id: "kr1" }, none, new Set(), new Set())).toEqual({ type: "kr", id: "kr1" });
  });
  it("「わたし」の図に出るTFは、本人の仕事がつながるTFだけ（チームの図のTFの一部）", () => {
    const self = build({ scope: "self" }).layout.tfNodes.map((n) => n.tfId);
    const team = build().layout.tfNodes.map((n) => n.tfId);
    expect(self.length).toBeGreaterThan(0);
    for (const id of self) expect(team).toContain(id);
    expect(self.length).toBeLessThanOrEqual(team.length);
    expect(self.map(tfLabel).every((l) => /^TF\d+-\d+$/.test(l))).toBe(true);
  });
});
