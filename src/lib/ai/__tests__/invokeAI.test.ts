import { describe, it, expect, vi, beforeEach } from "vitest";

// supabase クライアントをモック（functions.invoke と from をどちらも使う）
const mockInvoke = vi.fn();
const mockInsert = vi.fn().mockResolvedValue({ error: null });

vi.mock("../../supabase/client", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
    from: () => ({ insert: mockInsert }),
  },
}));

// logAIUsage が内部で参照する localStorage 依存を切る（usageLog.test.ts と同じ方針）
vi.mock("../../localData/localStore", () => ({
  getCurrentUser: () => ({ id: "m-1" }),
}));

import { invokeAI } from "../invokeAI";

beforeEach(() => {
  mockInvoke.mockReset();
  mockInsert.mockClear();
});

describe("invokeAI", () => {
  it("正常応答時はテキストを返し使用量を記録する", async () => {
    mockInvoke.mockResolvedValue({
      data: { content: [{ type: "text", text: "こんにちは" }], usage: { input_tokens: 10, output_tokens: 5 } },
      error: null,
    });
    const res = await invokeAI("system", [{ role: "user", content: "hi" }], 1000, "kr-report");
    expect(res.content[0].text).toBe("こんにちは");
  });

  it("Edge Function の RATE_LIMIT_EXCEEDED を分かりやすい日本語メッセージに変換する", async () => {
    mockInvoke.mockResolvedValue({
      data: { error: "RATE_LIMIT_EXCEEDED", message: "1分あたりの利用上限に達しました。しばらくお待ちください。" },
      error: { message: "Edge Function returned a non-2xx status code" },
    });
    await expect(
      invokeAI("system", [{ role: "user", content: "hi" }], 1000, "kr-report"),
    ).rejects.toThrow("1分あたりの利用上限に達しました。しばらくお待ちください。");
  });

  it("RATE_LIMIT_EXCEEDED で message が無い場合はフォールバック文言を使う", async () => {
    mockInvoke.mockResolvedValue({
      data: { error: "RATE_LIMIT_EXCEEDED" },
      error: { message: "Edge Function returned a non-2xx status code" },
    });
    await expect(
      invokeAI("system", [{ role: "user", content: "hi" }], 1000, "kr-report"),
    ).rejects.toThrow("しばらくお待ちください");
  });

  it("メッセージが空なら例外を投げる", async () => {
    await expect(invokeAI("system", [], 1000, "kr-report")).rejects.toThrow(
      "送信するメッセージが空です",
    );
  });
});
