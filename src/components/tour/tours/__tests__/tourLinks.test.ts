// src/components/tour/tours/__tests__/tourLinks.test.ts
//
// お知らせ本文の専用記法 `amp://tour/<id>`（v3.159）と、ディープリンク /?open=tour&id=… の解析。

import { describe, it, expect } from "vitest";
import { attachTourLink, extractTourIds, isValidTourId, stripTourLinks } from "../tourLinks";
import { extractOpenTarget, extractTourId, stripOpenParam } from "../../../../lib/reminder/deepLink";

describe("記法の解析", () => {
  it("本文から id を重複なし・出現順に取り出す", () => {
    expect(extractTourIds("本文\n\namp://tour/feedback-intro")).toEqual(["feedback-intro"]);
    expect(extractTourIds("amp://tour/a-1 と amp://tour/b2 と amp://tour/a-1")).toEqual(["a-1", "b2"]);
    expect(extractTourIds("記法なし")).toEqual([]);
  });

  it("形の合わない id は拾わない（大文字・先頭ハイフン・空）", () => {
    expect(extractTourIds("amp://tour/Feedback")).toEqual([]);
    expect(extractTourIds("amp://tour/-x")).toEqual([]);
    expect(extractTourIds("amp://tour/")).toEqual([]);
    expect(isValidTourId("feedback-intro")).toBe(true);
    expect(isValidTourId("a".repeat(49))).toBe(false);
  });

  it("記法を取り除いた本文を返す（末尾の空行も詰める）。記法が無ければそのまま", () => {
    expect(stripTourLinks("使い方を案内します。\n\namp://tour/feedback-intro")).toBe("使い方を案内します。");
    expect(stripTourLinks("前\namp://tour/x-1\n後")).toBe("前\n\n後");
    expect(stripTourLinks("amp://tour/feedback-intro")).toBe("");
    expect(stripTourLinks("普通の本文")).toBe("普通の本文");
  });

  it("ベルの行のように途中で切れた記法も取り除く", () => {
    expect(stripTourLinks("案内です\n\namp://tour/feedb")).toBe("案内です");
  });

  it("旧画面を想定：記法はただの文字なので、本文に含まれていても壊れない（取り除かなければ文字としてそのまま）", () => {
    const body = "お知らせ\n\namp://tour/feedback-intro";
    expect(body).toContain("amp://tour/feedback-intro");
  });
});

describe("attachTourLink（送信画面の「ツアーを添付」）", () => {
  it("本文の末尾に空行をはさんで足す。空本文なら記法だけ", () => {
    expect(attachTourLink("案内です", "feedback-intro")).toBe("案内です\n\namp://tour/feedback-intro");
    expect(attachTourLink("", "feedback-intro")).toBe("amp://tour/feedback-intro");
  });
  it("未選択（null）・形の合わない id・すでに同じ記法がある場合は変えない", () => {
    expect(attachTourLink("本文", null)).toBe("本文");
    expect(attachTourLink("本文", "Bad Id")).toBe("本文");
    const b = "本文\n\namp://tour/feedback-intro";
    expect(attachTourLink(b, "feedback-intro")).toBe(b);
  });
  it("添付→解析で同じ id が戻る", () => {
    expect(extractTourIds(attachTourLink("本文", "feedback-intro"))).toEqual(["feedback-intro"]);
  });
});

describe("ディープリンク /?open=tour&id=…", () => {
  it("open=tour と id を読む。id の形が合わなければ null", () => {
    expect(extractOpenTarget("?open=tour&id=feedback-intro")).toBe("tour");
    expect(extractTourId("?open=tour&id=feedback-intro")).toBe("feedback-intro");
    expect(extractTourId("?open=tour")).toBeNull();
    expect(extractTourId("?open=tour&id=Bad%20Id")).toBeNull();
    expect(extractTourId("?open=my-tasks&id=feedback-intro")).toBeNull();
  });
  it("読んだらクエリを消す。open=tour のときだけ id も消し、他の用途の id は消さない", () => {
    expect(stripOpenParam("https://x.test/?open=tour&id=feedback-intro&foo=1#h")).toBe("/?foo=1#h");
    expect(stripOpenParam("https://x.test/?open=my-tasks&id=keep")).toBe("/?id=keep");
  });
});
