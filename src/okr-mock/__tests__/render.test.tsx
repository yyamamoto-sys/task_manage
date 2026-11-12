import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import App from "../App";
import type { InitialView } from "../state";

const html = (initial?: InitialView) => renderToStaticMarkup(createElement(App, { initial }));

describe("1枚の画面（描画の確認）", () => {
  it("上から 帯・今週ここに力を・流れの図・決定事項と宿題。画面ごとのナビは無い", () => {
    const h = html();
    const order = ["チームはどこまで来たか", "今週ここに力を", "仕事がどこへ流れているか", "決定事項と宿題"].map((s) => h.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(h).toContain("日々の仕事と OKR をつなぐ地図");
    expect(h).not.toContain("日々の画面の見本");
    expect(h).not.toContain('aria-label="OKRモードの画面"');
    expect(h).toContain("はじめての人向けの案内");
  });
  it("流れの図の帯・ノードに aria-label がある", () => {
    const h = html();
    expect(h).toContain("からKR1へ：終えた仕事");
    expect(h).toContain("PJ「パートナー向け提案資料の刷新」");
    expect(h).toContain("つながらない仕事「年末交流会の日程を決める」");
  });
  it("自分の表示：本人には個人OKRの列と振り返りが出る。他人視点では本人にしか見えない", () => {
    const own = html({ mode: "self" });
    expect(own).toContain("個人OKR（あなただけ）");
    expect(own).toContain("今週の振り返り");
    expect(own).toContain("期のまとめを出す");
    const other = html({ mode: "self", viewerId: "m3" });
    expect(other).toContain("本人にしか見えません");
    expect(other).not.toContain("個人OKR（あなただけ）");
    expect(other).not.toContain("期のまとめを出す");
  });
  it("KRの詳細パネルと仕事の詳細パネルが開く", () => {
    const kr = html({ sel: { type: "kr", id: "kr1" } });
    expect(kr).toContain("このKRにつながる仕事");
    expect(kr).toContain("このKRに関わる決定事項と宿題");
    expect(kr).toContain("表で見る");
    const loose = html({ sel: { type: "task", id: "t59" } });
    expect(loose).toContain("AIの提案");
  });
  it("引き出しを開くと資料の選択が出る", () => {
    expect(html({ drawerOpen: true })).toContain("読ませる資料");
  });
});
