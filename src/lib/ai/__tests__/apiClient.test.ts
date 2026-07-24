import { describe, it, expect, vi, beforeEach } from "vitest";

const mockInvoke = vi.fn();

vi.mock("../../supabase/client", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
  },
}));

import { callAIConsultation } from "../apiClient";
import type { AIConsultationPayload } from "../payloadBuilder";

const PAYLOAD = { consultation: "テスト相談" } as unknown as AIConsultationPayload;

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("callAIConsultation", () => {
  it("max_tokensを16384で送る（4096に戻さないこと。途中切れバグの再発防止）", async () => {
    mockInvoke.mockResolvedValue({
      data: {
        content: [{ type: "text", text: "{}" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      },
      error: null,
    });

    await callAIConsultation(PAYLOAD, "change", []);

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    const body = mockInvoke.mock.calls[0][1].body as { max_tokens: number };
    expect(body.max_tokens).toBe(16384);
  });

  it("Anthropicのstop_reasonをそのまま呼び出し元に返す", async () => {
    mockInvoke.mockResolvedValue({
      data: {
        content: [{ type: "text", text: "{}" }],
        stop_reason: "max_tokens",
        usage: { input_tokens: 100, output_tokens: 16384 },
      },
      error: null,
    });

    const result = await callAIConsultation(PAYLOAD, "change", []);
    expect(result.stopReason).toBe("max_tokens");
  });

  it("retryContext指定時は直前の不正出力＋修正依頼メッセージを会話に追加する", async () => {
    mockInvoke.mockResolvedValue({
      data: {
        content: [{ type: "text", text: "{}" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      },
      error: null,
    });

    await callAIConsultation(PAYLOAD, "change", [], undefined, undefined, {
      previousResponseText: "{ 壊れたJSON",
      reason: "Unexpected end of JSON input",
    });

    const body = mockInvoke.mock.calls[0][1].body as {
      messages: { role: string; content: string }[];
    };
    // [user: payload, assistant: 不正出力, user: 修正依頼] の3件が末尾に追加される
    const last3 = body.messages.slice(-3);
    expect(last3[0].role).toBe("user");
    expect(last3[1]).toEqual({ role: "assistant", content: "{ 壊れたJSON" });
    expect(last3[2].role).toBe("user");
    expect(last3[2].content).toContain("Unexpected end of JSON input");
    expect(last3[2].content).toContain("厳密に正しいJSONオブジェクト");
  });
});
