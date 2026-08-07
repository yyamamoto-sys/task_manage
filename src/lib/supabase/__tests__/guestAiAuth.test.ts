// src/lib/supabase/__tests__/guestAiAuth.test.ts
//
// 【設計意図】
// ゲスト（サンプル閲覧）がAIを初めて使うときだけ signInAnonymously() で匿名セッションを
// 遅延生成する ensureGuestAiSession() の単体テスト（CLAUDE.md Section 23・Phase 3・v3.29）。

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetSession = vi.fn();
const mockSignInAnonymously = vi.fn();

vi.mock("../client", () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
      signInAnonymously: (...args: unknown[]) => mockSignInAnonymously(...args),
    },
  },
}));

import { ensureGuestAiSession } from "../guestAiAuth";

beforeEach(() => {
  mockGetSession.mockReset();
  mockSignInAnonymously.mockReset();
});

describe("ensureGuestAiSession", () => {
  it("既にセッションがあれば signInAnonymously を呼ばない", async () => {
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: "u-1" } } } });

    await ensureGuestAiSession();

    expect(mockSignInAnonymously).not.toHaveBeenCalled();
  });

  it("セッションが無ければ signInAnonymously を呼ぶ", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    mockSignInAnonymously.mockResolvedValue({ error: null });

    await ensureGuestAiSession();

    expect(mockSignInAnonymously).toHaveBeenCalledTimes(1);
  });

  it("同時に複数回呼ばれても signInAnonymously は1回だけ実行する", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    let resolveSignIn: (v: { error: null }) => void;
    mockSignInAnonymously.mockReturnValue(
      new Promise(resolve => { resolveSignIn = resolve; }),
    );

    const p1 = ensureGuestAiSession();
    const p2 = ensureGuestAiSession();
    resolveSignIn!({ error: null });
    await Promise.all([p1, p2]);

    expect(mockSignInAnonymously).toHaveBeenCalledTimes(1);
  });

  it("signInAnonymously がエラーを返したら例外を投げる", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    mockSignInAnonymously.mockResolvedValue({ error: new Error("Anonymous sign-ins are disabled") });

    await expect(ensureGuestAiSession()).rejects.toThrow("Anonymous sign-ins are disabled");
  });

  it("失敗後に再度呼べば signInAnonymously を再試行できる（in-flightフラグが正しく解放される）", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    mockSignInAnonymously.mockResolvedValueOnce({ error: new Error("network") });
    await expect(ensureGuestAiSession()).rejects.toThrow("network");

    mockSignInAnonymously.mockResolvedValueOnce({ error: null });
    await expect(ensureGuestAiSession()).resolves.toBeUndefined();

    expect(mockSignInAnonymously).toHaveBeenCalledTimes(2);
  });
});
