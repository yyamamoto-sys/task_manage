import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  parseAuthLink, stripAuthParams, buildResetRedirectUrl, classifyResetMailError,
  validateNewPassword, isReauthRequiredError, shouldRunNormalStartup, resendRemainingSec,
  RESET_RESEND_COOLDOWN_SEC,
} from "../recoveryFlow";
import { authJa } from "../../../i18n/auth.ja";

describe("parseAuthLink", () => {
  it("再設定のリンク（type=recovery と access_token）は recovery", () => {
    expect(parseAuthLink("#access_token=abc&refresh_token=def&type=recovery&expires_in=3600", "")).toEqual({ kind: "recovery" });
  });
  it("type=recovery でも access_token が無ければ recovery にしない", () => {
    expect(parseAuthLink("#type=recovery", "")).toEqual({ kind: "none" });
  });
  it("確認メール（type=signup）は再設定として扱わない", () => {
    expect(parseAuthLink("#access_token=abc&type=signup", "")).toEqual({ kind: "none" });
  });
  it("期限切れ・無効（error_code=otp_expired）は error", () => {
    expect(parseAuthLink("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired", ""))
      .toEqual({ kind: "error", code: "otp_expired" });
  });
  it("error だけでも error（コードは error の値）", () => {
    expect(parseAuthLink("#error=access_denied", "")).toEqual({ kind: "error", code: "access_denied" });
  });
  it("クエリ側のエラーも拾う", () => {
    expect(parseAuthLink("", "?error=access_denied&error_code=otp_expired")).toEqual({ kind: "error", code: "otp_expired" });
  });
  it("何も付いていなければ none（招待のクエリだけでも none）", () => {
    expect(parseAuthLink("", "")).toEqual({ kind: "none" });
    expect(parseAuthLink("", "?invite=abc")).toEqual({ kind: "none" });
  });
});

describe("stripAuthParams", () => {
  it("認証用のハッシュを消す", () => {
    expect(stripAuthParams("/app/", "", "#access_token=a&type=recovery")).toBe("/app/");
    expect(stripAuthParams("/app/", "", "#error=access_denied&error_code=otp_expired")).toBe("/app/");
  });
  it("認証と無関係なクエリ・ハッシュは残す", () => {
    expect(stripAuthParams("/", "?invite=abc", "")).toBe("/?invite=abc");
    expect(stripAuthParams("/", "?invite=abc&error=x&error_code=y", "#section")).toBe("/?invite=abc#section");
  });
});

describe("buildResetRedirectUrl", () => {
  it("origin と pathname だけ（クエリ・ハッシュは引き継がない）", () => {
    expect(buildResetRedirectUrl({ origin: "https://amp.example.com", pathname: "/" })).toBe("https://amp.example.com/");
  });
});

describe("classifyResetMailError（登録の有無で結果が変わらない）", () => {
  it("エラー無し＝sent（未登録のメールでも Supabase は成功を返す）", () => {
    expect(classifyResetMailError(null)).toEqual({ kind: "sent" });
  });
  it("429 と over_email_send_rate_limit は rateLimited", () => {
    expect(classifyResetMailError({ status: 429, message: "x" })).toEqual({ kind: "rateLimited" });
    expect(classifyResetMailError({ code: "over_email_send_rate_limit", message: "x" })).toEqual({ kind: "rateLimited" });
    expect(classifyResetMailError({ message: "For security purposes, you can only request this after 59 seconds." })).toEqual({ kind: "rateLimited" });
  });
  it("その他は failed（元のエラーを保持して Section 15 で表示する）", () => {
    const err = { status: 500, message: "boom" };
    expect(classifyResetMailError(err)).toEqual({ kind: "failed", error: err });
  });
  it("sent の画面文言は固定で、アカウントの有無を示す語を含まない", () => {
    expect(authJa["auth.forgot.sent"]).toBe(
      "入力したメールアドレスが登録されていれば、再設定のメールを送りました。届かない場合は迷惑メールフォルダを確認し、それでも届かなければ管理者に連絡してください。",
    );
    expect(authJa["auth.forgot.sent"]).not.toMatch(/未登録|見つかりません|存在しません/);
  });
});

describe("validateNewPassword", () => {
  it("一致しなければ mismatch（長さより先に判定）", () => {
    expect(validateNewPassword("abcdef", "abcdeg")).toBe("mismatch");
    expect(validateNewPassword("a", "b")).toBe("mismatch");
  });
  it("6文字未満は tooShort、6文字以上は ok", () => {
    expect(validateNewPassword("abcde", "abcde")).toBe("tooShort");
    expect(validateNewPassword("abcdef", "abcdef")).toBe("ok");
    expect(validateNewPassword("", "")).toBe("tooShort");
  });
});

describe("isReauthRequiredError", () => {
  it("再認証が必要・セッション切れを判定する", () => {
    expect(isReauthRequiredError({ code: "reauthentication_needed", message: "x" })).toBe(true);
    expect(isReauthRequiredError({ message: "Password update requires reauthentication" })).toBe(true);
    expect(isReauthRequiredError({ message: "Auth session missing!" })).toBe(true);
    expect(isReauthRequiredError({ message: "New password should be different from the old password." })).toBe(false);
    expect(isReauthRequiredError(null)).toBe(false);
  });
});

describe("shouldRunNormalStartup", () => {
  it("再設定中は通常の起動処理（自動マッチ・招待の受諾・SetupWizard）へ進まない", () => {
    expect(shouldRunNormalStartup(true)).toBe(false);
    expect(shouldRunNormalStartup(false)).toBe(true);
  });
});

describe("resendRemainingSec", () => {
  it("送信前は0、送信直後は60、経過に応じて減り、0で止まる", () => {
    expect(resendRemainingSec(null, 1000)).toBe(0);
    expect(resendRemainingSec(1000, 1000)).toBe(RESET_RESEND_COOLDOWN_SEC);
    expect(resendRemainingSec(1000, 1000 + 30_500)).toBe(30);
    expect(resendRemainingSec(1000, 1000 + 60_000)).toBe(0);
    expect(resendRemainingSec(1000, 1000 + 120_000)).toBe(0);
  });
});

// ソース走査：App.tsx は再設定中の分岐を、ゲスト・ログイン・認証済みアプリより先に置く。
// コメントを除いて検査する（CLAUDE.md Section 59）。
describe("App.tsx の再設定中の分岐の位置", () => {
  const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map(l => l.replace(/\/\/.*$/, "")).join("\n");
  const app = stripComments(readFileSync("src/App.tsx", "utf-8"));
  it("再設定の分岐が guestActive・LoginScreen・AuthenticatedApp より前にある", () => {
    const rec = app.indexOf("shouldRunNormalStartup(recoveryActive)");
    expect(rec).toBeGreaterThan(-1);
    expect(rec).toBeLessThan(app.indexOf("if (guestActive)"));
    expect(rec).toBeLessThan(app.indexOf("<LoginScreen"));
    expect(rec).toBeLessThan(app.indexOf("<AuthenticatedApp"));
  });
  it("PASSWORD_RECOVERY のイベントで再設定中にする", () => {
    expect(app).toMatch(/event === "PASSWORD_RECOVERY"\) setRecoveryActive\(true\)/);
  });
});
