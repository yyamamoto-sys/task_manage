import { describe, it, expect, vi, beforeEach } from "vitest";

const setSession = vi.fn();

vi.mock("../client", () => ({
  supabase: { auth: { setSession: (...a: unknown[]) => setSession(...a), signOut: vi.fn(), onAuthStateChange: vi.fn() } },
}));

async function loadWith(link: unknown) {
  vi.resetModules();
  vi.doMock("../../account/initialAuthLink", () => ({ initialAuthLink: link }));
  return import("../auth");
}

describe("applyInitialAuthLink（トークンの取り込み）", () => {
  beforeEach(() => { setSession.mockReset(); });

  it("session のリンクは access_token・refresh_token だけを setSession に渡し、recovery かどうかを返す", async () => {
    setSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } }, error: null });
    const { applyInitialAuthLink } = await loadWith({
      kind: "session", linkType: "recovery", isRecovery: true, accessToken: "AT", refreshToken: "RT",
    });
    await expect(applyInitialAuthLink()).resolves.toEqual({ kind: "applied", userId: "u1", isRecovery: true });
    expect(setSession).toHaveBeenCalledTimes(1);
    expect(setSession).toHaveBeenCalledWith({ access_token: "AT", refresh_token: "RT" });
  });

  it("サインアップ確認（type=signup）も取り込み、再設定としては扱わない", async () => {
    setSession.mockResolvedValue({ data: { session: { user: { id: "u2" } } }, error: null });
    const { applyInitialAuthLink } = await loadWith({
      kind: "session", linkType: "signup", isRecovery: false, accessToken: "A2", refreshToken: "R2",
    });
    await expect(applyInitialAuthLink()).resolves.toEqual({ kind: "applied", userId: "u2", isRecovery: false });
    expect(setSession).toHaveBeenCalledWith({ access_token: "A2", refresh_token: "R2" });
  });

  it("結果は1度だけ作って使い回す（StrictMode の二重実行で setSession を2回呼ばない）", async () => {
    setSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } }, error: null });
    const { applyInitialAuthLink } = await loadWith({
      kind: "session", linkType: "recovery", isRecovery: true, accessToken: "AT", refreshToken: "RT",
    });
    await Promise.all([applyInitialAuthLink(), applyInitialAuthLink()]);
    expect(setSession).toHaveBeenCalledTimes(1);
  });

  it("setSession が失敗（無効・期限切れのトークン）しても例外にせず failed を返す", async () => {
    setSession.mockResolvedValue({ data: { session: null }, error: { message: "invalid" } });
    const { applyInitialAuthLink } = await loadWith({
      kind: "session", linkType: "recovery", isRecovery: true, accessToken: "AT", refreshToken: "RT",
    });
    const r = await applyInitialAuthLink();
    expect(r).toMatchObject({ kind: "failed", isRecovery: true });
  });

  it("リンクが無い・エラーのときは setSession を呼ばない", async () => {
    for (const link of [{ kind: "none" }, { kind: "error", code: "otp_expired", linkType: null }]) {
      const { applyInitialAuthLink } = await loadWith(link);
      await expect(applyInitialAuthLink()).resolves.toEqual({ kind: "none" });
    }
    expect(setSession).not.toHaveBeenCalled();
  });
});
