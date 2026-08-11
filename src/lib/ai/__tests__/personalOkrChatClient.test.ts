import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../invokeAI", () => ({
  invokeAI: vi.fn(),
}));

import { invokeAI } from "../invokeAI";
import { sendPersonalOkrChatMessage, MAX_TOKENS_OKR_CHAT, OKR_CHAT_MODEL } from "../personalOkrChatClient";

const mockedInvokeAI = vi.mocked(invokeAI);

beforeEach(() => {
  mockedInvokeAI.mockReset();
});

describe("sendPersonalOkrChatMessage", () => {
  it("invokeAIをmax_tokens=2048・intent=okr-personal-chat・modelを指定して呼ぶ", async () => {
    mockedInvokeAI.mockResolvedValueOnce({ content: [{ type: "text", text: "判定基準の合意、1点だけです。" }] });
    const turns = [{ role: "user" as const, content: "今週何を優先すべき？" }];
    const answer = await sendPersonalOkrChatMessage("system prompt", turns);

    expect(answer).toBe("判定基準の合意、1点だけです。");
    expect(mockedInvokeAI).toHaveBeenCalledWith("system prompt", turns, MAX_TOKENS_OKR_CHAT, "okr-personal-chat", OKR_CHAT_MODEL);
    expect(MAX_TOKENS_OKR_CHAT).toBe(2048);
  });

  it("stop_reason=max_tokensなら明示的なエラーを投げる", async () => {
    mockedInvokeAI.mockResolvedValueOnce({ content: [{ type: "text", text: "途中で切れた回答" }], stop_reason: "max_tokens" });
    await expect(sendPersonalOkrChatMessage("system", [{ role: "user", content: "質問" }]))
      .rejects.toThrow(/途中で切れました/);
  });

  it("contentが空でも例外にせず空文字を返す", async () => {
    mockedInvokeAI.mockResolvedValueOnce({ content: [] });
    const answer = await sendPersonalOkrChatMessage("system", [{ role: "user", content: "質問" }]);
    expect(answer).toBe("");
  });
});
