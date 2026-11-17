// 段階3の画面：AI を使えるとき（本番）と使えないとき（ゲスト）の「資料を読ませる」「O・KRの取り込み」。AI は呼ばない。
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import App from "../App";
import { buildOkrMapCore } from "../adapter";
import type { OkrMapAi } from "../aiClient";
import type { OkrMapData } from "../dataset";
import { emptyRecords } from "../repository";
import type { InitialView } from "../state";
import { source } from "./prodSource";

const dataOf = (over: Partial<OkrMapData> = {}): OkrMapData => {
  const src = source();
  const core = buildOkrMapCore(src);
  const krIds = core.items.filter((i) => i.kind === "kr").map((i) => i.id);
  return { ...core, ...emptyRecords(krIds), nextCheckin: { id: "next", date: src.today, title: "次の回" }, ...over };
};
const ai: OkrMapAi = { readResource: vi.fn(), suggestCandidates: vi.fn(), suggestHow: vi.fn(), readKintone: vi.fn() };
const html = (initial: InitialView, withAi: boolean, data = dataOf()) =>
  renderToStaticMarkup(createElement(App, { data, initial, embedded: true, ai: withAi ? ai : null })).replace(/<[^>]+>/g, " ");

describe("資料を読ませる", () => {
  it("AI を使えるとき：回を選ぶ・資料を加える（複数）・読み取るが出る。読ませた資料が無いときは案内だけ", () => {
    const h = html({ drawerOpen: true }, true);
    expect(h).toContain("1. 回を選ぶ");
    expect(h).toContain("新しい回");
    expect(h).toContain("2. 資料を加えて、AIに読ませる");
    expect(h).toContain("この回に読ませた資料はまだありません");
    expect(h).not.toContain("準備ができしだい");
    const raw = renderToStaticMarkup(createElement(App, { data: dataOf(), initial: { drawerOpen: true }, embedded: true, ai }));
    expect(raw).toMatch(/<input[^>]*type="file"[^>]*multiple/);
  });

  it("未確定の回に読ませた資料があれば、その回を最初に選び、資料の一覧に出す", () => {
    const data = dataOf({
      openCheckins: [{ id: "c-open", date: "2026-11-17", title: "11月第3回" }],
      resources: [{ id: "r1", name: "議事録.txt", kind: "テキスト", checkinId: "c-open", drafts: [], assessments: [], learnings: [], notes: [], decisions: [] }],
    });
    const h = html({ drawerOpen: true }, true, data);
    expect(h).toContain("11月第3回");
    expect(h).toContain("（まだ確定していません）");
    expect(h).toContain("議事録.txt");
    expect(h).toContain("3. 読み取った資料を選ぶ");
  });

  it("AI を使えないとき（ゲスト）：ファイルの入力は出さない", () => {
    const h = html({ drawerOpen: true }, false);
    expect(h).not.toContain("回を選ぶ");
    expect(h).toContain("ログインして使うときに使えます");
  });
});

describe("仕事の詳細の AI の候補・案", () => {
  it("どのKRにもつながらない本人の仕事に、AI の候補を出すボタンがある（ゲストには出ない）", () => {
    const sel = { type: "task" as const, id: "t-personal" };
    expect(html({ mode: "self", sel }, true)).toContain("AIにつなぎ先の候補を出してもらう");
    expect(html({ mode: "self", sel }, false)).not.toContain("AIにつなぎ先の候補を出してもらう");
  });

  it("KRにつながる本人の仕事に「AIに案を出してもらう」がある（案がまだ無いとき・ゲストには出ない）", () => {
    const sel = { type: "task" as const, id: "t-open" };
    expect(html({ mode: "self", sel }, true)).toContain("AIに案を出してもらう");
    expect(html({ mode: "self", sel }, false)).not.toContain("AIに案を出してもらう");
  });
});
