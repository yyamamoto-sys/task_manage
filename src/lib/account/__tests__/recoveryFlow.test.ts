import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  parseAuthLink, stripAuthParams, captureAuthLink, sessionArgsFromLink, shouldOpenResetFormOnError,
  buildResetRedirectUrl, classifyResetMailError, validateNewPassword, classifyUpdatePasswordError,
  isReauthRequiredError, resolveRecoveryOnStartup, buildRecoveryMarker, parseRecoveryMarker,
  resendRemainingSec, RESET_RESEND_COOLDOWN_SEC, RECOVERY_MARKER_MAX_AGE_MS,
} from "../recoveryFlow";
import { authJa } from "../../../i18n/auth.ja";

const TOKENS = "access_token=AT&refresh_token=RT&expires_in=3600&token_type=bearer";

describe("parseAuthLink：type ごとの分岐（detectSessionInUrl を切ったので全 type を自前で扱う）", () => {
  it("type=recovery は isRecovery=true の session", () => {
    expect(parseAuthLink(`#${TOKENS}&type=recovery`, "")).toEqual({
      kind: "session", linkType: "recovery", isRecovery: true, accessToken: "AT", refreshToken: "RT",
    });
  });
  it.each(["signup", "invite", "magiclink", "email_change"])("type=%s は通常のログイン（isRecovery=false）として取り込む", type => {
    expect(parseAuthLink(`#${TOKENS}&type=${type}`, "")).toMatchObject({ kind: "session", linkType: type, isRecovery: false });
  });
  it("type が無くてもトークンが揃っていれば通常のログインとして取り込む", () => {
    expect(parseAuthLink(`#${TOKENS}`, "")).toMatchObject({ kind: "session", linkType: null, isRecovery: false });
  });
  it("トークンが揃っていなければ none（recovery でも）", () => {
    expect(parseAuthLink("#access_token=AT&type=recovery", "")).toEqual({ kind: "none" });
    expect(parseAuthLink("#type=recovery", "")).toEqual({ kind: "none" });
    expect(parseAuthLink("#message=Confirmation+link+accepted", "")).toEqual({ kind: "none" });
  });
  it("期限切れ・無効は error（コードと type を保持）", () => {
    expect(parseAuthLink("#error=access_denied&error_code=otp_expired&error_description=x", ""))
      .toEqual({ kind: "error", code: "otp_expired", linkType: null });
    expect(parseAuthLink("#error=access_denied&error_code=otp_expired&type=signup", ""))
      .toEqual({ kind: "error", code: "otp_expired", linkType: "signup" });
    expect(parseAuthLink("", "?error=access_denied&error_code=otp_expired")).toMatchObject({ kind: "error", code: "otp_expired" });
  });
  it("何も付いていなければ none（招待のクエリだけでも none）", () => {
    expect(parseAuthLink("", "")).toEqual({ kind: "none" });
    expect(parseAuthLink("", "?invite=abc")).toEqual({ kind: "none" });
  });
});

describe("sessionArgsFromLink（setSession に渡る値）", () => {
  it("access_token と refresh_token だけを渡す", () => {
    const link = parseAuthLink(`#${TOKENS}&type=signup`, "");
    if (link.kind !== "session") throw new Error("session ではない");
    expect(sessionArgsFromLink(link)).toEqual({ access_token: "AT", refresh_token: "RT" });
  });
});

describe("shouldOpenResetFormOnError", () => {
  it("サインアップ確認などと分かる場合は再設定フォームを開かない／type が無ければ開く", () => {
    expect(shouldOpenResetFormOnError({ kind: "error", code: "otp_expired", linkType: null })).toBe(true);
    expect(shouldOpenResetFormOnError({ kind: "error", code: "otp_expired", linkType: "recovery" })).toBe(true);
    expect(shouldOpenResetFormOnError({ kind: "error", code: "otp_expired", linkType: "signup" })).toBe(false);
    expect(shouldOpenResetFormOnError({ kind: "none" })).toBe(false);
  });
});

describe("stripAuthParams", () => {
  it("認証用のハッシュを消す", () => {
    expect(stripAuthParams("/app/", "", `#${TOKENS}&type=recovery`)).toBe("/app/");
    expect(stripAuthParams("/app/", "", "#error=access_denied&error_code=otp_expired")).toBe("/app/");
    expect(stripAuthParams("/app/", "", "#message=Confirmation+link+accepted")).toBe("/app/");
  });
  it("認証と無関係なクエリ・ハッシュは残す", () => {
    expect(stripAuthParams("/", "?invite=abc", "")).toBe("/?invite=abc");
    expect(stripAuthParams("/", "?invite=abc&error=x&error_code=y", "#section")).toBe("/?invite=abc#section");
  });
});

describe("captureAuthLink：控えた直後に replaceState（push しない）", () => {
  function fakeWindow(hash: string, search = "", pathname = "/") {
    const calls: Array<[unknown, string, string | null | undefined]> = [];
    const location = {
      pathname, search,
      get hash() { return hash; },
      set hash(_v: string) { throw new Error("location.hash への代入は履歴を積むため使わない"); },
    };
    const history = {
      replaceState: (d: unknown, u: string, url?: string | null) => { calls.push([d, u, url]); },
      pushState: () => { throw new Error("pushState は使わない"); },
    };
    return { win: { location, history }, calls };
  }
  it("トークン付きの URL は値を返しつつ、直ちに replaceState で消す（push・hash 代入はしない）", () => {
    const { win, calls } = fakeWindow(`#${TOKENS}&type=recovery`);
    const link = captureAuthLink(win);
    expect(link).toMatchObject({ kind: "session", isRecovery: true, accessToken: "AT" });
    expect(calls).toEqual([[null, "", "/"]]);
  });
  it("エラーも消す。招待のクエリは残す", () => {
    const { win, calls } = fakeWindow("#error=access_denied&error_code=otp_expired", "?invite=abc", "/app/");
    expect(captureAuthLink(win)).toMatchObject({ kind: "error" });
    expect(calls).toEqual([[null, "", "/app/?invite=abc"]]);
  });
  it("何も付いていなければ replaceState を呼ばない", () => {
    const { win, calls } = fakeWindow("");
    expect(captureAuthLink(win)).toEqual({ kind: "none" });
    expect(calls).toEqual([]);
  });
});

describe("buildResetRedirectUrl", () => {
  it("origin と pathname だけ", () => {
    expect(buildResetRedirectUrl({ origin: "https://amp.example.com", pathname: "/" })).toBe("https://amp.example.com/");
  });
});

describe("classifyResetMailError と固定文言（登録の有無・待ち時間で結果が変わらない）", () => {
  it("エラー無し＝sent／429・rate limit は rateLimited／その他は failed", () => {
    expect(classifyResetMailError(null)).toEqual({ kind: "sent" });
    expect(classifyResetMailError({ status: 429, message: "x" })).toEqual({ kind: "rateLimited" });
    expect(classifyResetMailError({ code: "over_email_send_rate_limit", message: "x" })).toEqual({ kind: "rateLimited" });
    const err = { status: 500, message: "boom" };
    expect(classifyResetMailError(err)).toEqual({ kind: "failed", error: err });
  });
  it("sent の文言は固定で、アカウントの有無を示す語を含まない", () => {
    expect(authJa["auth.forgot.sent"]).toBe(
      "入力したメールアドレスが登録されていれば、再設定のメールを送りました。届かない場合は迷惑メールフォルダを確認し、それでも届かなければ管理者に連絡してください。",
    );
    expect(authJa["auth.forgot.sent"]).not.toMatch(/未登録|見つかりません|存在しません/);
  });
  it("LoginScreen は rateLimited でも sent と同じ文言を出す（待ち時間の表示の差を作らない）", () => {
    const src = readFileSync("src/components/auth/LoginScreen.tsx", "utf-8")
      .split("\n").filter(l => !l.trim().startsWith("//")).join("\n");
    expect(src).toMatch(/outcome\.kind === "rateLimited"\) \{\s*setForgotMessage\(t\("auth\.forgot\.sent"\)\)/);
    expect(src).not.toContain("auth.forgot.rateLimited");
  });
});

describe("validateNewPassword", () => {
  it("一致しなければ mismatch（長さより先）／6文字未満は tooShort／6文字以上は ok", () => {
    expect(validateNewPassword("abcdef", "abcdeg")).toBe("mismatch");
    expect(validateNewPassword("abcde", "abcde")).toBe("tooShort");
    expect(validateNewPassword("abcdef", "abcdef")).toBe("ok");
  });
});

describe("classifyUpdatePasswordError", () => {
  it("再認証・セッション切れ・同じパスワード・その他を分ける", () => {
    expect(classifyUpdatePasswordError({ code: "reauthentication_needed", message: "x" })).toBe("reauth");
    expect(classifyUpdatePasswordError({ message: "Password update requires reauthentication" })).toBe("reauth");
    expect(classifyUpdatePasswordError({ message: "Auth session missing!" })).toBe("session_missing");
    expect(classifyUpdatePasswordError({ code: "same_password", message: "x" })).toBe("same_password");
    expect(classifyUpdatePasswordError({ message: "New password should be different from the old password." })).toBe("same_password");
    expect(classifyUpdatePasswordError({ message: "boom" })).toBe("other");
    expect(classifyUpdatePasswordError(null)).toBe("other");
  });
  it("isReauthRequiredError は reauth と session_missing（設定ページの案内用）", () => {
    expect(isReauthRequiredError({ code: "reauthentication_needed" })).toBe(true);
    expect(isReauthRequiredError({ message: "Auth session missing!" })).toBe(true);
    expect(isReauthRequiredError({ code: "same_password" })).toBe(false);
  });
});

describe("resolveRecoveryOnStartup：起動時の URL・localStorage の印から再設定画面を出すかを決める", () => {
  const now = 1_700_000_000_000;
  const recoveryLink = parseAuthLink(`#${TOKENS}&type=recovery`, "");
  const none = { kind: "none" as const };
  const marker = (userId: string, at = now) => buildRecoveryMarker(userId, at);

  it("再設定リンクで戻ってきた起動は出す（印はまだ無くてよい）", () => {
    expect(resolveRecoveryOnStartup({ link: recoveryLink, markerRaw: null, sessionUserId: null, now }))
      .toEqual({ active: true, clearMarker: false });
  });
  it("再設定以外のリンク（signup 等）は出さない", () => {
    const link = parseAuthLink(`#${TOKENS}&type=signup`, "");
    expect(resolveRecoveryOnStartup({ link, markerRaw: null, sessionUserId: "u1", now })).toEqual({ active: false, clearMarker: false });
  });
  it("再読み込み・新しいタブ：印の user id がセッションと一致すれば出す", () => {
    expect(resolveRecoveryOnStartup({ link: none, markerRaw: marker("u1"), sessionUserId: "u1", now }))
      .toEqual({ active: true, clearMarker: false });
  });
  it("印の user id がセッションと違う・セッションが無い→出さず、印を消す", () => {
    expect(resolveRecoveryOnStartup({ link: none, markerRaw: marker("u1"), sessionUserId: "u2", now }))
      .toEqual({ active: false, clearMarker: true });
    expect(resolveRecoveryOnStartup({ link: none, markerRaw: marker("u1"), sessionUserId: null, now }))
      .toEqual({ active: false, clearMarker: true });
  });
  it("古すぎる印（24時間超）・壊れた印は出さず消す", () => {
    expect(resolveRecoveryOnStartup({ link: none, markerRaw: marker("u1", now - RECOVERY_MARKER_MAX_AGE_MS - 1), sessionUserId: "u1", now }))
      .toEqual({ active: false, clearMarker: true });
    expect(resolveRecoveryOnStartup({ link: none, markerRaw: "{broken", sessionUserId: "u1", now }))
      .toEqual({ active: false, clearMarker: true });
  });
  it("印が無く再設定でもなければ通常起動（消すものも無い）", () => {
    expect(resolveRecoveryOnStartup({ link: none, markerRaw: null, sessionUserId: "u1", now })).toEqual({ active: false, clearMarker: false });
  });
  it("印の読み書き", () => {
    expect(parseRecoveryMarker(buildRecoveryMarker("u1", 5))).toEqual({ userId: "u1", at: 5 });
    expect(parseRecoveryMarker(null)).toBeNull();
    expect(parseRecoveryMarker('{"userId":1}')).toBeNull();
  });
});

describe("resendRemainingSec", () => {
  it("送信前は0、送信直後は60、経過に応じて減り、0で止まる", () => {
    expect(resendRemainingSec(null, 1000)).toBe(0);
    expect(resendRemainingSec(1000, 1000)).toBe(RESET_RESEND_COOLDOWN_SEC);
    expect(resendRemainingSec(1000, 1000 + 30_500)).toBe(30);
    expect(resendRemainingSec(1000, 1000 + 120_000)).toBe(0);
  });
});

// ソース走査（コメント行を除いて検査する＝CLAUDE.md Section 59）
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map(l => l.replace(/^\s*\/\/.*$/, "").replace(/\s\/\/.*$/, "")).join("\n");

describe("配線の固定（ソース走査）", () => {
  const app = strip(readFileSync("src/App.tsx", "utf-8"));
  it("App.tsx：recoveryActive の分岐（if (recoveryActive) return <…AccountRecoveryScreen）が guestActive・LoginScreen・AuthenticatedApp より前", () => {
    const m = app.match(/if \(recoveryActive\) return \(\s*<>\s*<AccountRecoveryScreen/);
    expect(m).not.toBeNull();
    const rec = m!.index!;
    expect(rec).toBeLessThan(app.indexOf("if (guestActive)"));
    expect(rec).toBeLessThan(app.indexOf("<LoginScreen"));
    expect(rec).toBeLessThan(app.indexOf("<AuthenticatedApp"));
  });
  it("App.tsx：PASSWORD_RECOVERY で再設定中にし、印を書く／起動時は印と照合する", () => {
    expect(app).toMatch(/event === "PASSWORD_RECOVERY"\) \{\s*setRecoveryActive\(true\);\s*if \(session\?\.user\?\.id\) writeRecoveryMarker/);
    expect(app).toContain("resolveRecoveryOnStartup(");
    expect(app).toContain("applyInitialAuthLink()");
  });
  it("main.tsx：最初の import が initialAuthLink（他のモジュールより先に URL を控える）", () => {
    const firstImport = strip(readFileSync("src/main.tsx", "utf-8")).split("\n").find(l => l.trim().startsWith("import"));
    expect(firstImport).toContain("lib/account/initialAuthLink");
  });
  it("client.ts：detectSessionInUrl:false（URL のトークン処理は自前）で、flowType は指定しない（implicit のまま）", () => {
    const client = strip(readFileSync("src/lib/supabase/client.ts", "utf-8"));
    expect(client).toMatch(/createClient\([^)]*\{\s*auth:\s*\{\s*detectSessionInUrl:\s*false\s*\}\s*\}\)/);
    expect(client).not.toContain("flowType");
  });
  it("initialAuthLink.ts：captureAuthLink 経由（replaceState）で、location.hash への代入や pushState を使わない", () => {
    const src = strip(readFileSync("src/lib/account/initialAuthLink.ts", "utf-8"));
    expect(src).toContain("captureAuthLink(window)");
    expect(src).not.toMatch(/location\.hash\s*=|pushState/);
  });
});
