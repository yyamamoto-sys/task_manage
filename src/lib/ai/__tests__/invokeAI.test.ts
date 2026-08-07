import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

// ゲスト（サンプル閲覧）のAI用匿名セッション確立（Phase 3・v3.29）。
// invokeAI.test.ts 側では「呼ばれたかどうか」だけを見る（実際のsupabase.auth呼び出しは
// guestAiAuth.test.ts で個別に検証済み）。
const mockEnsureGuestAiSession = vi.fn().mockResolvedValue(undefined);
vi.mock("../../supabase/guestAiAuth", () => ({
  ensureGuestAiSession: (...args: unknown[]) => mockEnsureGuestAiSession(...args),
}));

import { invokeAI } from "../invokeAI";
import { setGuestMode } from "../../guestMode";

beforeEach(() => {
  mockInvoke.mockReset();
  mockInsert.mockClear();
  mockEnsureGuestAiSession.mockReset().mockResolvedValue(undefined);
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

describe("invokeAI：ゲスト（サンプル閲覧）モードでのAI利用（Phase 3・v3.29）", () => {
  afterEach(() => setGuestMode(false));

  it("ゲストモードでも匿名セッションを確立してから functions.invoke を呼ぶ", async () => {
    setGuestMode(true);
    mockInvoke.mockResolvedValue({
      data: { content: [{ type: "text", text: "ok" }], usage: { input_tokens: 1, output_tokens: 1 } },
      error: null,
    });

    const res = await invokeAI("system", [{ role: "user", content: "hi" }], 1000, "kr-report");

    expect(res.content[0].text).toBe("ok");
    expect(mockEnsureGuestAiSession).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it("functions.invoke の body に intent（AIIntent）を含める（ゲスト分の利用ログ記録に使う）", async () => {
    setGuestMode(true);
    mockInvoke.mockResolvedValue({
      data: { content: [{ type: "text", text: "ok" }], usage: { input_tokens: 1, output_tokens: 1 } },
      error: null,
    });

    await invokeAI("system", [{ role: "user", content: "hi" }], 1000, "kr-report");

    const body = mockInvoke.mock.calls[0][1].body as { intent: string };
    expect(body.intent).toBe("kr-report");
  });

  it("匿名セッションの確立に失敗したら分かりやすいエラーを投げ、functions.invoke は呼ばない", async () => {
    setGuestMode(true);
    mockEnsureGuestAiSession.mockRejectedValueOnce(new Error("Anonymous sign-ins are disabled"));

    await expect(
      invokeAI("system", [{ role: "user", content: "hi" }], 1000, "kr-report"),
    ).rejects.toThrow("サンプルでのAI利用を開始できませんでした");
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
