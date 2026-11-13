import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import App from "../App";
import { mergeAssessments, mergeLearnings } from "../confirm";
import { assessInit, checkinsInit, krBands, learningsInit, nextCheckin, okrItems, PERIOD_START, pjsInit, resources } from "../fixtures";
import { buildSummaryText, TODAY } from "../logic";
import { MockProvider, type InitialView } from "../state";
import {
  ALL_STEPS,
  clampAssessment,
  crossedStep,
  currentAssessment,
  deltaText,
  effectiveEntries,
  hasStretch,
  learningsOfKr,
  maxStep,
  moveText,
  nextLine,
  nextRequirements,
  nextStep,
  recentLearnings,
  stepBelow,
  stepMove,
  stepsOf,
} from "../steps";
import { CompareTable } from "../parts/CompareTable";
import type { Learning } from "../types";

const html = (initial?: InitialView) => renderToStaticMarkup(createElement(App, { initial }));
const deck = resources.find((r) => r.id === "deck")!;
const minutes = resources.find((r) => r.id === "minutes")!;
const BANNED = /遅れ|未達|達成率|進捗管理|ノルマ|シナジー/;

describe("段の定義と見立ての範囲", () => {
  it("全KRが60から始まり、90・100 は持たないKRがある。基準文が全段にある", () => {
    for (const k of ["kr1", "kr2", "kr3"]) {
      expect(stepsOf(krBands[k])[0]).toBe(60);
      for (const st of stepsOf(krBands[k])) expect((krBands[k][st as 60] ?? "").length).toBeGreaterThan(5);
    }
    expect(stepsOf(krBands.kr1)).toEqual([60, 70, 80, 90, 100]);
    expect(stepsOf(krBands.kr3)).toEqual([60, 70, 80]);
    expect(hasStretch(krBands.kr1)).toBe(true);
    expect(hasStretch(krBands.kr3)).toBe(false);
    expect([...ALL_STEPS]).toEqual([60, 70, 80, 90, 100]);
  });
  it("見立ての値は60未満にならず、最上段を超えない（整数にそろう）", () => {
    expect(clampAssessment(55, krBands.kr1)).toBe(60);
    expect(clampAssessment(-3, krBands.kr1)).toBe(60);
    expect(clampAssessment(66.4, krBands.kr1)).toBe(66);
    expect(clampAssessment(120, krBands.kr1)).toBe(100);
    expect(clampAssessment(95, krBands.kr3)).toBe(80);
    expect(maxStep(krBands.kr2)).toBe(90);
  });
  it("確定のとき、範囲外の見立てもそろえてから入る", () => {
    const wild = { ...deck, assessments: [{ ...deck.assessments[1], assessment: { ...deck.assessments[1].assessment, value: 99 } }] };
    const out = mergeAssessments({ kr3: [] }, [wild], nextCheckin, krBands);
    expect(out.kr3[0].assessment.value).toBe(80);
    const low = { ...deck, assessments: [{ ...deck.assessments[1], assessment: { ...deck.assessments[1].assessment, value: 20 } }] };
    expect(mergeAssessments({}, [low], nextCheckin, krBands).kr3[0].assessment.value).toBe(60);
  });
  it("固定データの見立てはすべて範囲内で、次の段の要件が2〜4個ある（いまの見立て）", () => {
    for (const r of resources) {
      for (const a of r.assessments) {
        expect(a.assessment.value).toBeGreaterThanOrEqual(60);
        expect(a.assessment.value).toBeLessThanOrEqual(maxStep(krBands[a.krId]));
        expect(a.assessment.basis.length).toBeGreaterThanOrEqual(2);
        expect(a.assessment.basis.length).toBeLessThanOrEqual(4);
        for (const b of a.assessment.basis) expect(b.status === "まだ" || b.quote.length > 0).toBe(true);
      }
    }
  });
});

describe("次の段の要件の取り出し", () => {
  const kr1 = currentAssessment(assessInit.kr1)!.cur.assessment;
  it("いま66なら次の段は70。まだ／一部だけを取り出す", () => {
    expect(nextStep(66, krBands.kr1)).toBe(70);
    expect(stepBelow(66, krBands.kr1)).toBe(60);
    const nr = nextRequirements(kr1, krBands.kr1)!;
    expect(nr.step).toBe(70);
    expect(nr.items).toHaveLength(3);
    expect(nr.pending.map((p) => p.status)).toEqual(["一部", "まだ", "一部"]);
  });
  it("ちょうど70なら次は80。最上段にいるときは次が無い", () => {
    expect(nextStep(70, krBands.kr1)).toBe(80);
    expect(nextStep(100, krBands.kr1)).toBeNull();
    expect(nextStep(80, krBands.kr3)).toBeNull();
    expect(nextRequirements({ ...kr1, value: 80 }, krBands.kr3)).toBeNull();
    expect(nextLine({ ...kr1, value: 80 }, krBands.kr3)).toBe("いちばん上の段にいます");
  });
  it("「70 まで：◯◯が確認できれば」の1行になる。要件がそろっていれば別の言い方", () => {
    expect(nextLine(kr1, krBands.kr1)).toBe("70 まで：パートナー候補との接点が継続的に生まれていること、新しい進め方が資料にまとまり、他の人も使えること、紹介をきっかけにした提携が出ていることが確認できれば");
    const all = { ...kr1, basis: kr1.basis.map((b) => ({ ...b, status: "確認できた" as const })) };
    expect(nextLine(all, krBands.kr1)).toBe("70 まで：要件はすべて確認できています");
  });
});

describe("前回からの動き・越えた段", () => {
  it("段の位置の差を事実として出す（色の語は無い）。動いていなければ「変わらず」", () => {
    expect(moveText(3)).toBe("+3");
    expect(moveText(-2)).toBe("−2");
    expect(moveText(0)).toBe("変わらず");
    expect(moveText(null)).toBe("前回なし");
    expect(stepMove(currentAssessment(assessInit.kr1)!)).toBe(2);
    expect(stepMove(currentAssessment(assessInit.kr2)!)).toBe(3);
    expect(deltaText(66, 68)).toBe("＋2");
    expect(deltaText(66, 66)).toBeNull();
  });
  it("確定で上向きに越えた段を返す（最も高いもの）", () => {
    expect(crossedStep(66, 70, krBands.kr1)).toBe(70);
    expect(crossedStep(66, 68, krBands.kr1)).toBeNull();
    expect(crossedStep(62, 83, krBands.kr1)).toBe(80);
    expect(crossedStep(70, 70, krBands.kr1)).toBeNull();
  });
});

describe("資料の確定：見立てと学びが反映される。同じ回の資料を2件確定しても消えない", () => {
  const nextHist = (list: typeof resources) => mergeAssessments(assessInit, list, nextCheckin, krBands);
  it("deck だけ確定：KR1が68、KR3が66。確定前の回の見立ては残る", () => {
    const h = nextHist([deck]);
    expect(currentAssessment(h.kr1)!.cur.assessment.value).toBe(68);
    expect(currentAssessment(h.kr3)!.cur.assessment.value).toBe(66);
    expect(currentAssessment(h.kr1)!.prev!.assessment.value).toBe(66);
    expect(h.kr2).toEqual(assessInit.kr2);
  });
  it("minutes を続けて確定しても、deck の分は消えない（同じ回は値の高い方）", () => {
    const first = mergeAssessments(assessInit, [deck], nextCheckin, krBands);
    const second = mergeAssessments(first, [minutes], nextCheckin, krBands);
    expect(currentAssessment(second.kr1)!.cur.assessment.value).toBe(68);
    expect(currentAssessment(second.kr3)!.cur.assessment.value).toBe(66);
    expect(currentAssessment(second.kr2)!.cur.assessment.value).toBe(70);
    expect(second.kr1.filter((e) => e.checkinId === nextCheckin.id).map((e) => e.resourceId).sort()).toEqual(["deck", "minutes"]);
    expect(effectiveEntries(second.kr1)).toHaveLength(4);
  });
  it("逆の順（minutes → deck）でも同じ結果。同じ資料の確定し直しは入れ替わり、増えない", () => {
    const a = mergeAssessments(mergeAssessments(assessInit, [minutes], nextCheckin, krBands), [deck], nextCheckin, krBands);
    const b = mergeAssessments(mergeAssessments(assessInit, [deck], nextCheckin, krBands), [minutes], nextCheckin, krBands);
    for (const k of ["kr1", "kr2", "kr3"]) expect(currentAssessment(a[k])!.cur.assessment.value).toBe(currentAssessment(b[k])!.cur.assessment.value);
    const again = mergeAssessments(a, [deck], nextCheckin, krBands);
    expect(again.kr1.filter((e) => e.resourceId === "deck")).toHaveLength(1);
  });
  it("元のデータは書き換えない", () => {
    nextHist([deck, minutes]);
    expect(assessInit.kr1.filter((e) => e.checkinId === nextCheckin.id)).toHaveLength(0);
  });
  it("学び：資料ごとに足し合わせ、同じ回の別の資料の分は消えない。確定し直しでも増えない", () => {
    const first = mergeLearnings(learningsInit, [deck], nextCheckin);
    const second = mergeLearnings(first, [minutes], nextCheckin);
    const ofCheckin = second.filter((l) => l.checkinId === nextCheckin.id);
    expect(ofCheckin).toHaveLength(deck.learnings.length + minutes.learnings.length);
    expect(new Set(ofCheckin.map((l) => l.id)).size).toBe(ofCheckin.length);
    expect(second.filter((l) => l.checkinId !== nextCheckin.id)).toHaveLength(learningsInit.length);
    expect(mergeLearnings(second, [deck], nextCheckin)).toHaveLength(second.length);
  });
  it("学び：KRごと・回ごと・新しい順。各回の中は「分かったこと」→「次に試すこと」の順", () => {
    const all = mergeLearnings(learningsInit, [deck, minutes], nextCheckin);
    const groups = learningsOfKr(all, "kr1", [...checkinsInit, nextCheckin]);
    expect(groups.map((g) => g.checkin.id)).toEqual(["c4", "c1"]);
    expect(groups[0].items.map((l) => l.kind)).toEqual(["分かったこと", "分かったこと", "次に試すこと", "次に試すこと"]);
  });
  it("最近の学びは新しい回から最大3件", () => {
    const r = recentLearnings(learningsInit, checkinsInit, 3);
    expect(r).toHaveLength(3);
    expect(r[0].checkinId).toBe("c3");
    expect(recentLearnings([], checkinsInit)).toEqual([]);
    const many: Learning[] = mergeLearnings(learningsInit, [deck, minutes], nextCheckin);
    expect(recentLearnings(many, [...checkinsInit, nextCheckin], 3).every((l) => l.checkinId === "c4")).toBe(true);
  });
});

describe("画面：O・段の目盛り・凡例・学び", () => {
  it("上部に O の文章と「なぜこのO」が出る。O は図より上", () => {
    const h = html();
    expect(h).toContain("地域と企業が一緒に動く「共創の輪」を広げる");
    expect(h).toContain("なぜこのOか");
    expect(h.indexOf("なぜこのOか")).toBeLessThan(h.indexOf("仕事がどこへ流れているか"));
  });
  it("段の凡例の文章は画面のどこにも出ない（KRの詳細の「段の基準を見る」に、KRごとの基準文だけが残る）", () => {
    const h = html();
    for (const s of ["70 に届けば十分な前進です", "60 台は", "悪い状態ではありません", "取り組みによる明確な前進", "周りから見ても成果が明らか", "これまでのやり方を超える", "「背伸びの目標」は、90・100 の段を持つKRに付きます"]) expect(h).not.toContain(s);
    expect(html({ sel: { type: "kr", id: "kr1" } })).toContain("段の基準を見る");
  });
  it("90・100 を持つKR（KR1・KR2）だけに「背伸びの目標」の印", () => {
    const h = html();
    expect(h).toMatch(/KR1 共創パートナー企業を30社にする：AIの見立て[^"]*背伸びの目標/);
    expect(h).toMatch(/KR2 地域拠点の稼働率を80%にする：AIの見立て[^"]*背伸びの目標/);
    expect(h).not.toMatch(/KR3 社内の定型業務を減らす：AIの見立て[^"]*背伸びの目標/);
  });
  it("チームの帯：全体の％は出ない。KRごとの段の目盛りのカードだけ（動いたKRの一覧・凡例・注釈は無い）", () => {
    const h = html();
    const band = h.match(/<section class="mk-card mk-band"[\s\S]*?<\/section>/)![0];
    expect(band).not.toContain("全体の進み");
    expect(band).not.toContain("期の道のり");
    expect((band.match(/mk-stepscale/g) ?? []).length).toBe(3);
    expect(band).toContain("前回から +2");
    for (const s of ["前回から段の位置が動いたKR", "前回から動いたKRはありません", "64 → 66", "mk-bandline", "mk-band-body", "mk-legend", "70 に届けば十分な前進です", "背伸びの目標」は、90・100"]) expect(band).not.toContain(s);
  });
  it("KRの詳細の先頭に「Oに近づいた証拠として見るもの」。次の段の要件と資料の記述が出る", () => {
    const h = html({ sel: { type: "kr", id: "kr1" } });
    const i = h.indexOf("Oに近づいた証拠として見るもの");
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(h.indexOf("いまの段（AIの見立て）"));
    expect(h).toContain("70 の要件");
    expect(h).toContain("資料の記述：「展示会のフォロー先を10社に絞った」");
    expect(h).toContain("資料に記述がありません");
    expect(h).toContain("AIの見立て");
  });
  it("詳細の学びは回の見出しつき・新しい順", () => {
    const h = html({ sel: { type: "kr", id: "kr2" } });
    const sec = h.slice(h.indexOf("学び・気づき（資料から"), h.indexOf("見立てと仕事の対比"));
    expect(sec).toContain("予約の流れが分かりにくいと、問い合わせが増える");
    expect(sec).toContain("10/20(火) 10月第2回チェックイン");
  });
  it("主画面の「最近の学び」は新しい順に最大3件・KRの色の点つき。0件なら枠ごと出ない", () => {
    const h = html();
    const feed = h.slice(h.indexOf('class="mk-card mk-learnfeed"'), h.indexOf("</section>", h.indexOf('class="mk-card mk-learnfeed"')));
    expect((feed.match(/<li>/g) ?? []).length).toBe(3);
    expect(feed.indexOf("手順を書き出すと")).toBeLessThan(feed.indexOf("予約の流れが分かりにくいと"));
    expect(feed).toContain("background:#e0782a");
    expect(feed).not.toContain("予約フォームの文言を現場と一緒に見直す");
    const none = html({ learnings: [] });
    expect(none).not.toContain("最近の学び");
    expect(none).not.toContain("mk-learnfeed");
  });
  it("期のまとめの文面に、見立ての推移と学びが入る（無ければ節ごと出ない）", () => {
    const base = { period: "p", owner: "o", krs: okrItems.filter((i) => i.kind === "kr"), tasks: [], memberId: "m2", start: PERIOD_START, today: TODAY, ctx: { pjs: pjsInit, items: okrItems, overrides: {} }, how: {} };
    expect(buildSummaryText(base)).not.toContain("AIの見立ての推移");
    const text = buildSummaryText({ ...base, trends: [{ krLabel: "KR1", text: "10/6 62 → 10/20 64 → 11/3 66" }], learnings: [{ krLabel: "KR1", kind: "分かったこと", text: "初稿が決め手になる" }] });
    expect(text).toContain("AIの見立ての推移");
    expect(text).toContain("KR1：10/6 62 → 10/20 64 → 11/3 66");
    expect(text).toContain("KR1（分かったこと）初稿が決め手になる");
  });
});

describe("「遅れ」などの語は、詳細を開いていない画面に出ない", () => {
  const views: [string, InitialView][] = [];
  for (const reach of ["all", "pjs", "solo"] as const) for (const viewerId of ["m2", "m3", "m1"]) for (const mode of ["team", "self"] as const) for (const all of [false, true]) views.push([`${reach}/${viewerId}/${mode}/${all ? "all" : "page"}`, { reach, viewerId, mode, flowAll: { [mode]: all } }]);
  it("3つの広がり×3人×チーム／自分。属性・読み上げ文も含めて、禁止語が無い", () => {
    for (const [name, v] of views) {
      const h = html(v);
      expect(h.match(BANNED)?.[0], name).toBeUndefined();
    }
  });
  it("資料を読ませる引き出し・確定直後（増減の札）・仕事の詳細でも出ない。「赤」「警告」の色名も使わない", () => {
    expect(html({ drawerOpen: true }).match(BANNED)).toBeNull();
    expect(html({ changes: [{ krId: "kr1", text: "＋2" }] }).match(BANNED)).toBeNull();
    expect(html({ sel: { type: "task", id: "t1" } }).match(BANNED)).toBeNull();
    expect(html().match(/mk-(fill|stroke|text)-warn|#944d00|#ffb454/)).toBeNull();
  });
  it("対照比較表にも出ない。列は KR｜段の基準｜いま｜前回から", () => {
    const h = renderToStaticMarkup(createElement(MockProvider, null, createElement(CompareTable)));
    expect(h.match(BANNED)).toBeNull();
    const heads = [...h.matchAll(/<th>([^<]*)<\/th>/g)].map((m) => m[1]);
    expect(heads).toEqual(["KR", "段の基準（60／70／80の要約）", "いま", "前回から"]);
    expect(h).toContain("（AIの見立て）");
    expect(h).toContain("+2");
    expect(h).toContain("+3");
    expect(h).not.toMatch(/mk-chip-red|赤/);
  });
  it("詳細の中だけに「手がかりの数字の進みは、期の経過より小さいです」が残る", () => {
    expect(html().includes("期の経過より小さいです")).toBe(false);
    expect(html({ sel: { type: "kr", id: "kr1" } }).includes("手がかりの数字の進みは、期の経過より小さいです")).toBe(true);
  });
});

describe("登録なしのKRでも、段の目盛り・見立て・学びが出る", () => {
  it("一部のPJだけ登録：KR1は仕事の登録なし。地図に段の目盛りと見立て、詳細に見立て・学び", () => {
    const h = html({ reach: "pjs" });
    expect(h).toContain("KR1：仕事の登録なし");
    expect(h).toMatch(/KR1 共創パートナー企業を30社にする：AIの見立て 66/);
    const d = html({ reach: "pjs", sel: { type: "kr", id: "kr1" } });
    expect(d).toContain("いまの段（AIの見立て）");
    expect(d).toContain("mk-stepscale");
    expect(d).toContain("展示会で会った相手は、お礼の連絡が早いほど反応が良い");
    expect(d).toContain("この KR につながる仕事は、アプリに登録されていません。");
  });
  it("1人だけ：登録の無いKRにも段の目盛りが出る", () => {
    const h = html({ reach: "solo", viewerId: "m3" });
    expect((h.match(/mk-stepscale/g) ?? []).length).toBe(3);
  });
});

describe("今週ここに力を：新しい選び方（画面）", () => {
  it("次の段の要件にまだ／一部があり、自分の仕事がつながるKR。文言は「次の段（70）への手がかり」", () => {
    const h = html({ viewerId: "m2", mode: "self" });
    const focus = h.slice(h.indexOf('id="mk-focus-h"'), h.indexOf('id="mk-picks-h"'));
    expect(focus).toContain("次の段（70）への手がかり");
    expect((focus.match(/次の段（70）への手がかり/g) ?? []).length).toBe(2);
    expect(focus).not.toMatch(BANNED);
  });
});
