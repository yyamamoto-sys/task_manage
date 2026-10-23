// 【設計意図・v3.182】AIを1回呼ぶたびにその使用量を渡す（onUsage）。
// 返答の解析に失敗して例外になる場合も、トークンは消費済みなので ai_usage_logs に記録されなければならない
// （以前は成功した場合の戻り値からだけ記録しており、失敗した送信の分が計測から漏れていた）。

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockInvoke = vi.fn();

vi.mock("../../supabase/client", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
  },
}));

import { runAIConsultation } from "../consultationRunner";
import type { AIUsage } from "../consultationRunner";
import type { AIConsultationPayload } from "../payloadBuilder";

const PAYLOAD = { consultation: "テスト相談" } as unknown as AIConsultationPayload;

function res(text: string, stopReason: string, usage: AIUsage) {
  return { data: { content: [{ type: "text", text }], stop_reason: stopReason, usage }, error: null };
}

const VALID_JSON = JSON.stringify({
  proposals: [{ proposal_id: "prop_001", title: "t", description: "d", action_type: "info" }],
  follow_up_suggestions: [],
});

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("runAIConsultation — onUsage", () => {
  it("1回で成功したら1回分を渡す", async () => {
    mockInvoke.mockResolvedValueOnce(res(VALID_JSON, "end_turn", { input_tokens: 10, output_tokens: 20 }));
    const onUsage = vi.fn();
    await runAIConsultation(PAYLOAD, "change", [], undefined, undefined, [], onUsage);
    expect(onUsage.mock.calls).toEqual([[{ input_tokens: 10, output_tokens: 20 }, false]]);
  });

  it("リトライして成功したら2回分をそれぞれ渡す", async () => {
    mockInvoke
      .mockResolvedValueOnce(res('{ "proposals": [ { "title": "壊れ', "end_turn", { input_tokens: 10, output_tokens: 20 }))
      .mockResolvedValueOnce(res(VALID_JSON, "end_turn", { input_tokens: 5, output_tokens: 8 }));
    const onUsage = vi.fn();
    await runAIConsultation(PAYLOAD, "change", [], undefined, undefined, [], onUsage);
    expect(onUsage.mock.calls).toEqual([
      [{ input_tokens: 10, output_tokens: 20 }, false],
      [{ input_tokens: 5, output_tokens: 8 }, true],
    ]);
  });

  it("出力切れ（max_tokens）で例外になっても、消費した1回分を渡している", async () => {
    mockInvoke.mockResolvedValueOnce(res('{ "proposals": [ { "title": "途中で切れ', "max_tokens", { input_tokens: 900, output_tokens: 16384 }));
    const onUsage = vi.fn();
    await expect(runAIConsultation(PAYLOAD, "change", [], undefined, undefined, [], onUsage)).rejects.toThrow();
    expect(onUsage.mock.calls).toEqual([[{ input_tokens: 900, output_tokens: 16384 }, false]]);
  });

  it("リトライ後も解析に失敗して例外になっても、2回分を渡している", async () => {
    mockInvoke
      .mockResolvedValueOnce(res('{ "proposals": [ { "title": "壊れ1', "end_turn", { input_tokens: 10, output_tokens: 20 }))
      .mockResolvedValueOnce(res('{ "proposals": [ { "title": "壊れ2', "end_turn", { input_tokens: 30, output_tokens: 40 }));
    const onUsage = vi.fn();
    await expect(runAIConsultation(PAYLOAD, "change", [], undefined, undefined, [], onUsage)).rejects.toThrow();
    expect(onUsage.mock.calls).toEqual([
      [{ input_tokens: 10, output_tokens: 20 }, false],
      [{ input_tokens: 30, output_tokens: 40 }, true],
    ]);
  });

  it("返答が空（content が空配列）で例外になっても、課金済みの1回分を渡している（v3.185）", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: { content: [], stop_reason: "end_turn", usage: { input_tokens: 700, output_tokens: 0 } },
      error: null,
    });
    const onUsage = vi.fn();
    await expect(runAIConsultation(PAYLOAD, "change", [], undefined, undefined, [], onUsage)).rejects.toThrow();
    expect(onUsage.mock.calls).toEqual([[{ input_tokens: 700, output_tokens: 0 }, false]]);
  });

  it("リトライの返答が空で例外になっても、初回とリトライの2回分を渡している（v3.185）", async () => {
    mockInvoke
      .mockResolvedValueOnce(res('{ "proposals": [ { "title": "壊れ', "end_turn", { input_tokens: 10, output_tokens: 20 }))
      .mockResolvedValueOnce({
        data: { content: [{ type: "text", text: "" }], stop_reason: "end_turn", usage: { input_tokens: 30, output_tokens: 0 } },
        error: null,
      });
    const onUsage = vi.fn();
    await expect(runAIConsultation(PAYLOAD, "change", [], undefined, undefined, [], onUsage)).rejects.toThrow();
    expect(onUsage.mock.calls).toEqual([
      [{ input_tokens: 10, output_tokens: 20 }, false],
      [{ input_tokens: 30, output_tokens: 0 }, true],
    ]);
  });
});
