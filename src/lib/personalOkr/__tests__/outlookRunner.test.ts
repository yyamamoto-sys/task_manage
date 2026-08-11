import { describe, it, expect, vi } from "vitest";
import { runPersonalKrOutlookAnalysis } from "../outlookRunner";
import type { PersonalKrOutlook } from "../../localData/types";
import type { PersonalOkrOutlookResult } from "../../ai/personalOkrOutlookExtractor";

function makeCached(overrides: Partial<PersonalKrOutlook> = {}): PersonalKrOutlook {
  return {
    id: "outlook-1",
    personal_kr_id: "kr-1",
    month: "2026-08-01",
    input_fingerprint: "abc123",
    outlook_json: { lead: "既存の見立て", moves: [], trade: null },
    band_ai: 70,
    band_ai_reason: "既存の根拠",
    model: "claude-sonnet-4-6",
    created_at: "2026-08-07T12:58:00.000Z",
    ...overrides,
  };
}

function makeAnalyzeResult(overrides: Partial<PersonalOkrOutlookResult> = {}): PersonalOkrOutlookResult {
  return {
    lead: "新しい見立て",
    moves: [{ week_label: "W2", action: "判定基準を閉じる", reason: "理由" }],
    trade: null,
    band_ai: 70,
    band_ai_reason: "根拠",
    model: "claude-sonnet-4-6",
    ...overrides,
  };
}

describe("runPersonalKrOutlookAnalysis", () => {
  it("🔴 fingerprintが一致していればanalyze（invokeAI相当）を呼ばず、cachedをそのまま返す", async () => {
    const cached = makeCached({ input_fingerprint: "same-fp" });
    const analyze = vi.fn().mockResolvedValue(makeAnalyzeResult());

    const result = await runPersonalKrOutlookAnalysis({
      personalKrId: "kr-1", month: "2026-08-01", fingerprint: "same-fp",
      cached, force: false, analyze,
    });

    expect(analyze).not.toHaveBeenCalled();
    expect(result.ranAnalysis).toBe(false);
    expect(result.outlook).toBe(cached);
  });

  it("🔴 fingerprintが不一致ならanalyzeを呼び、新しい行を組み立てて返す", async () => {
    const cached = makeCached({ input_fingerprint: "old-fp" });
    const analyzeResult = makeAnalyzeResult();
    const analyze = vi.fn().mockResolvedValue(analyzeResult);

    const result = await runPersonalKrOutlookAnalysis({
      personalKrId: "kr-1", month: "2026-08-01", fingerprint: "new-fp",
      cached, force: false, analyze,
      idGenerator: () => "new-id", now: () => "2026-08-11T00:00:00.000Z",
    });

    expect(analyze).toHaveBeenCalledTimes(1);
    expect(result.ranAnalysis).toBe(true);
    expect(result.outlook).toEqual({
      id: "new-id",
      personal_kr_id: "kr-1",
      month: "2026-08-01",
      input_fingerprint: "new-fp",
      outlook_json: { lead: "新しい見立て", moves: analyzeResult.moves, trade: null },
      band_ai: 70,
      band_ai_reason: "根拠",
      model: "claude-sonnet-4-6",
      created_at: "2026-08-11T00:00:00.000Z",
    });
  });

  it("cachedが無ければ（初回）fingerprintに関わらずanalyzeを呼ぶ", async () => {
    const analyze = vi.fn().mockResolvedValue(makeAnalyzeResult());
    const result = await runPersonalKrOutlookAnalysis({
      personalKrId: "kr-1", month: "2026-08-01", fingerprint: "any-fp",
      cached: null, force: false, analyze,
    });
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(result.ranAnalysis).toBe(true);
  });

  it("🔴 force=trueならfingerprintが一致していても必ずanalyzeを呼ぶ（再解析ボタン）", async () => {
    const cached = makeCached({ input_fingerprint: "same-fp" });
    const analyze = vi.fn().mockResolvedValue(makeAnalyzeResult());

    const result = await runPersonalKrOutlookAnalysis({
      personalKrId: "kr-1", month: "2026-08-01", fingerprint: "same-fp",
      cached, force: true, analyze,
    });

    expect(analyze).toHaveBeenCalledTimes(1);
    expect(result.ranAnalysis).toBe(true);
  });

  it("analyzeが失敗したらエラーをそのまま伝播する（キャッシュへのフォールバックはしない）", async () => {
    const cached = makeCached({ input_fingerprint: "old-fp" });
    const analyze = vi.fn().mockRejectedValue(new Error("AI呼び出し失敗"));
    await expect(runPersonalKrOutlookAnalysis({
      personalKrId: "kr-1", month: "2026-08-01", fingerprint: "new-fp",
      cached, force: false, analyze,
    })).rejects.toThrow("AI呼び出し失敗");
  });
});
