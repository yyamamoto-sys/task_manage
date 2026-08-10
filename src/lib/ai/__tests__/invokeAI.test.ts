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

// ゲスト回数表示（参考値）の加算（v3.31）。実際の加算ロジックはguestAiQuotaCounter.test.tsで
// 個別に検証済み。ここでは「成功時だけ呼ばれ、エラー時は呼ばれない」ことだけを見る。
const mockRecordGuestAiUse = vi.fn();
vi.mock("../../guestAiQuotaCounter", () => ({
  recordGuestAiUse: (...args: unknown[]) => mockRecordGuestAiUse(...args),
}));

import { invokeAI } from "../invokeAI";
import { setGuestMode } from "../../guestMode";

beforeEach(() => {
  mockInvoke.mockReset();
  mockInsert.mockClear();
  mockEnsureGuestAiSession.mockReset().mockResolvedValue(undefined);
  mockRecordGuestAiUse.mockReset();
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

describe("invokeAI：実際のsupabase-js非2xx挙動（data=null・response本文を読む。2026-08-10バグ修正）", () => {
  it("dataがnullでもresponseからANTHROPIC_ERRORの詳細を読み取ってスローする", async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: { message: "Edge Function returned a non-2xx status code" },
      response: {
        status: 502,
        text: async () =>
          JSON.stringify({ error: "ANTHROPIC_ERROR", status: 529, detail: JSON.stringify({ error: { message: "overloaded_error" } }) }),
      },
    });
    await expect(
      invokeAI("system", [{ role: "user", content: "hi" }], 1000, "kr-report"),
    ).rejects.toThrow(/Anthropic APIエラー \(529\).*overloaded_error/);
  });

  it("responseの本文がJSONでない（ゲートウェイの413等）ときもステータス＋本文の断片を投げる", async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: { message: "Edge Function returned a non-2xx status code" },
      response: { status: 413, text: async () => "Payload Too Large" },
    });
    await expect(
      invokeAI("system", [{ role: "user", content: "hi" }], 1000, "kr-report"),
    ).rejects.toThrow(/添付ファイルが大きすぎます \(413\)/);
  });

  it("response本文の読み取り自体が失敗しても例外を投げず、既定のエラーで終わる", async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: { message: "Edge Function returned a non-2xx status code" },
      response: { status: 500, text: async () => { throw new Error("body used"); } },
    });
    await expect(
      invokeAI("system", [{ role: "user", content: "hi" }], 1000, "kr-report"),
    ).rejects.toThrow(/Edge Function returned a non-2xx status code \(500\)/);
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
    expect(mockRecordGuestAiUse).not.toHaveBeenCalled();
  });

  it("ゲストが非ゲストのときは成功してもrecordGuestAiUseを呼ばない", async () => {
    setGuestMode(false);
    mockInvoke.mockResolvedValue({
      data: { content: [{ type: "text", text: "ok" }], usage: { input_tokens: 1, output_tokens: 1 } },
      error: null,
    });

    await invokeAI("system", [{ role: "user", content: "hi" }], 1000, "kr-report");

    expect(mockRecordGuestAiUse).not.toHaveBeenCalled();
  });
});

describe("invokeAI：ゲストのAI利用回数表示（参考値）の加算（v3.31）", () => {
  afterEach(() => setGuestMode(false));

  it("成功時のみrecordGuestAiUseを呼ぶ", async () => {
    setGuestMode(true);
    mockInvoke.mockResolvedValue({
      data: { content: [{ type: "text", text: "ok" }], usage: { input_tokens: 1, output_tokens: 1 } },
      error: null,
    });

    await invokeAI("system", [{ role: "user", content: "hi" }], 1000, "kr-report");

    expect(mockRecordGuestAiUse).toHaveBeenCalledTimes(1);
  });

  it("Edge Functionがエラーを返したときはrecordGuestAiUseを呼ばない（GUEST_DAILY_LIMIT_EXCEEDED）", async () => {
    setGuestMode(true);
    mockInvoke.mockResolvedValue({
      data: { error: "GUEST_DAILY_LIMIT_EXCEEDED", message: "サンプルでのAI利用は1日3回までです。" },
      error: { message: "Edge Function returned a non-2xx status code" },
    });

    await expect(
      invokeAI("system", [{ role: "user", content: "hi" }], 1000, "kr-report"),
    ).rejects.toThrow();
    expect(mockRecordGuestAiUse).not.toHaveBeenCalled();
  });
});
