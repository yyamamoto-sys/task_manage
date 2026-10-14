import { describe, it, expect, vi, beforeEach } from "vitest";

const setSession = vi.fn();
const order: string[] = [];
const writeMarker = vi.fn((id: string) => { order.push(`marker:${id}`); return true; });
const clearMarker = vi.fn();
const signInWithPassword = vi.fn();
const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (sub: string) => `${b64url({ alg: "HS256" })}.${b64url({ sub })}.sig`;

vi.mock("../../account/recoveryMarker", () => ({
  writeRecoveryMarker: (id: string) => writeMarker(id),
  clearRecoveryMarker: () => clearMarker(),
}));

vi.mock("../client", () => ({
  supabase: { auth: { setSession: (...a: unknown[]) => { order.push("setSession"); return setSession(...a); }, signInWithPassword: (...a: unknown[]) => signInWithPassword(...a), signOut: vi.fn(), onAuthStateChange: vi.fn() } },
}));

async function loadWith(link: unknown) {
  vi.resetModules();
  vi.doMock("../../account/initialAuthLink", () => ({ initialAuthLink: link }));
  return import("../auth");
}

describe("applyInitialAuthLink（トークンの取り込み）", () => {
  beforeEach(() => { setSession.mockReset(); order.length = 0; writeMarker.mockClear(); clearMarker.mockClear(); signInWithPassword.mockReset(); });

  it("session のリンクは access_token・refresh_token だけを setSession に渡し、recovery かどうかを返す", async () => {
    setSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } }, error: null });
    const { applyInitialAuthLink } = await loadWith({
      kind: "session", linkType: "recovery", isRecovery: true, accessToken: jwt("u1"), refreshToken: "RT",
    });
    await expect(applyInitialAuthLink()).resolves.toEqual({ kind: "applied", userId: "u1", isRecovery: true });
    expect(setSession).toHaveBeenCalledTimes(1);
    expect(setSession).toHaveBeenCalledWith({ access_token: jwt("u1"), refresh_token: "RT" });
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
      kind: "session", linkType: "recovery", isRecovery: true, accessToken: jwt("u1"), refreshToken: "RT",
    });
    await Promise.all([applyInitialAuthLink(), applyInitialAuthLink()]);
    expect(setSession).toHaveBeenCalledTimes(1);
  });

  it("setSession が失敗（無効・期限切れのトークン）しても例外にせず failed を返す", async () => {
    setSession.mockResolvedValue({ data: { session: null }, error: { message: "invalid" } });
    const { applyInitialAuthLink } = await loadWith({
      kind: "session", linkType: "recovery", isRecovery: true, accessToken: jwt("u1"), refreshToken: "RT",
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

  it("再設定リンクは setSession の前に印を書く（他タブへ SIGNED_IN が届く前に印があるように）", async () => {
    setSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } }, error: null });
    const { applyInitialAuthLink } = await loadWith({
      kind: "session", linkType: "recovery", isRecovery: true, accessToken: jwt("u1"), refreshToken: "RT",
    });
    await applyInitialAuthLink();
    expect(order).toEqual(["marker:u1", "setSession"]);
  });

  it("再設定リンクの JWT をデコードできなければ印も setSession もせず failed（無効リンク扱い）", async () => {
    const { applyInitialAuthLink } = await loadWith({
      kind: "session", linkType: "recovery", isRecovery: true, accessToken: "not-a-jwt", refreshToken: "RT",
    });
    await expect(applyInitialAuthLink()).resolves.toMatchObject({ kind: "failed", isRecovery: true });
    expect(writeMarker).not.toHaveBeenCalled();
    expect(setSession).not.toHaveBeenCalled();
  });

  it("再設定以外のリンクは印を書かない", async () => {
    setSession.mockResolvedValue({ data: { session: { user: { id: "u2" } } }, error: null });
    const { applyInitialAuthLink } = await loadWith({
      kind: "session", linkType: "signup", isRecovery: false, accessToken: jwt("u2"), refreshToken: "R2",
    });
    await applyInitialAuthLink();
    expect(writeMarker).not.toHaveBeenCalled();
  });

  it("パスワードログイン中は isPasswordLoginInFlight が true・成功したら印を消す", async () => {
    const { signIn, isPasswordLoginInFlight } = await loadWith({ kind: "none" });
    let during = false;
    signInWithPassword.mockImplementation(async () => { during = isPasswordLoginInFlight(); return { error: null }; });
    await signIn("a@b.c", "pw");
    expect(during).toBe(true);
    expect(isPasswordLoginInFlight()).toBe(false);
    expect(clearMarker).toHaveBeenCalledTimes(1);
  });

  it("パスワードログインに失敗したら印は消さず、フラグも戻す", async () => {
    const { signIn, isPasswordLoginInFlight } = await loadWith({ kind: "none" });
    signInWithPassword.mockResolvedValue({ error: new Error("bad") });
    await expect(signIn("a@b.c", "x")).rejects.toThrow();
    expect(clearMarker).not.toHaveBeenCalled();
    expect(isPasswordLoginInFlight()).toBe(false);
  });
});
