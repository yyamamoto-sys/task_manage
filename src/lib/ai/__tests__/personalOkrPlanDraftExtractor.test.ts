import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../invokeAI", () => ({
  invokeAI: vi.fn(),
}));

import { invokeAI } from "../invokeAI";
import {
  generatePersonalKrPlanDraft,
  validatePersonalOkrPlanDraftPayload,
} from "../personalOkrPlanDraftExtractor";

const mockedInvokeAI = vi.mocked(invokeAI);

function aiText(payload: object) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
}

beforeEach(() => {
  mockedInvokeAI.mockReset();
});

const VALID_PAYLOAD = {
  positioning: "エース（AAS）の検証フェーズを主導する",
  activities: "検証ログの形式を確定し、判定基準を高瀬さんと合意する",
  target_and_evidence: "検証ログのテンプレートが確定し、3件の実案件で試験運用されている状態",
  risks: "高瀬さんとの合意形成が遅れると判定基準が固まらない",
  band_target: 70,
  band_target_reason: "7月の振り返りで前進が見られるため",
  basis: ["7月の振り返りで検証ログの形式が未確定と書かれているため", "上長コメントの合意形成の遅れを反映"],
};

const SAMPLE_CONTEXT_TEXT = "【対象KR（四半期を通じた目標）】エース（AAS）（グループKR紐づけ・FY2026 3Q）";

describe("generatePersonalKrPlanDraft", () => {
  it("正常系：invokeAIをmax_tokens=3072・intent=okr-personal-plan-draftで1回だけ呼び、結果を返す", async () => {
    mockedInvokeAI.mockResolvedValueOnce(aiText(VALID_PAYLOAD));
    const result = await generatePersonalKrPlanDraft(SAMPLE_CONTEXT_TEXT);

    expect(mockedInvokeAI).toHaveBeenCalledTimes(1);
    const [system, messages, maxTokens, intent, model] = mockedInvokeAI.mock.calls[0];
    expect(maxTokens).toBe(3072);
    expect(intent).toBe("okr-personal-plan-draft");
    expect(model).toBe("claude-sonnet-4-6");
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
    expect(String(messages[0].content)).toBe(SAMPLE_CONTEXT_TEXT);

    // 🔴 週次任意化の共通ノーティスが実際に組み立てたシステムプロンプトに含まれる（CLAUDE.md Section 24 Step O）
    expect(String(system)).toContain("週ごとの目標状態と自己評価（◯△✕）は、使いたい人だけが使う任意の補助機能である");
    // 🔴 実施記録の評価軸ノーティス（仕様書§W5）が実際に組み立てたシステムプロンプトに含まれる
    expect(String(system)).toContain("計画からの逸脱ではなく、");
    // 自己評価の割合を書かないことの明記（band_targetは評価の確定ではない）
    expect(String(system)).toContain("自己評価の割合（実績%）は一切書かないこと");

    expect(result).toEqual({ ...VALID_PAYLOAD, model: "claude-sonnet-4-6" });
  });

  it("stop_reason=max_tokensなら明示的なエラーを投げ、JSONパースを試みない", async () => {
    mockedInvokeAI.mockResolvedValueOnce({ ...aiText(VALID_PAYLOAD), stop_reason: "max_tokens" });
    await expect(generatePersonalKrPlanDraft(SAMPLE_CONTEXT_TEXT)).rejects.toThrow(/途中で切れました/);
    expect(mockedInvokeAI).toHaveBeenCalledTimes(1); // リトライしない
  });

  it("1回目がJSONとして解析できない場合、自己修正リトライを1回行う", async () => {
    mockedInvokeAI.mockResolvedValueOnce({ content: [{ type: "text", text: "これはJSONではない" }] });
    mockedInvokeAI.mockResolvedValueOnce(aiText(VALID_PAYLOAD));

    const result = await generatePersonalKrPlanDraft(SAMPLE_CONTEXT_TEXT);
    expect(mockedInvokeAI).toHaveBeenCalledTimes(2);
    expect(result.positioning).toBe(VALID_PAYLOAD.positioning);
    const retryMessages = mockedInvokeAI.mock.calls[1][1];
    expect(retryMessages).toHaveLength(3);
  });

  it("リトライ後もmax_tokensで切れた場合はエラーにする", async () => {
    mockedInvokeAI.mockResolvedValueOnce({ content: [{ type: "text", text: "not json" }] });
    mockedInvokeAI.mockResolvedValueOnce({ ...aiText(VALID_PAYLOAD), stop_reason: "max_tokens" });
    await expect(generatePersonalKrPlanDraft(SAMPLE_CONTEXT_TEXT)).rejects.toThrow(/途中で切れました/);
  });
});

describe("validatePersonalOkrPlanDraftPayload", () => {
  it("正常系：全フィールドを正しく取り出す", () => {
    expect(validatePersonalOkrPlanDraftPayload(VALID_PAYLOAD)).toEqual(VALID_PAYLOAD);
  });

  it("🔴 4欄すべて空なら例外を投げる", () => {
    expect(() => validatePersonalOkrPlanDraftPayload({
      positioning: "", activities: "", target_and_evidence: "", risks: "",
      band_target: null, band_target_reason: "", basis: [],
    })).toThrow(/4欄とも空/);
  });

  it("🔴 4欄すべて欠落（undefined）でも空文字扱いで例外を投げる", () => {
    expect(() => validatePersonalOkrPlanDraftPayload({})).toThrow(/4欄とも空/);
  });

  it("1欄だけ埋まっていれば通る（他の3欄は空文字のまま）", () => {
    const result = validatePersonalOkrPlanDraftPayload({ positioning: "位置づけのみ記入" });
    expect(result.positioning).toBe("位置づけのみ記入");
    expect(result.activities).toBe("");
    expect(result.target_and_evidence).toBe("");
    expect(result.risks).toBe("");
    expect(result.band_target).toBeNull();
    expect(result.basis).toEqual([]);
  });

  it("🔴 band_targetに65（無効な値）が返ったときnullに落ちる（例外にしない）", () => {
    const result = validatePersonalOkrPlanDraftPayload({ ...VALID_PAYLOAD, band_target: 65 });
    expect(result.band_target).toBeNull();
  });

  it("🔴 band_targetに文字列'70'が返ったときnullに落ちる", () => {
    const result = validatePersonalOkrPlanDraftPayload({ ...VALID_PAYLOAD, band_target: "70" });
    expect(result.band_target).toBeNull();
  });

  it("band_targetが70（有効な値）ならそのまま通る", () => {
    const result = validatePersonalOkrPlanDraftPayload({ ...VALID_PAYLOAD, band_target: 70 });
    expect(result.band_target).toBe(70);
  });

  it("band_targetがnullでも許容する", () => {
    const result = validatePersonalOkrPlanDraftPayload({ ...VALID_PAYLOAD, band_target: null });
    expect(result.band_target).toBeNull();
  });

  it("basisは7件目以降を切り詰め、非文字列・空文字はその要素だけ弾く", () => {
    const result = validatePersonalOkrPlanDraftPayload({
      ...VALID_PAYLOAD,
      basis: ["根拠1", "根拠2", 123, "  ", "根拠3", "根拠4", "根拠5", "根拠6", "根拠7"],
    });
    expect(result.basis.length).toBeLessThanOrEqual(6);
    expect(result.basis).not.toContain("");
  });

  it("トップレベルがobjectでなければ例外を投げる", () => {
    expect(() => validatePersonalOkrPlanDraftPayload("not an object")).toThrow();
    expect(() => validatePersonalOkrPlanDraftPayload(null)).toThrow();
  });
});
