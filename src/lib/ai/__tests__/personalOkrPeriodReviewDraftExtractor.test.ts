import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../invokeAI", () => ({
  invokeAI: vi.fn(),
}));

import { invokeAI } from "../invokeAI";
import {
  generatePersonalPeriodReviewDraft,
  validatePersonalOkrPeriodReviewDraftPayload,
} from "../personalOkrPeriodReviewDraftExtractor";

const mockedInvokeAI = vi.mocked(invokeAI);

function aiText(payload: object) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
}

beforeEach(() => {
  mockedInvokeAI.mockReset();
});

const VALID_PAYLOAD = {
  review_text: "8月は複数のKRで検証系の作業が進み、KR1は目標どおり進捗しました。KR2は上長からの指摘を踏まえた見直しが必要な状況です。",
  basis: ["KR1（8月）：自己評価80%", "KR2（8月）：GMコメントより"],
};

describe("generatePersonalPeriodReviewDraft", () => {
  it("正常系：invokeAIをmax_tokens=3072・intent=okr-personal-period-review-draftで1回だけ呼ぶ", async () => {
    mockedInvokeAI.mockResolvedValueOnce(aiText(VALID_PAYLOAD));
    const result = await generatePersonalPeriodReviewDraft("【対象期間】8月の月全体の振り返り");

    expect(mockedInvokeAI).toHaveBeenCalledTimes(1);
    const [system, messages, maxTokens, intent, model] = mockedInvokeAI.mock.calls[0];
    expect(maxTokens).toBe(3072);
    expect(intent).toBe("okr-personal-period-review-draft");
    expect(model).toBe("claude-sonnet-4-6");
    expect(messages).toHaveLength(1);
    expect(String(messages[0].content)).toContain("8月の月全体の振り返り");
    // 🔴 週次任意化の共通ノーティスが実際に組み立てたシステムプロンプトに含まれる
    expect(String(system)).toContain("週ごとの目標状態と自己評価（◯△✕）は、使いたい人だけが使う任意の補助機能である");
    // 🔴 数値を書かせない指示
    expect(String(system)).toContain("達成度バンドの数値を一切書いてはならない");
    expect(result.review_text).toBe(VALID_PAYLOAD.review_text);
    expect(result.basis).toEqual(VALID_PAYLOAD.basis);
    expect(result.model).toBe("claude-sonnet-4-6");
  });

  it("stop_reason===max_tokensは例外を投げてリトライしない", async () => {
    mockedInvokeAI.mockResolvedValueOnce({ ...aiText(VALID_PAYLOAD), stop_reason: "max_tokens" });
    await expect(generatePersonalPeriodReviewDraft("context")).rejects.toThrow("長すぎて途中で切れました");
    expect(mockedInvokeAI).toHaveBeenCalledTimes(1);
  });

  it("JSONパース失敗時は1回だけ自己修正リトライする", async () => {
    mockedInvokeAI
      .mockResolvedValueOnce({ content: [{ type: "text" as const, text: "not json" }] })
      .mockResolvedValueOnce(aiText(VALID_PAYLOAD));
    const result = await generatePersonalPeriodReviewDraft("context");
    expect(mockedInvokeAI).toHaveBeenCalledTimes(2);
    expect(result.review_text).toBe(VALID_PAYLOAD.review_text);
  });

  it("2回目もパース失敗なら例外を投げる", async () => {
    mockedInvokeAI
      .mockResolvedValueOnce({ content: [{ type: "text" as const, text: "not json" }] })
      .mockResolvedValueOnce({ content: [{ type: "text" as const, text: "still not json" }] });
    await expect(generatePersonalPeriodReviewDraft("context")).rejects.toThrow();
    expect(mockedInvokeAI).toHaveBeenCalledTimes(2);
  });
});

describe("validatePersonalOkrPeriodReviewDraftPayload", () => {
  it("review_text欠落は例外", () => {
    expect(() => validatePersonalOkrPeriodReviewDraftPayload({ basis: ["x"] })).toThrow();
  });

  it("review_textが空白のみでも例外", () => {
    expect(() => validatePersonalOkrPeriodReviewDraftPayload({ review_text: "   " })).toThrow();
  });

  it("basisの非文字列要素はその要素だけ弾く", () => {
    const v = validatePersonalOkrPeriodReviewDraftPayload({ review_text: "本文", basis: ["a", 123, "", "b"] });
    expect(v.basis).toEqual(["a", "b"]);
  });

  it("basis欠落は空配列", () => {
    const v = validatePersonalOkrPeriodReviewDraftPayload({ review_text: "本文" });
    expect(v.basis).toEqual([]);
  });

  it("非オブジェクトは例外", () => {
    expect(() => validatePersonalOkrPeriodReviewDraftPayload(null)).toThrow();
    expect(() => validatePersonalOkrPeriodReviewDraftPayload("x")).toThrow();
  });
});
