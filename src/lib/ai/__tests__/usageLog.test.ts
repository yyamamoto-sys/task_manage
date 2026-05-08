import { describe, it, expect, vi, beforeEach } from "vitest";

// localStore と supabase クライアントをモック
const mockGetCurrentUser = vi.fn();
const mockInsert = vi.fn();
const mockFrom = vi.fn((_table: string) => ({ insert: mockInsert }));

vi.mock("../../localData/localStore", () => ({
  getCurrentUser: () => mockGetCurrentUser(),
}));

vi.mock("../../supabase/client", () => ({
  supabase: { from: (table: string) => mockFrom(table) },
}));

import { logAIUsage } from "../usageLog";

beforeEach(() => {
  mockGetCurrentUser.mockReset();
  mockInsert.mockReset();
  mockFrom.mockClear();
  // insert はデフォルトで成功扱い
  mockInsert.mockResolvedValue({ error: null });
});

describe("logAIUsage", () => {
  it("ログイン中ユーザー＋usage 有り → ai_usage_logs に INSERT する", () => {
    mockGetCurrentUser.mockReturnValue({ id: "m-1" });
    logAIUsage("kr-report", { input_tokens: 100, output_tokens: 200 });

    expect(mockFrom).toHaveBeenCalledWith("ai_usage_logs");
    expect(mockInsert).toHaveBeenCalledWith({
      member_id: "m-1",
      consultation_type: "kr-report",
      input_tokens: 100,
      output_tokens: 200,
    });
  });

  it("usage が undefined なら INSERT を呼ばない", () => {
    mockGetCurrentUser.mockReturnValue({ id: "m-1" });
    logAIUsage("kr-report", undefined);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("ログイン中ユーザーが取得できなければ INSERT を呼ばない", () => {
    mockGetCurrentUser.mockReturnValue(null);
    logAIUsage("kr-report", { input_tokens: 1, output_tokens: 1 });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("INSERT 失敗時も例外を投げず console.warn のみ", async () => {
    mockGetCurrentUser.mockReturnValue({ id: "m-1" });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockInsert.mockResolvedValueOnce({ error: { message: "RLS denied" } });

    expect(() => logAIUsage("kr-report", { input_tokens: 1, output_tokens: 1 })).not.toThrow();
    // 非同期の .then() を待つ
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("AIIntent 各種を consultation_type にそのまま保存する", () => {
    mockGetCurrentUser.mockReturnValue({ id: "m-1" });
    const intents = [
      "task-management", "kr-report", "kr-quarter-plan",
      "kr-session-extract", "kr-why", "meeting-extract",
      "project-plan", "todo-decompose",
    ];
    for (const intent of intents) {
      logAIUsage(intent, { input_tokens: 10, output_tokens: 20 });
    }
    expect(mockInsert).toHaveBeenCalledTimes(intents.length);
    for (let i = 0; i < intents.length; i++) {
      const call = mockInsert.mock.calls[i][0];
      expect(call.consultation_type).toBe(intents[i]);
    }
  });
});
