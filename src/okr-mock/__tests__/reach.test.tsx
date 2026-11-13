import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import App from "../App";
import { detectConflicts, mergeDrafts, notesOfResources } from "../confirm";
import { assessInit, checkinsInit, historyInit, nextCheckin, okrItems, PERIOD_START, pjsInit, REACH_PJ_IDS, recordsInit, resources, tasks } from "../fixtures";
import { applyConfirm, buildSummaryText, itemsInQuarter, type LinkCtx } from "../logic";
import { effectiveEntries } from "../steps";
import { addHistory, krRegistration, pjHasRegistration, reachCounts, reachNote, registeredPjIds, registeredTasks, tfRegistration, trendOf, workPhrase, type Reach } from "../reach";
import type { InitialView } from "../state";
import * as U from "../userState";

const items4Q = itemsInQuarter(okrItems, "4Q");
const noOv: LinkCtx = { pjs: pjsInit, items: items4Q, overrides: {} };
const html = (initial?: InitialView) => renderToStaticMarkup(createElement(App, { initial }));
const plain = (h: string) => h.replace(/<[^>]*>/g, "");
const REACHES: Reach[] = ["all", "pjs", "solo"];
const OTHERS_OF_M3 = ["鈴木 健", "佐藤 美咲", "田中 悠", "伊藤 蓮", "渡辺 結"];

const regOf = (reach: Reach, viewer = "m2", ctx: LinkCtx = noOv) => {
  const reg = registeredTasks(tasks, reach, viewer, REACH_PJ_IDS);
  return { reg, kr: (k: string) => krRegistration(k, reg, ctx, PERIOD_START) };
};

describe("登録あり／なしの判定", () => {
  it("利用の広がりごとの、登録された仕事：全員／指定のPJだけ（個人の仕事は含めない）／見ている人の分だけ", () => {
    expect(registeredTasks(tasks, "all", "m2", REACH_PJ_IDS)).toHaveLength(tasks.length);
    const pjs = registeredTasks(tasks, "pjs", "m2", REACH_PJ_IDS);
    expect(pjs.length).toBeGreaterThan(0);
    expect(pjs.every((t) => REACH_PJ_IDS.includes(t.pjId))).toBe(true);
    const solo = registeredTasks(tasks, "solo", "m3", REACH_PJ_IDS);
    expect(solo.length).toBeGreaterThan(0);
    expect(solo.every((t) => t.assigneeId === "m3")).toBe(true);
  });
  it("PJ：今期の仕事が1件でもあれば登録あり。個人の仕事・上期だけの仕事は数えない", () => {
    const set = registeredPjIds(tasks, PERIOD_START);
    for (const id of ["p1", "p2", "p3", "p4", "p5", "p6", "p7"]) expect(set.has(id)).toBe(true);
    expect(set.has("personal")).toBe(false);
    const oldOnly = tasks.filter((t) => t.title === "旧期の提案テンプレを整える");
    expect(registeredPjIds(oldOnly, PERIOD_START).size).toBe(0);
    expect(pjHasRegistration("p4", tasks, PERIOD_START)).toBe(true);
    expect(pjHasRegistration("p4", tasks.filter((t) => t.pjId !== "p4"), PERIOD_START)).toBe(false);
  });
  it("KR：全員が登録＝すべて full。一部のPJだけ＝KR1は登録なし・KR2とKR3は一部", () => {
    const all = regOf("all");
    for (const k of ["kr1", "kr2", "kr3"]) expect(all.kr(k)).toBe("full");
    const pjs = regOf("pjs");
    expect(pjs.kr("kr1")).toBe("none");
    expect(pjs.kr("kr2")).toBe("partial");
    expect(pjs.kr("kr3")).toBe("partial");
  });
  it("KR：そのKRのPJのすべてに登録があれば full（ほかのKRが登録なしでも）", () => {
    const only = tasks.filter((t) => ["p1", "p2", "p3"].includes(t.pjId));
    expect(krRegistration("kr1", only, noOv, PERIOD_START)).toBe("full");
    expect(krRegistration("kr2", only, noOv, PERIOD_START)).toBe("none");
    expect(krRegistration("kr1", only.filter((t) => t.pjId !== "p3"), noOv, PERIOD_START)).toBe("partial");
  });
  it("KR：つなぎ先を選び直した仕事も「つながっている」に数える。つながる仕事が1件も無ければ、PJに登録があっても登録なし", () => {
    const p1 = tasks.filter((t) => t.pjId === "p1");
    const moved: LinkCtx = { ...noOv, overrides: Object.fromEntries(p1.map((t) => [t.id, ["kr3"]])) };
    expect(krRegistration("kr3", p1, moved, PERIOD_START)).toBe("partial");
    expect(krRegistration("kr1", p1, moved, PERIOD_START)).toBe("none");
  });
  it("1人だけ：見ている人の仕事がつながるKRだけ登録あり。仕事が無いKRは登録なし", () => {
    const m3 = regOf("solo", "m3");
    expect(m3.kr("kr1")).toBe("partial");
    const none = registeredTasks(tasks, "solo", "nobody", REACH_PJ_IDS);
    expect(krRegistration("kr1", none, noOv, PERIOD_START)).toBe("none");
  });
  it("TF：つながるPJのうち登録があるのがいくつか。PJが1つも無いTFは登録なし", () => {
    expect(tfRegistration("tf21", tasks, noOv, PERIOD_START)).toBe("full");
    expect(tfRegistration("tf11", tasks.filter((t) => t.pjId === "p1"), noOv, PERIOD_START)).toBe("partial");
    expect(tfRegistration("tf11", tasks.filter((t) => t.pjId === "p4"), noOv, PERIOD_START)).toBe("none");
    expect(tfRegistration("tf33", tasks, noOv, PERIOD_START)).toBe("none");
  });
  it("範囲の注記：分母は今期のTFにつながるPJ、分子は登録のあるPJ。全部に登録があるときは出ない", () => {
    const c = (r: Reach, v = "m2") => reachCounts(regOf(r, v).reg, noOv, PERIOD_START);
    expect(c("all")).toEqual({ registered: 7, total: 7 });
    expect(reachNote(c("all"))).toBeNull();
    expect(c("pjs")).toEqual({ registered: 2, total: 7 });
    expect(reachNote(c("pjs"))).toBe("仕事はアプリに登録された分です（7PJ中2PJ）");
    expect(reachNote(c("solo", "m3"))).toBe("仕事はアプリに登録された分です（7PJ中3PJ）");
  });
  it("件数の言い方：0件とは書かない", () => {
    expect(workPhrase(3, 2)).toBe("終えた仕事3件、残り2件");
    expect(workPhrase(0, 2)).not.toMatch(/(?<![0-9])0件/);
    expect(workPhrase(2, 0)).not.toMatch(/(?<![0-9])0件/);
  });
});

describe("成果の推移", () => {
  it("初期の履歴は、KRの現状・前回と食い違わない", () => {
    for (const [k, r] of Object.entries(recordsInit)) {
      if (!r.hint) {
        expect(historyInit[k]).toBeUndefined();
        continue;
      }
      const h = historyInit[k];
      expect(h[h.length - 1]).toEqual({ date: r.updatedAt, value: r.hint.value });
      expect(h.find((e) => e.date === r.prevAt)?.value).toBe(r.hint.prev);
    }
    for (const [k, r] of Object.entries(recordsInit)) {
      const eff = effectiveEntries(assessInit[k]);
      expect(eff.length).toBeGreaterThan(0);
      expect(eff[eff.length - 1].date).toBe(k === "kr2" ? "2026-10-20" : r.updatedAt);
    }
  });
  it("回ごとの値が並ぶ。資料に出てこなかった回は前の値のまま「未更新」", () => {
    expect(trendOf(historyInit.kr1, checkinsInit).map((p) => [p.value, p.updated])).toEqual([
      [12, true],
      [15, true],
      [18, true],
    ]);
    expect(trendOf(historyInit.kr2, checkinsInit).map((p) => [p.value, p.updated])).toEqual([
      [66, true],
      [71, true],
      [71, false],
    ]);
  });
  it("見立ては60から。同じ値が続いても並ぶ。最初の値より前の回は出さない", () => {
    const pts = (k: string) => trendOf(effectiveEntries(assessInit[k]).map((e) => ({ date: e.date, value: e.assessment.value })), checkinsInit);
    expect(pts("kr3").map((p) => p.value)).toEqual([60, 60, 63]);
    expect(pts("kr2").map((p) => [p.value, p.updated])).toEqual([
      [63, true],
      [66, true],
      [66, false],
    ]);
    expect(trendOf([{ date: "2026-10-20", value: 15 }], checkinsInit).map((p) => p.date)).toEqual(["2026-10-20", "2026-11-03"]);
  });
  it("確定で、その回の値が足される。同じ日の再確定は置き換える", () => {
    const h1 = addHistory(historyInit, ["kr1"], { kr1: 22 }, nextCheckin.date);
    const cks = [...checkinsInit, nextCheckin];
    expect(trendOf(h1.kr1, cks).map((p) => p.value)).toEqual([12, 15, 18, 22]);
    expect(trendOf(h1.kr2, cks).slice(-1)[0]).toMatchObject({ value: 71, updated: false });
    const h2 = addHistory(h1, ["kr1"], { kr1: 21 }, nextCheckin.date);
    expect(h2.kr1.filter((e) => e.date === nextCheckin.date)).toEqual([{ date: nextCheckin.date, value: 21 }]);
    expect(historyInit.kr1).toHaveLength(3);
  });
  it("KRの詳細に「成果の推移」が出る（3つの広がりで同じ）。見立て（下端は60）が主、手がかりの数字は副。未更新の印がある", () => {
    const hs = REACHES.map((reach) => html({ reach, sel: { type: "kr", id: "kr2" } }));
    for (const h of hs) {
      expect(h).toContain("見立ての推移（チェックインの回ごと）");
      expect(h).toContain("見立ての推移（下端は60）：10/6 63 → 10/20 66 → 11/3 66（未更新）");
      expect(h).toContain("手がかりの数字：10/6 66% → 10/20 71% → 11/3 71%（未更新）");
    }
    expect(html({ sel: { type: "kr", id: "kr1" } })).toContain("手がかりの数字：10/6 12社 → 10/20 15社 → 11/3 18社");
    expect(html({ sel: { type: "kr", id: "kr1" } })).toContain("見立ての推移（下端は60）：10/6 62 → 10/20 64 → 11/3 66");
    const h3 = html({ sel: { type: "kr", id: "kr3" } });
    expect(h3).toContain("見立ての推移（下端は60）：10/6 60 → 10/20 60 → 11/3 63");
    expect(h3).not.toContain("手がかりの数字：");
  });
});

describe("決定事項と宿題は回ごとに見返せる", () => {
  it("KRの詳細で、チェックインの回の見出しの下に新しい回から並ぶ", () => {
    const h = html({ sel: { type: "kr", id: "kr1" } });
    const from = h.indexOf("このKRに関わる決定事項と宿題");
    const i3 = h.indexOf("11/3(火) 11月第1回チェックイン", from);
    const i1 = h.indexOf("10/6(火) 10月第1回チェックイン", from);
    expect(i3).toBeGreaterThan(0);
    expect(i1).toBeGreaterThan(i3);
    expect(h.slice(i1)).toContain("展示会のフォロー先を10社に絞る");
    expect(h.slice(i3, i1)).toContain("ヒアリングの4〜6社目を今週中に行う");
  });
});

describe("3つの利用の広がり：地図と詳細", () => {
  it("成果の表示は3状態で同じ（段のカード・地図の段の目盛り・手がかりの行）", () => {
    const hs = REACHES.map((reach) => html({ reach }));
    const band = (h: string) => h.match(/<section class="mk-card mk-band"[\s\S]*?<\/section>/)![0];
    expect(band(hs[1])).toBe(band(hs[0]));
    expect(band(hs[2])).toBe(band(hs[0]));
    for (const h of hs) for (const s of ["手がかり 18社／30社", "手がかり 71%／80%", "KR3 社内の定型業務を減らす：AIの見立て 63"]) expect(h).toContain(s);
  });
  it("全員が登録：注記も「仕事の登録なし」も出ない", () => {
    const h = html({ reach: "all" });
    expect(h).not.toContain("登録された分です");
    expect(h).not.toContain("仕事の登録なし");
    expect(h).not.toContain("登録された分");
    for (const k of ["KR1", "KR2", "KR3"]) expect(h).toContain(`からKR${k.slice(2)}へ：`);
  });
  it("一部のPJだけ：登録の無いKR1は帯と「仕事 完了／残り」が無く、点線の枠で「仕事の登録なし」。成果は出ている。注記は1行", () => {
    const h = html({ reach: "pjs" });
    expect(h).not.toContain("からKR1へ：");
    expect(h).toContain("からKR2へ：");
    expect(h).toContain("からKR3へ：");
    expect((h.match(/class="mk-noreg-box"/g) ?? []).length).toBe(1); // KR1の枠（TFの枠は別の印）
    expect((h.match(/KR1：仕事の登録なし/g) ?? []).length).toBe(1); // 読み上げ用の一文
    expect((h.match(/mk-tf-empty/g) ?? []).length).toBe(3); // 仕事の無いTF（TF1〜TF3）は点線の枠
    expect((h.match(/仕事はアプリに登録された分です（7PJ中2PJ）/g) ?? []).length).toBe(1);
    expect(h).toContain("手がかり 18社／30社");
    expect(h).toContain("KR1 共創パートナー企業を30社にする：AIの見立て 66");
    expect(h).toContain("KR1：仕事の登録なし");
  });
  it("注記は地図の凡例の近く（見出しの下・凡例の1行の前）。利用状況を大きな数字やゲージでは出さない", () => {
    const h = html({ reach: "pjs" });
    expect(h.indexOf("仕事はアプリに登録された分です")).toBeGreaterThan(h.indexOf("mk-legend"));
    expect(h.indexOf("仕事はアプリに登録された分です")).toBeLessThan(h.indexOf("段の目盛りはAIの見立て"));
    expect(h).not.toMatch(/利用率|利用状況/);
  });
  it("登録なしのKRの詳細：対比・仕事の一覧・重なる仕事を出さず、1行だけ", () => {
    const h = html({ reach: "pjs", sel: { type: "kr", id: "kr1" } });
    expect(h).toContain("この KR につながる仕事は、アプリに登録されていません。見立てと学びはチェックイン資料から出ています。");
    expect(h).toContain("いまの段（AIの見立て）");
    expect(h).toContain("展示会で会った相手は、お礼の連絡が早いほど反応が良い");
    expect(h).toContain("mk-stepscale");
    expect(h).not.toContain('aria-label="見立てと仕事の対比"');
    expect(h).not.toContain("このKRにつながる仕事");
    expect(h).not.toContain("ほかのKRとも重なる仕事");
    expect(h).not.toContain("この動きの間にあなたが終えた仕事");
  });
  it("一部だけ登録のKRの詳細：仕事の一覧と対比の見出しに「登録された分」。対比の1行は出さない", () => {
    for (const k of ["kr2", "kr3"]) {
      const h = html({ reach: "pjs", sel: { type: "kr", id: k } });
      expect(h).toContain("見立てと仕事の対比（登録された分）");
      expect(h).toContain("このKRにつながる仕事（登録された分）");
      expect(h).toContain('aria-label="見立てと仕事の対比"');
    }
    const full = html({ reach: "all", sel: { type: "kr", id: "kr2" } });
    expect(full).toContain("見立てと仕事の対比</h4>");
    expect(full).not.toContain("登録された分");
  });
  it("結節点：「0件」とは書かない。一部登録のときは「登録された分」と添える", () => {
    const pjs = html({ reach: "pjs" });
    expect(pjs).not.toContain("結節点 0件");
    expect(pjs).toMatch(/結節点 \d+件（登録された分）/);
    const all = html({ reach: "all" });
    expect(all).toMatch(/結節点 \d+件</);
    expect(all).not.toMatch(/結節点 \d+件（登録された分）/);
    const solo = html({ reach: "solo", viewerId: "m3" });
    expect(solo).toMatch(/結節点 2件（登録された分）/);
    expect(solo).toMatch(/結節点の仕事\d+件（登録された分）を含みます/);
  });
  it("今週ここに力を：登録なしのKRでは未完了の件数を出さない。一部のときは「登録された分」と添える", () => {
    const all = html({ reach: "all", mode: "self" });
    expect(all).toContain("全員で");
    const pjs = html({ reach: "pjs", mode: "self" });
    expect(pjs).not.toContain("全員で");
    for (const reach of ["pjs", "solo"] as const) expect(html({ reach, viewerId: "m3", mode: "self" })).not.toContain("全員で");
  });
});

describe("1人だけが使っている状態", () => {
  const solo = (extra: InitialView = {}) => html({ reach: "solo", viewerId: "m3", ...extra });
  it("自分の仕事だけで地図が成り立つ：自分のPJから帯、登録の無いKRは成果＋「仕事の登録なし」", () => {
    const h = solo({ mode: "self" });
    expect(h).toContain("あなたの仕事の地図");
    expect(h).toContain("からKR1へ：");
    expect(h).toContain("PJ「パートナー向け提案資料の刷新」");
    expect(h).not.toContain("PJ「拠点の予約サイト改修」");
    expect(h).toContain("手がかり 71%／80%");
    expect(h).toContain("KR2 地域拠点の稼働率を80%にする：AIの見立て 66");
  });
  it("他の人の名前・「全員で」の件数が、地図・今週ここに力を・自分の振り返り・KRの詳細（決定事項の前まで）に出ない", () => {
    for (const k of ["kr1", "kr2", "kr3"]) {
      for (const mode of ["team", "self"] as const) {
        const h = solo({ mode, sel: { type: "kr", id: k } });
        const main = h.slice(h.indexOf("<main"));
        const body = main.slice(0, main.indexOf("このKRに関わる決定事項と宿題")) + main.slice(main.indexOf("</aside>"), main.indexOf('aria-labelledby="mk-dec-h"'));
        for (const n of OTHERS_OF_M3) expect(plain(body)).not.toContain(n);
        expect(body).not.toContain("全員で");
      }
    }
  });
  it("期のまとめ：自分の仕事・つなぎ・成果につながった仕事・振り返りだけで文面が欠けない。他人前提の文は入らない", () => {
    const mine = registeredTasks(tasks, "solo", "m3", REACH_PJ_IDS);
    const ctx: LinkCtx = { ...noOv, overrides: U.initialUserStates("2026-11-09").m3.overrides };
    const text = buildSummaryText({
      period: "2026年 下期",
      owner: "高橋 彩",
      krs: okrItems.filter((i) => i.kind === "kr"),
      tasks: mine,
      memberId: "m3",
      start: PERIOD_START,
      today: "2026-11-10",
      ctx,
      how: {},
      outcomes: [{ title: "価格表を最新にする", krLabel: "KR1", change: "＋1社", excerpt: "北斗産業と提携" }],
      reflections: [{ weekStart: "2026-11-02", krLabel: "KR1", effect: "役立った" }],
    });
    expect(text).toContain("KR1 共創パートナー企業を30社にする：");
    expect(text).toContain("成果につながった仕事：1件");
    expect(text).toContain("週の振り返り");
    expect(text).toContain("11/2(月)の週 KR1：役立った");
    expect(text).not.toMatch(/チームでは|全員|ほかの人/);
    for (const n of OTHERS_OF_M3) expect(text).not.toContain(n);
    expect(text).not.toMatch(/(?<![0-9])0件/);
  });
  it("期のまとめ：つながる仕事が無いKRも「0件」とは書かない", () => {
    const text = buildSummaryText({ period: "p", owner: "o", krs: okrItems.filter((i) => i.kind === "kr"), tasks: [], memberId: "m3", start: PERIOD_START, today: "2026-11-10", ctx: noOv, how: {} });
    expect(text).toContain("KR1 共創パートナー企業を30社にする：この期に終えた仕事は、まだつながっていません");
    expect(text).not.toMatch(/(?<![0-9])0件/);
  });
  it("資料の確定が1人で通る：食い違いを選ぶ→値・履歴・結びつきが自分の仕事にだけ届く", () => {
    const conflicts = detectConflicts(resources, recordsInit, nextCheckin.date);
    expect(conflicts.map((c) => c.krId)).toEqual(["kr1"]);
    const drafts = mergeDrafts(resources, conflicts, { kr1: 0 });
    const next = applyConfirm(recordsInit, drafts, {}, [], nextCheckin.date);
    expect(next.kr1.hint?.value).toBe(22);
    const hist = addHistory(historyInit, drafts.map((d) => d.krId), Object.fromEntries(drafts.map((d) => [d.krId, next[d.krId].hint!.value])), nextCheckin.date);
    expect(trendOf(hist.kr1, [...checkinsInit, nextCheckin]).slice(-1)[0]).toMatchObject({ value: 22, updated: true });
    const notes = notesOfResources(resources);
    const delivered = U.deliverClaims({}, notes, tasks);
    const answered = U.answerClaim(delivered, "m3", tasks.find((t) => t.title === "お礼メールの文面を作る")!, "kr1-hokuto", "yes");
    const mineOnly = registeredTasks(tasks, "solo", "m2", REACH_PJ_IDS);
    const links = U.confirmedLinks(delivered, notes, mineOnly);
    expect(links.every((l) => l.task.assigneeId === "m2")).toBe(true);
    expect(U.confirmedLinks(answered, notes, mineOnly)).toHaveLength(0);
  });
  it("資料を読ませる引き出し：「この回は◯◯さんが確定済み」は他人がいるときだけ。1人だけでは出ない", () => {
    const base: InitialView = { drawerOpen: true, confirmedBy: { [nextCheckin.id]: "m1" }, viewerId: "m2" };
    expect(html({ ...base, reach: "all" })).toContain("さんが確定済みです");
    expect(html({ ...base, reach: "pjs" })).toContain("さんが確定済みです");
    expect(html({ ...base, reach: "solo" })).not.toContain("確定済み");
  });
});

describe("どの状態でも、寂しい・責める表示が出ない", () => {
  const FORBIDDEN = [/(?<![0-9])0件/, /0／0/, /データがありません/, /未利用/, /使われていません/, /使っていない/];
  it("3つの広がり×3人×チーム／自分×詳細の有無で、「0件」「0／0」「データがありません」「未利用」が出ない", () => {
    let n = 0;
    for (const reach of REACHES) {
      for (const viewerId of ["m2", "m3", "m1"]) {
        for (const mode of ["team", "self"] as const) {
          for (const sel of [null, { type: "kr" as const, id: "kr1" }, { type: "kr" as const, id: "kr2" }, { type: "kr" as const, id: "kr3" }]) {
            for (const all of [false, true]) {
            const h = html({ reach, viewerId, mode, sel, flowAll: { [mode]: all } });
            const text = plain(h);
            for (const re of FORBIDDEN) {
              const m = re.exec(text);
              expect(m, `${reach}/${viewerId}/${mode}/${all ? "all" : "page"}/${sel?.id ?? "-"}: ${re} ${m ? text.slice(Math.max(0, m.index - 30), m.index + 30) : ""}`).toBeNull();
            }
            n++;
            }
          }
        }
      }
    }
    expect(n).toBe(144);
  });
  it("使っていない人・PJの名前を「未利用」として挙げない（注記は数だけ）", () => {
    for (const reach of ["pjs", "solo"] as const) {
      const h = plain(html({ reach, viewerId: "m3" }));
      expect(h).not.toMatch(/利用していない|登録していない|未登録/);
    }
  });
});
