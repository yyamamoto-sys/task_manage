import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import App from "../App";
import { tasks } from "../fixtures";
import type { InitialView } from "../state";
import { KrDots } from "../ui";

const html = (initial?: InitialView) => renderToStaticMarkup(createElement(App, { initial }));
const taskOf = (title: string) => tasks.find((t) => t.title === title)!;

/** 画面の文言に出してはいけない言い方（用語の統一） */
const FORBIDDEN = [/タスク/, /バンド/, /立場では/, /効かせられなかった/, /流れの図/, /目標の取り込み/, /本人にしか見えません/, /アプリ側に合わせる/];

describe("1枚の画面（描画の確認）", () => {
  it("チームのページ：上から O・段の帯・最近の学び・地図・決定事項と宿題。今週ここに力を・振り返りは出ない", () => {
    const h = html();
    const order = ["なぜこのOか", "チームはいま、どの段にいるか", "仕事がどこへ流れているか", "決定事項と宿題"].map((s) => h.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(h).toContain("日々の仕事と OKR をつなぐ地図");
    expect(h).toContain("はじめての人向けの案内");
    expect(h).not.toContain("今週ここに力を");
    expect(h).not.toContain("今週の振り返り");
    expect(h).not.toContain("今週やると選んだ仕事");
  });
  it("わたしのページ：O は1行・「なぜこのOか」は出ない。本人だけの注記→今週ここに力を→今週やる仕事→地図→確かめる→振り返り→積み上げ→期のまとめ", () => {
    const h = html({ mode: "self" });
    expect(h).not.toContain("なぜこのOか");
    expect(h).not.toContain("チームはいま、どの段にいるか");
    expect(h).not.toContain("決定事項と宿題");
    expect(h).toContain("O：</span>地域と企業が一緒に動く「共創の輪」を広げる");
    const order = [
      "O：",
      "ここは本人だけの部分です。ほかの人にも、GMにも見えません。",
      "今週ここに力を",
      "今週やると選んだ仕事",
      "あなたの仕事の地図",
      "成果につながったかもしれない仕事",
      "今週の振り返り",
      "成果につながった仕事の積み上げ",
      "期のまとめ",
    ].map((s) => h.indexOf(s, s === "今週やると選んだ仕事" ? h.indexOf('id="mk-picks-h"') : 0));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it("案内はサイドバーに合わせた言い方（3〜4項目）。資料を読ませる操作は案内に入らず、サイドバーのボタンに「チェックインの後に」と添える。用語に「地図」がある", () => {
    const h = html();
    const nav = h.slice(h.indexOf("はじめての人向けの案内"), h.indexOf("</nav>", h.indexOf("はじめての人向けの案内")));
    const i1 = nav.indexOf("左の「チーム」で全体、「わたし」で自分の仕事を見ます");
    const i2 = nav.indexOf("左の KR を押すと詳細が開きます");
    const i3 = nav.indexOf("地図で見立てを見る");
    expect(i1).toBeGreaterThan(0);
    expect(i2).toBeGreaterThan(i1);
    expect(i3).toBeGreaterThan(i2);
    expect(nav.match(/mk-guide-no/g)?.length).toBeLessThanOrEqual(4);
    expect(nav).toContain("地図</b>：仕事から KR、O へのつながりを示す図");
    expect(nav).toContain("見立て</b>");
    expect(nav).not.toContain("資料を読ませる");
    expect(h).toContain("チェックインの後に");
  });
  it("見ている人の切替はヘッダではなく上部の細い帯にある", () => {
    const h = html();
    const sel = h.indexOf("見ている人");
    expect(sel).toBeGreaterThan(0);
    expect(sel).toBeLessThan(h.indexOf("<header"));
    expect(h.slice(h.indexOf("<header"))).not.toContain("見ている人");
  });
  it("用語がそろっている：O（めざす姿）・AIの見立て・手がかり・段", () => {
    const h = html();
    for (const w of ["O（めざす姿）", "AIの見立て", "手がかり"]) expect(h).toContain(w);
    expect(html({ mode: "self" })).toContain("次の段");
    for (const re of FORBIDDEN) expect(h).not.toMatch(re);
    expect(h).not.toMatch(/>目標</);
  });
  it("地図の帯・ノードに aria-label がある。KR側の端に「完了◯／残り◯」の数字がある", () => {
    const h = html();
    expect(h).toContain("からKR1へ：終えた仕事");
    expect(h).toContain("PJ「パートナー向け提案資料の刷新」");
    expect(h).toMatch(/完了 \d+／残り \d+/);
    expect(h).toContain("濃い＝完了");
    expect(h).toContain("薄い＝残り");
    expect(h).not.toContain("あなたの分");
  });
  it("帯は Tab の停止対象から外れ（tabindex=-1）、ノードは止まる（0）", () => {
    const h = html();
    const ribbons = h.match(/<g[^>]*class="mk-svgbtn mk-ribbon"[^>]*>/g) ?? [];
    expect(ribbons.length).toBeGreaterThan(0);
    for (const r of ribbons) expect(r).toContain('tabindex="-1"');
    const nodes = h.match(/<g[^>]*aria-label="PJ「[^>]*>/g) ?? [];
    expect(nodes.length).toBeGreaterThan(0);
    for (const n of nodes) expect(n).toContain('tabindex="0"');
  });
  it("チーム表示では、つながらない仕事は件数だけ。名前つきの一覧と提案は自分の表示だけ", () => {
    const team = html();
    expect(team).toMatch(/つながらない仕事 \d+件/);
    expect(team).not.toContain("つながらない仕事「");
    expect(team).not.toContain("押すとAIの提案が出ます");
    const self = html({ mode: "self" });
    expect(self).toContain("つながらない仕事「交流会の出し物を考える」");
    expect(self).toContain("つながらない仕事「AI勉強会の資料を読む」");
    expect(self).not.toContain("つながらない仕事「来月の出張の手配をする」");
  });
  it("確定の直後は、見立てが動いたKRの段のカードと地図のKRに増減の札が出る", () => {
    const h = html({ changes: [{ krId: "kr1", text: "＋2" }] });
    expect(h).toContain('class="mk-delta"');
    expect(h).toContain('class="mk-deltatag"');
    expect(h).toContain("＋2");
    expect(html()).not.toContain("mk-delta");
  });
});

describe("本人＝見ている人", () => {
  it("誰に切り替えても、その人の個人OKR・振り返りが出る（他の人の分は出ない）", () => {
    const m2 = html({ mode: "self", viewerId: "m2" });
    expect(m2).toContain("個人OKR（あなただけ）");
    expect(m2).toContain("業務の自動化の腕を上げる");
    expect(m2).toContain("今週の振り返り");
    expect(m2).toContain("期のまとめを出す");
    const m3 = html({ mode: "self", viewerId: "m3" });
    expect(m3).toContain("展示会のフォローを最後までやりきる");
    expect(m3).not.toContain("業務の自動化の腕を上げる");
    expect(m3).toContain("期のまとめを出す");
    const m1 = html({ mode: "self", viewerId: "m1" });
    expect(m1).toContain("AIの活用を社内に広げる");
    expect(m1).toContain("今週の振り返り");
    for (const h of [m2, m3, m1]) {
      for (const re of FORBIDDEN) expect(h).not.toMatch(re);
      expect(h).toContain("ほかの人にも、GMにも見えません");
    }
  });
  it("今週の振り返りは「今週は役立たなかった」の選択肢。今週やると選んだ仕事のその後が出る", () => {
    const h = html({ mode: "self" });
    expect(h).toContain("今週は役立たなかった");
    expect(h).toContain("今週やると選んだ仕事");
    expect(h).toContain("進行中 2件");
    expect(h).not.toContain("終えた 0件");
    const m1 = html({ mode: "self", viewerId: "m1" });
    expect(m1).toContain("まだ選んでいません");
  });
  it("今週ここに力を：次の段への手がかり（まだ／一部の要件）・今週やるの印。遅れは使わない", () => {
    const h = html({ mode: "self" });
    const focus = h.slice(h.indexOf('id="mk-focus-h"'), h.indexOf('id="mk-picks-h"'));
    expect(focus).toContain("次の段（70）への手がかり");
    expect(focus).toContain("新しい進め方が資料にまとまり、他の人も使えること");
    expect(focus).toContain("今週やる ✓");
    expect(focus).toContain('aria-pressed="true"');
    expect(focus).not.toContain("ポイント");
  });
  it("自分の仕事がつながっていないKR（鈴木さんのKR2）は、今週ここに力をに挙げない", () => {
    const h = html({ mode: "self" });
    const focus = h.slice(h.indexOf('id="mk-focus-h"'), h.indexOf('id="mk-picks-h"'));
    expect(focus).not.toContain("KR2");
    expect(focus).not.toContain("この KR につなげられそうなあなたの仕事");
  });
  it("段のカードにも未更新の印が出る", () => {
    const h = html();
    const gauge = h.slice(h.indexOf('class="mk-gauge'), h.indexOf('id="mk-flow-h"'));
    expect(gauge).toContain("未更新");
  });
});

describe("詳細パネルと引き出し", () => {
  it("KRの詳細パネル：Oに近づいた証拠・いまの段・手がかりの数字・出典・つながる仕事。パネルにフォーカスできる", () => {
    const h = html({ sel: { type: "kr", id: "kr2" } });
    expect(h).toContain("このKRにつながる仕事");
    expect(h).toContain("このKRに関わる決定事項と宿題");
    expect(h).toContain("Oに近づいた証拠として見るもの");
    expect(h).toContain("いまの段（AIの見立て）");
    expect(h).toContain("手がかりの数字");
    expect(h).toContain("段の基準を見る");
    expect(h).toContain("学び・気づき");
    expect(h).toContain('aria-label="詳細パネル"');
    expect(h).toContain('tabindex="-1"');
    for (const re of FORBIDDEN) expect(h).not.toMatch(re);
  });
  it("「手がかりの数字の進みは、期の経過より小さいです」は数値のあるKRの詳細だけ。数値の無いKR3には出ない", () => {
    expect(html({ sel: { type: "kr", id: "kr2" } })).toContain("手がかりの数字の進みは、期の経過より小さいです");
    expect(html({ sel: { type: "kr", id: "kr1" } })).toContain("手がかりの数字の進みは、期の経過より小さいです");
    const h3 = html({ sel: { type: "kr", id: "kr3" } });
    expect(h3).not.toContain("期の経過より後ろ");
    expect(h3).not.toContain("手がかりの数字</dt>");
    expect(h3).toContain("70 まで：");
  });
  it("自分の表示でつながらない仕事を開くと、AIの提案が出る。チーム表示では出ない", () => {
    const t = taskOf("交流会の出し物を考える");
    expect(html({ mode: "self", sel: { type: "task", id: t.id } })).toContain(">AIの提案<");
    expect(html({ sel: { type: "task", id: t.id } })).not.toContain(">AIの提案<");
  });
  it("つながっている仕事：自分の仕事なら「つなぎ先を変える」と、つなぎ先のKRごとの「どう役立つか」が出る", () => {
    const t = taskOf("フォルダ構成案を作る");
    const h = html({ sel: { type: "task", id: t.id } });
    expect(h).toContain("つなぎ先を変える");
    expect(h).toContain("KR2にどう役立つか");
    expect(h).toContain("KR3にどう役立つか");
    expect(h).toContain("つなぎ先から外したKRの「どう役立つか」だけが消えます");
  });
  it("引き出しを開くと資料の選択が出る。その回を確定済みの人がいれば表示する", () => {
    expect(html({ drawerOpen: true })).toContain("読ませる資料");
    expect(html({ drawerOpen: true })).not.toContain("確定済みです");
    const h = html({ drawerOpen: true, confirmedBy: { c4: "m1" } });
    expect(h).toContain("この回（11/10(火) 11月第2回チェックイン）は佐藤 美咲さんが確定済みです");
  });
});

describe("決定事項の一覧", () => {
  it("KR欄は色の点に「KR1」などの文字を添える", () => {
    const h = renderToStaticMarkup(createElement(KrDots, { krIds: ["kr1", "kr3"], labeled: true }));
    expect(h).toContain("KR1");
    expect(h).toContain("KR3");
    expect(h).toContain("mk-kdot-labeled");
    expect(renderToStaticMarkup(createElement(KrDots, { krIds: ["kr1"] }))).not.toContain("KR1</span>");
  });
});
