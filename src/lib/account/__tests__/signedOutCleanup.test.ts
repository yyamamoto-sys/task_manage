import { describe, expect, it } from "vitest";
import { shouldReloadOnSignedOut } from "../signedOutCleanup";
import { shouldShowStartupLoadFailed } from "../startupLoadFailed";

const base = { event: "SIGNED_OUT", wasAuthenticated: true, recoveryActive: false, isGuest: false };

describe("shouldReloadOnSignedOut", () => {
  it("認証済みだったタブの SIGNED_OUT（失効・別タブのサインアウト）は再読み込みする", () => {
    expect(shouldReloadOnSignedOut(base)).toBe(true);
  });
  it("SIGNED_OUT 以外のイベントでは再読み込みしない", () => {
    for (const event of ["SIGNED_IN", "TOKEN_REFRESHED", "INITIAL_SESSION", "USER_UPDATED"]) {
      expect(shouldReloadOnSignedOut({ ...base, event })).toBe(false);
    }
  });
  it("未ログイン画面（起動時の匿名セッション掃除など）では再読み込みしない", () => {
    expect(shouldReloadOnSignedOut({ ...base, wasAuthenticated: false })).toBe(false);
  });
  it("再設定画面の間・ゲストでは再読み込みしない", () => {
    expect(shouldReloadOnSignedOut({ ...base, recoveryActive: true })).toBe(false);
    expect(shouldReloadOnSignedOut({ ...base, isGuest: true })).toBe(false);
  });
});

describe("shouldShowStartupLoadFailed", () => {
  const f = { loading: false, isWizardDone: false, hasCurrentUser: false, error: "接続がタイムアウトしました" };
  it("初回取得に失敗し誰もログインしていなければ取得失敗画面", () => {
    expect(shouldShowStartupLoadFailed(f)).toBe(true);
  });
  it("エラーが無ければアクセス拒否側へ進む（false）", () => {
    expect(shouldShowStartupLoadFailed({ ...f, error: null })).toBe(false);
  });
  it("読み込み中・メンバー確認済み・ログイン済みでは出さない", () => {
    expect(shouldShowStartupLoadFailed({ ...f, loading: true })).toBe(false);
    expect(shouldShowStartupLoadFailed({ ...f, isWizardDone: true })).toBe(false);
    expect(shouldShowStartupLoadFailed({ ...f, hasCurrentUser: true })).toBe(false);
  });
});
