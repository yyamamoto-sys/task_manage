import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../invokeAI", () => ({
  invokeAI: vi.fn(),
}));

import { invokeAI } from "../invokeAI";
import {
  analyzePersonalKrOutlook,
  validatePersonalOkrOutlookPayload,
  readStoredOutlookPayload,
} from "../personalOkrOutlookExtractor";
import type { PersonalOkrAiContextInput } from "../../personalOkr/personalOkrAiContext";

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

const VALID_PAYLOAD = {
  lead: "今のままではバンド60に着地します。",
  moves: [{ week_label: "W2", action: "判定基準を閉じる", reason: "△の原因はここ1点。" }],
  trade: "試作の1本をテンプレのみに落とす案。",
  band_ai: 70,
  band_ai_reason: "W1が◯で前進はあるが、W2の合意が未了。",
};

describe("analyzePersonalKrOutlook", () => {
  it("正常系：invokeAIをmax_tokens=4096・intent=okr-personal-outlookで1回だけ呼び、結果を返す", async () => {
    mockedInvokeAI.mockResolvedValueOnce(aiText(VALID_PAYLOAD));
    const result = await analyzePersonalKrOutlook(baseContext());

    expect(mockedInvokeAI).toHaveBeenCalledTimes(1);
    const [system, messages, maxTokens, intent, model] = mockedInvokeAI.mock.calls[0];
    expect(maxTokens).toBe(4096);
    expect(intent).toBe("okr-personal-outlook");
    expect(model).toBe("claude-sonnet-4-6");
    expect(typeof system).toBe("string");
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
    // 渡した入力の内容がユーザーメッセージに含まれている（機械計算済みの要約のみ）
    expect(String(messages[0].content)).toContain("エース（AAS）");
    expect(String(messages[0].content)).toContain("紐づくタスク3件");

    expect(result.lead).toBe(VALID_PAYLOAD.lead);
    expect(result.moves).toEqual(VALID_PAYLOAD.moves);
    expect(result.trade).toBe(VALID_PAYLOAD.trade);
    expect(result.band_ai).toBe(70);
    expect(result.model).toBe("claude-sonnet-4-6");
  });

  it("stop_reason=max_tokensなら明示的なエラーを投げ、JSONパースを試みない", async () => {
    mockedInvokeAI.mockResolvedValueOnce({ ...aiText(VALID_PAYLOAD), stop_reason: "max_tokens" });
    await expect(analyzePersonalKrOutlook(baseContext())).rejects.toThrow(/途中で切れました/);
    expect(mockedInvokeAI).toHaveBeenCalledTimes(1); // リトライしない
  });

  it("1回目がJSONとして解析できない場合、自己修正リトライを1回行う", async () => {
    mockedInvokeAI.mockResolvedValueOnce({ content: [{ type: "text", text: "これはJSONではない" }] });
    mockedInvokeAI.mockResolvedValueOnce(aiText(VALID_PAYLOAD));

    const result = await analyzePersonalKrOutlook(baseContext());
    expect(mockedInvokeAI).toHaveBeenCalledTimes(2);
    expect(result.lead).toBe(VALID_PAYLOAD.lead);
    // リトライメッセージには元のcontent・失敗したテキスト・修正指示の3ターンが入る
    const retryMessages = mockedInvokeAI.mock.calls[1][1];
    expect(retryMessages).toHaveLength(3);
  });

  it("リトライ後もmax_tokensで切れた場合はエラーにする", async () => {
    mockedInvokeAI.mockResolvedValueOnce({ content: [{ type: "text", text: "not json" }] });
    mockedInvokeAI.mockResolvedValueOnce({ ...aiText(VALID_PAYLOAD), stop_reason: "max_tokens" });
    await expect(analyzePersonalKrOutlook(baseContext())).rejects.toThrow(/途中で切れました/);
  });
});

describe("validatePersonalOkrOutlookPayload", () => {
  it("正常系：全フィールドを正しく取り出す", () => {
    const result = validatePersonalOkrOutlookPayload(VALID_PAYLOAD);
    expect(result).toEqual(VALID_PAYLOAD);
  });

  it("欠落：leadが無ければ例外を投げる", () => {
    expect(() => validatePersonalOkrOutlookPayload({ moves: [], trade: null, band_ai: null, band_ai_reason: null }))
      .toThrow(/lead/);
  });

  it("欠落：moves/trade/band_ai/band_ai_reasonが無くてもlead単体で成立し、既定値にフォールバックする", () => {
    const result = validatePersonalOkrOutlookPayload({ lead: "見立て本文" });
    expect(result).toEqual({ lead: "見立て本文", moves: [], trade: null, band_ai: null, band_ai_reason: null });
  });

  it("型違い：band_aiが文字列や許可外の数値だとnullに落ちる（誤った値を弾く）", () => {
    expect(validatePersonalOkrOutlookPayload({ lead: "見立て", band_ai: "80" }).band_ai).toBeNull();
    expect(validatePersonalOkrOutlookPayload({ lead: "見立て", band_ai: 65 }).band_ai).toBeNull();
  });

  it("型違い：movesの要素がオブジェクトでない・必須項目を欠く場合はその要素だけ弾く", () => {
    const result = validatePersonalOkrOutlookPayload({
      lead: "見立て",
      moves: ["文字列", { week_label: "W2" }, { week_label: "W3", action: "一手" }, null],
    });
    expect(result.moves).toEqual([{ week_label: "W3", action: "一手", reason: "" }]);
  });

  it("余剰プロパティ：想定外のキーが含まれていても無視して例外を投げない", () => {
    const result = validatePersonalOkrOutlookPayload({ ...VALID_PAYLOAD, unexpected_field: "何か", extra: { nested: true } });
    expect(result).toEqual(VALID_PAYLOAD);
  });

  it("トップレベルが object でなければ例外を投げる", () => {
    expect(() => validatePersonalOkrOutlookPayload("not an object")).toThrow();
    expect(() => validatePersonalOkrOutlookPayload(null)).toThrow();
  });
});

describe("readStoredOutlookPayload", () => {
  it("正しい形の保存済みJSONを読み戻す", () => {
    const stored = { lead: "見立て", moves: [{ week_label: "W2", action: "一手", reason: "理由" }], trade: null };
    expect(readStoredOutlookPayload(stored)).toEqual(stored);
  });

  it("想定外の形（leadが無い等）はnullを返す（例外を投げない）", () => {
    expect(readStoredOutlookPayload({ moves: [] })).toBeNull();
    expect(readStoredOutlookPayload(null)).toBeNull();
    expect(readStoredOutlookPayload("broken")).toBeNull();
  });
});
