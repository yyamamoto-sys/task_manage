import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import App from "../App";
import { mineTaskIds } from "../allPage";
import { flowCounts, KR_BAND, LABEL_GAP, layoutFlow, WIDTH, type FlowCounts, type FlowLayout } from "../flow";
import { okrItems, PERIOD_START, pjsInit, REACH_PJ_IDS, tasks, tfsInit, WEEK_START } from "../fixtures";
import { itemsInQuarter, type LinkCtx } from "../logic";
import { selectionAfterFlowSwitch } from "../nav";
import { registeredTasks } from "../reach";
import type { InitialView } from "../state";
import * as U from "../userState";

const html = (initial?: InitialView) => renderToStaticMarkup(createElement(App, { initial }));
const ctx: LinkCtx = { pjs: pjsInit, items: itemsInQuarter(okrItems, "4Q"), overrides: U.mergedOverrides(U.initialUserStates(WEEK_START)) };
const krIds = ["kr1", "kr2", "kr3"];
const pjTfId = Object.fromEntries(pjsInit.map((p) => [p.id, p.tfId]));
const panelOf = (h: string) => h.match(/<aside tabindex="-1" class="mk-card mk-panel[\s\S]*?<\/aside>/)![0];

const build = (opts: { scope?: "team" | "self"; reach?: "all" | "pjs" | "solo"; withTf?: boolean; showEmpty?: boolean; mine?: boolean; personal?: boolean } = {}) => {
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
    ...(opts.withTf === false ? {} : { tf: { tfs: tfsInit, pjTfId, showEmpty: opts.showEmpty ?? scope !== "self" } }),
  });
  return { counts, layout };
};

describe("データ：TFはKRに属し、1つのKRだけTFを持たない", () => {
  it("各KRのTFは2〜4個。TFを持たないKRがちょうど1つ。PJの tfId は主たるKRのTFを指す", () => {
    const per = krIds.map((k) => tfsInit.filter((t) => t.krId === k).length);
    expect(per.filter((n) => n === 0)).toHaveLength(1);
    for (const n of per.filter((x) => x > 0)) {
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(4);
    }
    for (const p of pjsInit) if (p.tfId) expect(tfsInit.some((t) => t.id === p.tfId)).toBe(true);
    for (const t of tfsInit) expect(t.short).toMatch(/^TF\d+$/);
  });
});

describe("layoutFlow：TFの列", () => {
  it("列の並びは 個人OKR／PJ／TF／KR／O。KRの手前の文字の場所を食わず、全体の幅（1000）に収まる", () => {
    for (const personal of [false, true]) {
      const { layout } = build({ personal });
      const c = layout.cols;
      expect(layout.width).toBe(WIDTH);
      if (personal) expect(c.pj.x).toBeGreaterThanOrEqual(c.personal.x + c.personal.w);
      expect(c.tf.x).toBeGreaterThan(c.pj.x + c.pj.w);
      expect(c.kr.x - LABEL_GAP).toBeGreaterThan(c.tf.x + c.tf.w);
      expect(c.o.x).toBeGreaterThan(c.kr.x + c.kr.w);
      expect(c.o.x + c.o.w).toBeLessThanOrEqual(WIDTH);
    }
  });
  it("TFを渡さなければ列はできず、従来と同じ（帯はすべてPJ→KR）", () => {
    const { layout } = build({ withTf: false });
    expect(layout.cols.tf.w).toBe(0);
    expect(layout.tfNodes).toHaveLength(0);
    expect(layout.pjTf).toHaveLength(0);
    expect(layout.tfKr).toHaveLength(0);
    expect(layout.pjKr.length).toBeGreaterThan(0);
  });
  it("TFを持たないKR（KR3）のPJは、TFの列を素通りして直接KRへ。KR3にTFの枠も帯も無い", () => {
    const { layout } = build();
    expect(layout.tfNodes.some((n) => n.krId === "kr3")).toBe(false);
    expect(layout.tfKr.some((r) => r.toId === "kr3")).toBe(false);
    const direct = layout.pjKr.filter((r) => r.toId === "kr3").map((r) => r.fromId);
    expect(direct).toEqual(expect.arrayContaining(["p6", "p7"]));
    for (const r of layout.pjKr) expect(r.tx).toBe(layout.krNodes.find((k) => k.krId === r.toId)!.x - LABEL_GAP);
  });
  it("PJが複数KRにつながるとき、TFを通るのは主たるKRだけ。他のKRへは直接つなぐ（p7＝TF5経由でKR2、直接KR3）", () => {
    const { layout } = build();
    expect(layout.pjTf.map((r) => r.id)).toContain("p7>ft5");
    expect(layout.pjKr.map((r) => r.id)).toContain("p7>kr3");
    expect(layout.pjKr.map((r) => r.id)).not.toContain("p7>kr2");
  });
  it("KRに入る帯の太さの合計は、TFを挟んでも今までと同じ（TF経由＋直接）。KRの件数も変わらない", () => {
    const withTf = build().layout;
    const without = build({ withTf: false }).layout;
    for (const k of krIds) {
      const sum = [...withTf.pjKr, ...withTf.tfKr].filter((r) => r.toId === k).reduce((s, r) => s + r.width, 0);
      expect(sum).toBeCloseTo(KR_BAND, 5);
      expect(without.pjKr.filter((r) => r.toId === k).reduce((s, r) => s + r.width, 0)).toBeCloseTo(KR_BAND, 5);
      const a = withTf.krNodes.find((n) => n.krId === k)!;
      const b = without.krNodes.find((n) => n.krId === k)!;
      expect([a.done, a.open]).toEqual([b.done, b.open]);
    }
  });
  it("TFに入る帯（PJ→TF）の合計は、TFから出る帯（TF→KR）の太さと同じ。TFの件数はPJの件数の和", () => {
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
    expect(team.tfNodes.filter((n) => n.empty).map((n) => n.tfId).sort()).toEqual(["ft1", "ft2", "ft3"]);
    expect(team.tfKr.some((r) => r.fromId === "ft1")).toBe(false);
    const self = build({ scope: "self", reach: "pjs" }).layout;
    expect(self.tfNodes.every((n) => !n.empty)).toBe(true);
    expect(self.tfNodes.map((n) => n.tfId)).not.toEqual(team.tfNodes.map((n) => n.tfId));
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
  it("地図にTFの列の見出しと、TFの枠（短い呼び名＋名前）が出る。TFの無いKR3には枠も「TFなし」も出ない", () => {
    const h = html();
    expect(h).toContain(">TF</text>");
    for (const t of tfsInit) expect(h).toContain(`aria-label="${t.short} ${t.name}（${t.krId.toUpperCase()}）：`);
    expect(h).not.toContain("TFなし");
    expect(h).not.toContain("TF6");
    expect(h).toContain("からKR3へ：");
    expect(h).toContain("TF5からKR2へ：");
  });
  it("仕事の無いTFは「仕事の登録なし」の点線の枠。「0件」「0／0」は出ない", () => {
    const h = html({ reach: "pjs" });
    expect((h.match(/mk-tf-empty/g) ?? []).length).toBe(3);
    expect(h).toContain("TF1 新規パートナーの開拓（KR1）：仕事の登録なし");
    expect(h).not.toMatch(/0件|0／0/);
  });
  it("TFの詳細：名前・属するKR・つながるPJ・仕事の件数・関わる人。AIの見立て（段の値）は出ない", () => {
    const h = html({ sel: { type: "tf", id: "ft5" } });
    const p = panelOf(h);
    expect(p).toContain("TFの詳細");
    expect(p).toContain("TF5");
    expect(p).toContain("運営体制の確保");
    expect(p).toContain("KR2 地域拠点の稼働率を80%にする");
    expect(p).toContain("ボランティア募集キャンペーン");
    expect(p).toContain("社内ナレッジの整理");
    expect(p).not.toContain("既存のお客様ヒアリング");
    expect(p).toMatch(/終えた仕事\d+件、残り\d+件|終えた仕事はまだありません|残りはありません/);
    expect(p).toContain("関わる人");
    for (const s of ["AIの見立て", "いまの段", "段の基準", "mk-stepscale"]) expect(p).not.toContain(s);
  });
  it("仕事の無いTFの詳細：件数・関わる人は出さず、1行だけ（「0件」は出ない）", () => {
    const p = panelOf(html({ reach: "pjs", sel: { type: "tf", id: "ft1" } }));
    expect(p).toContain("TF1");
    expect(p).toContain("このTFには、仕事の登録がありません");
    expect(p).not.toContain("関わる人");
    expect(p).not.toMatch(/0件|0／0/);
  });
  it("KRの詳細：そのKRのTFの一覧（押すとTFの詳細へ）。TFを持たないKR3には出ない", () => {
    const p1 = panelOf(html({ sel: { type: "kr", id: "kr1" } }));
    expect(p1).toContain("このKRのTF");
    for (const t of tfsInit.filter((x) => x.krId === "kr1")) expect(p1).toContain(`${t.short} ${t.name}`);
    expect(p1).not.toContain("TF5 ");
    expect(panelOf(html({ sel: { type: "kr", id: "kr3" } }))).not.toContain("このKRのTF");
  });
  it("PJの詳細（TFの詳細のPJから開く）：TF・つなぎ先・仕事の一覧", () => {
    const p = panelOf(html({ sel: { type: "pj", id: "p5" } }));
    expect(p).toContain("PJの詳細");
    expect(p).toContain("ボランティア募集キャンペーン");
    expect(p).toContain("TF5 運営体制の確保");
    expect(p).toContain("募集媒体を調べる");
  });
  it("サイドバーのKR一覧は変えない（TFを出さない）", () => {
    const h = html();
    const s = h.slice(h.indexOf('<aside class="mk-sidebar'), h.indexOf("</aside>", h.indexOf('<aside class="mk-sidebar')));
    expect(s).not.toMatch(/TF\d/);
  });
});

describe("切り替えでの選択：TFも、切り替え先の図に出ていれば保つ", () => {
  it("TF・PJは切り替え先の図に出ているときだけ残す。集合を渡さないときは残す", () => {
    const none = new Set<string>();
    expect(selectionAfterFlowSwitch({ type: "tf", id: "ft1" }, none, new Set(["ft1"]))).toEqual({ type: "tf", id: "ft1" });
    expect(selectionAfterFlowSwitch({ type: "tf", id: "ft1" }, none, new Set(["ft5"]))).toBeNull();
    expect(selectionAfterFlowSwitch({ type: "tf", id: "ft1" }, none)).toEqual({ type: "tf", id: "ft1" });
    expect(selectionAfterFlowSwitch({ type: "pj", id: "p1" }, none, new Set(), new Set(["p1"]))).toEqual({ type: "pj", id: "p1" });
    expect(selectionAfterFlowSwitch({ type: "pj", id: "p1" }, none, new Set(), new Set(["p2"]))).toBeNull();
    expect(selectionAfterFlowSwitch({ type: "kr", id: "kr1" }, none, new Set(), new Set())).toEqual({ type: "kr", id: "kr1" });
  });
  it("「わたし」の図に出るTFは、本人の仕事がつながるTFだけ（チームの図のTFの一部）", () => {
    const self = build({ scope: "self" }).layout.tfNodes.map((n) => n.tfId);
    const team = build().layout.tfNodes.map((n) => n.tfId);
    expect(self.length).toBeGreaterThan(0);
    for (const id of self) expect(team).toContain(id);
    const mine = new Set(tasks.filter((t) => t.assigneeId === "m2").map((t) => t.pjId));
    for (const id of self) expect(pjsInit.some((p) => p.tfId === id && mine.has(p.id))).toBe(true);
  });
});
