import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockInvoke = vi.fn();

vi.mock("../../supabase/client", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
  },
}));

// ゲスト（サンプル閲覧）のAI用匿名セッション確立（Phase 3・v3.29）。実際のsupabase.auth
// 呼び出しは guestAiAuth.test.ts で個別に検証済み。ここでは「呼ばれたかどうか」だけを見る。
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

import { callAIConsultation, AIError } from "../apiClient";
import type { AIConsultationPayload } from "../payloadBuilder";
import { setGuestMode } from "../../guestMode";

const PAYLOAD = { consultation: "テスト相談" } as unknown as AIConsultationPayload;

beforeEach(() => {
  mockInvoke.mockReset();
  mockEnsureGuestAiSession.mockReset().mockResolvedValue(undefined);
  mockRecordGuestAiUse.mockReset();
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

describe("callAIConsultation：ゲスト（サンプル閲覧）モードでのAI利用（Phase 3・v3.29）", () => {
  afterEach(() => setGuestMode(false));

  it("ゲストモードでも匿名セッションを確立してから functions.invoke を呼ぶ", async () => {
    setGuestMode(true);
    mockInvoke.mockResolvedValue({
      data: { content: [{ type: "text", text: "{}" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } },
      error: null,
    });

    const result = await callAIConsultation(PAYLOAD, "change", []);

    expect(result.text).toBe("{}");
    expect(mockEnsureGuestAiSession).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it("functions.invoke の body に intent（consultationType）を含める（ゲスト分の利用ログ記録に使う）", async () => {
    setGuestMode(true);
    mockInvoke.mockResolvedValue({
      data: { content: [{ type: "text", text: "{}" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } },
      error: null,
    });

    await callAIConsultation(PAYLOAD, "diagnose", []);

    const body = mockInvoke.mock.calls[0][1].body as { intent: string };
    expect(body.intent).toBe("diagnose");
  });

  it("匿名セッションの確立に失敗したら分かりやすいエラーを投げ、functions.invoke は呼ばない", async () => {
    setGuestMode(true);
    mockEnsureGuestAiSession.mockRejectedValue(new Error("Anonymous sign-ins are disabled"));

    try {
      await callAIConsultation(PAYLOAD, "change", []);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AIError);
      expect((e as Error).message).toContain("サンプルでのAI利用を開始できませんでした");
    }
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("GUEST_DAILY_LIMIT_EXCEEDED を GUEST_DAILY_LIMIT エラーに変換する（個人上限）", async () => {
    setGuestMode(true);
    mockInvoke.mockResolvedValue({
      data: { error: "GUEST_DAILY_LIMIT_EXCEEDED", message: "サンプルでのAI利用は1日3回までです。" },
      error: { message: "Edge Function returned a non-2xx status code" },
    });

    await expect(callAIConsultation(PAYLOAD, "change", [])).rejects.toThrow("サンプルでのAI利用は1日3回までです");
  });

  it("GUEST_GLOBAL_LIMIT_EXCEEDED を GUEST_GLOBAL_LIMIT エラーに変換する（全体上限。個人上限と別コード・別文言）", async () => {
    setGuestMode(true);
    mockInvoke.mockResolvedValue({
      data: { error: "GUEST_GLOBAL_LIMIT_EXCEEDED", message: "本日のサンプルAI利用枠が上限に達しました。" },
      error: { message: "Edge Function returned a non-2xx status code" },
    });

    try {
      await callAIConsultation(PAYLOAD, "change", []);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AIError);
      expect((e as InstanceType<typeof AIError>).code).toBe("GUEST_GLOBAL_LIMIT");
      expect((e as Error).message).toContain("本日のサンプルAI利用枠が上限に達しました");
    }
    expect(mockRecordGuestAiUse).not.toHaveBeenCalled();
  });
});

describe("callAIConsultation：ゲストのAI利用回数表示（参考値）の加算（v3.31）", () => {
  afterEach(() => setGuestMode(false));

  it("成功時のみrecordGuestAiUseを呼ぶ", async () => {
    setGuestMode(true);
    mockInvoke.mockResolvedValue({
      data: { content: [{ type: "text", text: "{}" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } },
      error: null,
    });

    await callAIConsultation(PAYLOAD, "change", []);

    expect(mockRecordGuestAiUse).toHaveBeenCalledTimes(1);
  });

  it("非ゲストのときは成功してもrecordGuestAiUseを呼ばない", async () => {
    setGuestMode(false);
    mockInvoke.mockResolvedValue({
      data: { content: [{ type: "text", text: "{}" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } },
      error: null,
    });

    await callAIConsultation(PAYLOAD, "change", []);

    expect(mockRecordGuestAiUse).not.toHaveBeenCalled();
  });

  it("匿名セッション確立に失敗したときはrecordGuestAiUseを呼ばない", async () => {
    setGuestMode(true);
    mockEnsureGuestAiSession.mockRejectedValueOnce(new Error("Anonymous sign-ins are disabled"));

    await expect(callAIConsultation(PAYLOAD, "change", [])).rejects.toThrow(AIError);

    expect(mockRecordGuestAiUse).not.toHaveBeenCalled();
  });
});
