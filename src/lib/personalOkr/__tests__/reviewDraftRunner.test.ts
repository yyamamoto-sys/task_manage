import { describe, it, expect, vi } from "vitest";
import { runPersonalKrReviewDraft } from "../reviewDraftRunner";
import type { PersonalKrReviewDraft } from "../../localData/types";
import type { PersonalOkrReviewDraftResult } from "../../ai/personalOkrReviewDraftExtractor";

function makeCached(overrides: Partial<PersonalKrReviewDraft> = {}): PersonalKrReviewDraft {
  return {
    id: "draft-1",
    personal_kr_id: "kr-1",
    month: "2026-08-01",
    input_fingerprint: "abc123",
    draft_json: { review_text: "既存の下書き", evidence: [], carryover: [] },
    edited_text: null,
    edited_at: null,
    model: "claude-sonnet-4-6",
    created_at: "2026-08-07T12:58:00.000Z",
    ...overrides,
  };
}

function makeAnalyzeResult(overrides: Partial<PersonalOkrReviewDraftResult> = {}): PersonalOkrReviewDraftResult {
  return {
    review_text: "新しい下書き",
    evidence: ["W2：目標状態を達成"],
    carryover: [],
    model: "claude-sonnet-4-6",
    ...overrides,
  };
}

describe("runPersonalKrReviewDraft", () => {
  it("🔴 fingerprintが一致していればanalyze（invokeAI相当）を呼ばず、cachedをそのまま返す", async () => {
    const cached = makeCached({ input_fingerprint: "same-fp" });
    const analyze = vi.fn().mockResolvedValue(makeAnalyzeResult());

    const result = await runPersonalKrReviewDraft({
      personalKrId: "kr-1", month: "2026-08-01", fingerprint: "same-fp",
      cached, force: false, analyze,
    });

    expect(analyze).not.toHaveBeenCalled();
    expect(result.ranAnalysis).toBe(false);
    expect(result.draft).toBe(cached);
  });

  it("🔴 fingerprintが不一致ならanalyzeを呼び、新しい行を組み立てて返す（edited_text/edited_atはnull）", async () => {
    const cached = makeCached({ input_fingerprint: "old-fp", edited_text: "前回の編集済み本文", edited_at: "2026-08-07T13:00:00.000Z" });
    const analyzeResult = makeAnalyzeResult();
    const analyze = vi.fn().mockResolvedValue(analyzeResult);

    const result = await runPersonalKrReviewDraft({
      personalKrId: "kr-1", month: "2026-08-01", fingerprint: "new-fp",
      cached, force: false, analyze,
      idGenerator: () => "new-id", now: () => "2026-08-20T00:00:00.000Z",
    });

    expect(analyze).toHaveBeenCalledTimes(1);
    expect(result.ranAnalysis).toBe(true);
    expect(result.draft).toEqual({
      id: "new-id",
      personal_kr_id: "kr-1",
      month: "2026-08-01",
      input_fingerprint: "new-fp",
      draft_json: { review_text: "新しい下書き", evidence: analyzeResult.evidence, carryover: [] },
      edited_text: null,
      edited_at: null,
      model: "claude-sonnet-4-6",
      created_at: "2026-08-20T00:00:00.000Z",
    });
  });

  it("cachedが無ければ（初回）fingerprintに関わらずanalyzeを呼ぶ", async () => {
    const analyze = vi.fn().mockResolvedValue(makeAnalyzeResult());
    const result = await runPersonalKrReviewDraft({
      personalKrId: "kr-1", month: "2026-08-01", fingerprint: "any-fp",
      cached: null, force: false, analyze,
    });
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(result.ranAnalysis).toBe(true);
  });

  it("🔴 force=trueならfingerprintが一致していても必ずanalyzeを呼ぶ（再生成ボタン）", async () => {
    const cached = makeCached({ input_fingerprint: "same-fp" });
    const analyze = vi.fn().mockResolvedValue(makeAnalyzeResult());

    const result = await runPersonalKrReviewDraft({
      personalKrId: "kr-1", month: "2026-08-01", fingerprint: "same-fp",
      cached, force: true, analyze,
    });

    expect(analyze).toHaveBeenCalledTimes(1);
    expect(result.ranAnalysis).toBe(true);
  });

  it("analyzeが失敗したらエラーをそのまま伝播する（キャッシュへのフォールバックはしない）", async () => {
    const cached = makeCached({ input_fingerprint: "old-fp" });
    const analyze = vi.fn().mockRejectedValue(new Error("AI呼び出し失敗"));
    await expect(runPersonalKrReviewDraft({
      personalKrId: "kr-1", month: "2026-08-01", fingerprint: "new-fp",
      cached, force: false, analyze,
    })).rejects.toThrow("AI呼び出し失敗");
  });
});
