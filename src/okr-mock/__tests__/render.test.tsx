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
  it("上から 帯・今週ここに力を・地図・決定事項と宿題。画面ごとのナビは無い", () => {
    const h = html();
    const order = ["チームはどこまで来たか", "今週ここに力を", "仕事がどこへ流れているか", "決定事項と宿題"].map((s) => h.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(h).toContain("日々の仕事と OKR をつなぐ地図");
    expect(h).toContain("はじめての人向けの案内");
  });
  it("3ステップ案内はメンバーの順序。資料を読ませる操作は案内に入らず、ボタンに「チェックインの後に」と添える", () => {
    const h = html();
    const nav = h.slice(h.indexOf("はじめての人向けの案内"), h.indexOf("</nav>", h.indexOf("はじめての人向けの案内")));
    const i1 = nav.indexOf("地図で進みを見る");
    const i2 = nav.indexOf("力を入れるKRを確かめる");
    const i3 = nav.indexOf("今週やる仕事を選ぶ");
    expect(i1).toBeGreaterThan(0);
    expect(i2).toBeGreaterThan(i1);
    expect(i3).toBeGreaterThan(i2);
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
  it("用語がそろっている：O（めざす姿）・目標値・地図・PJ・仕事・達成度（仮の区分）", () => {
    const h = html();
    for (const w of ["O（めざす姿）", "目標値", "達成度（仮の区分）"]) expect(h).toContain(w);
    for (const re of FORBIDDEN) expect(h).not.toMatch(re);
    expect(h).not.toMatch(/>目標</);
  });
  it("地図の帯・ノードに aria-label がある。KR側の端に「完了◯／残り◯」の数字がある", () => {
    const h = html();
    expect(h).toContain("からKR1へ：終えた仕事");
    expect(h).toContain("PJ「パートナー向け提案資料の刷新」");
    expect(h).toMatch(/完了 \d+／残り \d+/);
    expect(h).toContain("濃い＝終えた");
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
  it("確定の直後は、値が動いたKRの輪と地図のKRに増減の札が出る", () => {
    const h = html({ changes: [{ krId: "kr1", text: "＋4社" }] });
    expect(h).toContain('class="mk-delta"');
    expect(h).toContain('class="mk-deltatag"');
    expect(h).toContain("＋4社");
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
  it("今週の振り返りは「今週は届かず」の選択肢。今週やると選んだ仕事のその後が出る", () => {
    const h = html({ mode: "self" });
    expect(h).toContain("今週は届かず");
    expect(h).toContain("今週やると選んだ仕事");
    expect(h).toContain("終えた 0件／進行中 2件／未着手 0件");
    const m1 = html({ mode: "self", viewerId: "m1" });
    expect(m1).toContain("まだ選んでいません");
  });
  it("今週ここに力を：数値の遅れ・達成度の残り段・未更新の印・今週やるの印", () => {
    const h = html();
    expect(h).toMatch(/期の経過より \d+ ポイント遅れ/);
    expect(h).toContain("目標まで2段");
    expect(h).toContain("未更新");
    expect(h).toContain("今週やる ✓");
    expect(h).toContain('aria-pressed="true"');
    expect(h).toContain("あと2段");
  });
  it("自分の仕事が無いKRには、つなげられそうなあなたの仕事（AIの候補）を出す", () => {
    const h = html();
    expect(h).toContain("この KR につなげられそうなあなたの仕事");
    expect(h).not.toContain("このKRにはありません");
  });
  it("輪のゲージにも未更新の印が出る", () => {
    const h = html();
    const gauge = h.slice(h.indexOf('class="mk-gauge'), h.indexOf("今週ここに力を"));
    expect(gauge).toContain("未更新");
  });
});

describe("詳細パネルと引き出し", () => {
  it("KRの詳細パネル：期首値・目標値・出典・つながる仕事。パネルにフォーカスできる", () => {
    const h = html({ sel: { type: "kr", id: "kr2" } });
    expect(h).toContain("このKRにつながる仕事");
    expect(h).toContain("このKRに関わる決定事項と宿題");
    expect(h).toContain("期首値");
    expect(h).toContain("目標値");
    expect(h).toContain('aria-label="詳細パネル"');
    expect(h).toContain('tabindex="-1"');
    for (const re of FORBIDDEN) expect(h).not.toMatch(re);
  });
  it("達成度のKRの詳細は、期の経過と比べないことを書く", () => {
    const h = html({ sel: { type: "kr", id: "kr3" } });
    expect(h).toContain("目標まであと2段");
    expect(h).toContain("期の経過とは比べません");
  });
  it("自分の表示でつながらない仕事を開くと、AIの提案が出る。チーム表示では出ない", () => {
    const t = taskOf("交流会の出し物を考える");
    expect(html({ mode: "self", sel: { type: "task", id: t.id } })).toContain(">AIの提案<");
    expect(html({ sel: { type: "task", id: t.id } })).not.toContain(">AIの提案<");
  });
  it("つながっている仕事：自分の仕事なら「つなぎ先を変える」と、つなぎ先のKRごとの「どう効くか」が出る", () => {
    const t = taskOf("フォルダ構成案を作る");
    const h = html({ sel: { type: "task", id: t.id } });
    expect(h).toContain("つなぎ先を変える");
    expect(h).toContain("KR2にどう効くか");
    expect(h).toContain("KR3にどう効くか");
    expect(h).toContain("つなぎ先を変えると、下で選んだ「どう効くか」は消えます");
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
