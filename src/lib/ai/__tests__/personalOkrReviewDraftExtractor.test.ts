import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../invokeAI", () => ({
  invokeAI: vi.fn(),
}));

import { invokeAI } from "../invokeAI";
import {
  generatePersonalKrReviewDraft,
  validatePersonalOkrReviewDraftPayload,
  readStoredReviewDraftPayload,
} from "../personalOkrReviewDraftExtractor";
import type { PersonalOkrAiContextInput } from "../../personalOkr/personalOkrAiContext";
import type { ReviewMaterial } from "../../personalOkr/reviewMaterial";

const mockedInvokeAI = vi.mocked(invokeAI);

function aiText(payload: object) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
}

beforeEach(() => {
  mockedInvokeAI.mockReset();
});

function baseContext(overrides: Partial<PersonalOkrAiContextInput> = {}): PersonalOkrAiContextInput {
  return {
    krLabel: "エース（AAS）",
    krKindLabel: "グループKR紐づけ",
    category: null, activity: null, strengthRole: null, weaknessRole: null, criteria: null, supplement: null,
    monthLabel: "8月（2か月目）",
    positioning: null, activities: null, targetAndEvidence: null, risks: null,
    bandTarget: 70,
    weeks: [{ label: "W1", goalState: "検証ログの形式が決まっている", selfRating: "o" }],
    taskSummary: { linkedTaskCount: 3, delayedCount: 0, stagnantCount: 0, blockedCount: 1 },
    recentMemos: [],
    ...overrides,
  };
}

function baseMaterial(overrides: Partial<ReviewMaterial> = {}): ReviewMaterial {
  return {
    weeksTotal: 4,
    ratingCounts: { o: 1, t: 1, x: 0 },
    weeksWithGoalSet: 3,
    unratedWeekCount: 2,
    linkedTaskCount: 3,
    completedTaskCount: 2,
    incompleteTaskCount: 1,
    taskStats: { delayedCount: 0, stagnantCount: 0, blockedCount: 1 },
    ...overrides,
  };
}

const VALID_PAYLOAD = {
  review_text: "今月はエース（AAS）の検証ログ整備に取り組みました。W1は目標どおり完了し、W2は一部の合意形成に留まりました。紐づくタスクは3件中2件が完了し、残り1件は先行タスク待ちの状態です。",
  evidence: ["W1：検証ログの形式が決まっている（◯）", "紐づくタスク3件中2件完了"],
  carryover: ["判定基準の合意を来月に持ち越す"],
};

describe("generatePersonalKrReviewDraft", () => {
  it("正常系：invokeAIをmax_tokens=2048・intent=okr-personal-review-draftで1回だけ呼び、結果を返す", async () => {
    mockedInvokeAI.mockResolvedValueOnce(aiText(VALID_PAYLOAD));
    const result = await generatePersonalKrReviewDraft(baseContext(), baseMaterial());

    expect(mockedInvokeAI).toHaveBeenCalledTimes(1);
    const [system, messages, maxTokens, intent, model] = mockedInvokeAI.mock.calls[0];
    expect(maxTokens).toBe(2048);
    expect(intent).toBe("okr-personal-review-draft");
    expect(model).toBe("claude-sonnet-4-6");
    expect(typeof system).toBe("string");
    // 自己評価%・バンド数値をAIに書かせない指示が入っている（D2）
    expect(system).toContain("達成度バンドの数値を一切書いてはならない");
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
    // 渡した文脈＋材料（D5・D7）の両方がユーザーメッセージに含まれている
    expect(String(messages[0].content)).toContain("エース（AAS）");
    expect(String(messages[0].content)).toContain("紐づくタスク：完了2件・未完了1件");
    expect(String(messages[0].content)).toContain("目標状態設定済み3週");

    expect(result.review_text).toBe(VALID_PAYLOAD.review_text);
    expect(result.evidence).toEqual(VALID_PAYLOAD.evidence);
    expect(result.carryover).toEqual(VALID_PAYLOAD.carryover);
    expect(result.model).toBe("claude-sonnet-4-6");
  });

  it("stop_reason=max_tokensなら明示的なエラーを投げ、JSONパースを試みない", async () => {
    mockedInvokeAI.mockResolvedValueOnce({ ...aiText(VALID_PAYLOAD), stop_reason: "max_tokens" });
    await expect(generatePersonalKrReviewDraft(baseContext(), baseMaterial())).rejects.toThrow(/途中で切れました/);
    expect(mockedInvokeAI).toHaveBeenCalledTimes(1); // リトライしない
  });

  it("1回目がJSONとして解析できない場合、自己修正リトライを1回行う", async () => {
    mockedInvokeAI.mockResolvedValueOnce({ content: [{ type: "text", text: "これはJSONではない" }] });
    mockedInvokeAI.mockResolvedValueOnce(aiText(VALID_PAYLOAD));

    const result = await generatePersonalKrReviewDraft(baseContext(), baseMaterial());
    expect(mockedInvokeAI).toHaveBeenCalledTimes(2);
    expect(result.review_text).toBe(VALID_PAYLOAD.review_text);
    const retryMessages = mockedInvokeAI.mock.calls[1][1];
    expect(retryMessages).toHaveLength(3);
  });

  it("リトライ後もmax_tokensで切れた場合はエラーにする", async () => {
    mockedInvokeAI.mockResolvedValueOnce({ content: [{ type: "text", text: "not json" }] });
    mockedInvokeAI.mockResolvedValueOnce({ ...aiText(VALID_PAYLOAD), stop_reason: "max_tokens" });
    await expect(generatePersonalKrReviewDraft(baseContext(), baseMaterial())).rejects.toThrow(/途中で切れました/);
  });
});

describe("validatePersonalOkrReviewDraftPayload", () => {
  it("正常系：全フィールドを正しく取り出す", () => {
    expect(validatePersonalOkrReviewDraftPayload(VALID_PAYLOAD)).toEqual(VALID_PAYLOAD);
  });

  it("欠落：review_textが無ければ例外を投げる", () => {
    expect(() => validatePersonalOkrReviewDraftPayload({ evidence: [], carryover: [] })).toThrow(/review_text/);
  });

  it("欠落：review_textが空文字・空白のみでも例外を投げる", () => {
    expect(() => validatePersonalOkrReviewDraftPayload({ review_text: "" })).toThrow();
    expect(() => validatePersonalOkrReviewDraftPayload({ review_text: "   " })).toThrow();
  });

  it("欠落：evidence/carryoverが無くてもreview_text単体で成立し、空配列にフォールバックする", () => {
    const result = validatePersonalOkrReviewDraftPayload({ review_text: "本文" });
    expect(result).toEqual({ review_text: "本文", evidence: [], carryover: [] });
  });

  it("型違い：evidence/carryoverの要素が文字列でない・空文字の場合、その要素だけ弾く", () => {
    const result = validatePersonalOkrReviewDraftPayload({
      review_text: "本文",
      evidence: ["有効な根拠", 123, null, "  ", { nested: true }],
      carryover: ["申し送り1", 42],
    });
    expect(result.evidence).toEqual(["有効な根拠"]);
    expect(result.carryover).toEqual(["申し送り1"]);
  });

  it("型違い：evidence/carryoverが配列でなければ空配列に落ちる", () => {
    const result = validatePersonalOkrReviewDraftPayload({ review_text: "本文", evidence: "not-array", carryover: null });
    expect(result.evidence).toEqual([]);
    expect(result.carryover).toEqual([]);
  });

  it("余剰プロパティ：想定外のキー（band_ai等）が含まれていても無視して例外を投げない", () => {
    const result = validatePersonalOkrReviewDraftPayload({ ...VALID_PAYLOAD, band_ai: 80, self_eval_pct: 70 });
    expect(result).toEqual(VALID_PAYLOAD);
  });

  it("トップレベルが object でなければ例外を投げる", () => {
    expect(() => validatePersonalOkrReviewDraftPayload("not an object")).toThrow();
    expect(() => validatePersonalOkrReviewDraftPayload(null)).toThrow();
  });
});

describe("readStoredReviewDraftPayload", () => {
  it("正しい形の保存済みJSONを読み戻す", () => {
    expect(readStoredReviewDraftPayload(VALID_PAYLOAD)).toEqual(VALID_PAYLOAD);
  });

  it("想定外の形（review_textが無い等）はnullを返す（例外を投げない）", () => {
    expect(readStoredReviewDraftPayload({ evidence: [] })).toBeNull();
    expect(readStoredReviewDraftPayload(null)).toBeNull();
    expect(readStoredReviewDraftPayload("broken")).toBeNull();
  });
});
