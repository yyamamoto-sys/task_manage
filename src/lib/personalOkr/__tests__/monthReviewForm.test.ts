import { describe, it, expect } from "vitest";
import { parseEvalPctInput, computeMonthReviewDirty } from "../monthReviewForm";

describe("parseEvalPctInput", () => {
  it("空欄はnull・エラーなし", () => {
    expect(parseEvalPctInput("")).toEqual({ value: null, error: null });
    expect(parseEvalPctInput("   ")).toEqual({ value: null, error: null });
  });
  it("0〜100の数値はそのまま返す（小数可）", () => {
    expect(parseEvalPctInput("80")).toEqual({ value: 80, error: null });
    expect(parseEvalPctInput("0")).toEqual({ value: 0, error: null });
    expect(parseEvalPctInput("100")).toEqual({ value: 100, error: null });
    expect(parseEvalPctInput("62.5")).toEqual({ value: 62.5, error: null });
  });
  it("範囲外はエラー", () => {
    expect(parseEvalPctInput("101").error).toMatch(/0〜100/);
    expect(parseEvalPctInput("-1").error).toMatch(/0〜100/);
  });
  it("数値として解釈できない文字列はエラー", () => {
    expect(parseEvalPctInput("abc").error).toMatch(/数値/);
    expect(parseEvalPctInput("80%").error).toMatch(/数値/);
  });
});

describe("computeMonthReviewDirty", () => {
  const saved = { reviewText: "既存の本文", selfEvalPct: 80, gmEvalPct: 70, gmComment: "既存のコメント" };

  it("全て一致すればdirty=false", () => {
    expect(computeMonthReviewDirty(
      { reviewText: "既存の本文", selfEvalRaw: "80", gmEvalRaw: "70", gmComment: "既存のコメント" },
      saved,
    )).toBe(false);
  });

  it("🔴 文字列⇔数値の往復で誤判定しない（'80'と80は同値）", () => {
    expect(computeMonthReviewDirty(
      { reviewText: "既存の本文", selfEvalRaw: "80", gmEvalRaw: "70", gmComment: "既存のコメント" },
      saved,
    )).toBe(false);
  });

  it("空欄⇔nullも一致扱いになる", () => {
    expect(computeMonthReviewDirty(
      { reviewText: "", selfEvalRaw: "", gmEvalRaw: "", gmComment: "" },
      { reviewText: null, selfEvalPct: null, gmEvalPct: null, gmComment: null },
    )).toBe(false);
  });

  it("本文が変われば dirty=true", () => {
    expect(computeMonthReviewDirty(
      { reviewText: "新しい本文", selfEvalRaw: "80", gmEvalRaw: "70", gmComment: "既存のコメント" },
      saved,
    )).toBe(true);
  });

  it("自己評価%が変われば dirty=true", () => {
    expect(computeMonthReviewDirty(
      { reviewText: "既存の本文", selfEvalRaw: "90", gmEvalRaw: "70", gmComment: "既存のコメント" },
      saved,
    )).toBe(true);
  });

  it("数値入力が無効な間はdirty=true（保存させてエラー表示に導く）", () => {
    expect(computeMonthReviewDirty(
      { reviewText: "既存の本文", selfEvalRaw: "abc", gmEvalRaw: "70", gmComment: "既存のコメント" },
      saved,
    )).toBe(true);
  });
});
