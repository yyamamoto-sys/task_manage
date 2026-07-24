import { describe, it, expect, vi, beforeEach } from "vitest";

const mockInvoke = vi.fn();

vi.mock("../../supabase/client", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
  },
}));

import { runAIConsultation } from "../consultationRunner";
import type { AIConsultationPayload } from "../payloadBuilder";

const PAYLOAD = { consultation: "テスト相談" } as unknown as AIConsultationPayload;

function anthropicResponse(text: string, stopReason = "end_turn", usage = { input_tokens: 10, output_tokens: 20 }) {
  return {
    data: { content: [{ type: "text", text }], stop_reason: stopReason, usage },
    error: null,
  };
}

const VALID_JSON = JSON.stringify({
  proposals: [{ proposal_id: "prop_001", title: "t", description: "d", action_type: "info" }],
  follow_up_suggestions: ["次の相談"],
});

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("runAIConsultation — 正常系", () => {
  it("1回で正しいJSONが返れば1回のAPIコールで完結する", async () => {
    mockInvoke.mockResolvedValueOnce(anthropicResponse(VALID_JSON));

    const result = await runAIConsultation(PAYLOAD, "change", []);

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(result.proposals).toHaveLength(1);
    expect(result.follow_up_suggestions).toEqual(["次の相談"]);
    expect(result.rawResponse).toBe(VALID_JSON);
    expect(result.retryUsage).toBeUndefined();
  });
});

describe("runAIConsultation — 自己修正リトライ", () => {
  it("1回目が不正JSON（max_tokens以外）なら1回だけリトライし成功する", async () => {
    mockInvoke
      .mockResolvedValueOnce(anthropicResponse('{ "proposals": [ { "title": "壊れ', "end_turn"))
      .mockResolvedValueOnce(anthropicResponse(VALID_JSON, "end_turn", { input_tokens: 5, output_tokens: 8 }));

    const result = await runAIConsultation(PAYLOAD, "change", []);

    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(result.proposals).toHaveLength(1);
    expect(result.rawResponse).toBe(VALID_JSON);
    expect(result.retryUsage).toEqual({ input_tokens: 5, output_tokens: 8 });

    // 2回目呼び出しのmessagesには1回目の不正出力＋修正依頼が積まれている
    const secondCallBody = mockInvoke.mock.calls[1][1].body as { messages: { role: string; content: string }[] };
    const roles = secondCallBody.messages.map((m) => m.role);
    expect(roles.slice(-3)).toEqual(["user", "assistant", "user"]);
  });

  it("stop_reason=max_tokensの出力切れはリトライせず、分かりやすいメッセージでthrowする", async () => {
    mockInvoke.mockResolvedValueOnce(
      anthropicResponse('{ "proposals": [ { "title": "途中で切れ', "max_tokens"),
    );

    await expect(runAIConsultation(PAYLOAD, "change", [])).rejects.toThrow(
      "応答が長くなりすぎて途中で切れました",
    );
    // リトライしていない（無駄なAPIコールをしない）
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it("リトライ後も不正JSONなら最終的にエラーを伝播する", async () => {
    mockInvoke
      .mockResolvedValueOnce(anthropicResponse('{ "proposals": [ { "title": "壊れ1', "end_turn"))
      .mockResolvedValueOnce(anthropicResponse('{ "proposals": [ { "title": "壊れ2', "end_turn"));

    await expect(runAIConsultation(PAYLOAD, "change", [])).rejects.toThrow();
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });
});
