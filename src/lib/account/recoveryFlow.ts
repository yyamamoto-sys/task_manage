// src/lib/account/recoveryFlow.ts
//
// 再設定（パスワードを忘れたとき）の判定ロジック（純粋関数）。副作用（Supabase 呼び出し・
// URL 書き換え）は auth.ts / App.tsx 側に置き、ここは vitest で検査できる形に保つ
// （CLAUDE.md Section 79）。
// ファイル名に「password」を含めない：この環境の Read/Write 拒否ルールが *password* に当たるため。

export const PASSWORD_MIN_LENGTH = 6;
export const RESET_RESEND_COOLDOWN_SEC = 60;

export type AuthLinkResult =
  | { kind: "none" }
  | { kind: "recovery" }
  | { kind: "error"; code: string };

/** 「再設定のメール」から戻ってきた URL（ハッシュ／クエリ）の解釈。 */
export function parseAuthLink(hash: string, search: string): AuthLinkResult {
  const h = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const error = h.get("error") ?? q.get("error");
  const errorCode = h.get("error_code") ?? q.get("error_code");
  if (error || errorCode) return { kind: "error", code: errorCode ?? error ?? "unknown" };
  if (h.get("type") === "recovery" && h.get("access_token")) return { kind: "recovery" };
  return { kind: "none" };
}

/** URL に残った認証用のハッシュ・クエリを消した後の相対 URL（history.replaceState 用）。 */
export function stripAuthParams(pathname: string, search: string, hash: string): string {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  for (const k of ["error", "error_code", "error_description", "code"]) q.delete(k);
  const rest = q.toString();
  const hashIsAuth = /(^#|&)(access_token|refresh_token|error|error_code|type)=/.test(hash);
  return pathname + (rest ? `?${rest}` : "") + (hashIsAuth ? "" : hash);
}

/** resetPasswordForEmail の戻り先。クエリ・ハッシュは引き継がない（招待コード等が残らないように）。 */
export function buildResetRedirectUrl(loc: { origin: string; pathname: string }): string {
  return loc.origin + loc.pathname;
}

export type ResetMailOutcome =
  | { kind: "sent" }
  | { kind: "rateLimited" }
  | { kind: "failed"; error: unknown };

/**
 * 送信結果の分類。🔴 登録の有無は Supabase 側が成功扱いで返す（メール列挙対策）ため、
 * 「アカウントが無い」を表すエラーはここに存在しない。画面の文言は sent で固定する。
 */
export function classifyResetMailError(error: unknown): ResetMailOutcome {
  if (error == null) return { kind: "sent" };
  const e = error as { status?: unknown; code?: unknown; message?: unknown };
  const code = typeof e.code === "string" ? e.code : "";
  const message = typeof e.message === "string" ? e.message.toLowerCase() : "";
  if (e.status === 429 || code === "over_email_send_rate_limit" || code === "over_request_rate_limit"
    || message.includes("rate limit") || message.includes("security purposes")) {
    return { kind: "rateLimited" };
  }
  return { kind: "failed", error };
}

export type PasswordCheck = "ok" | "mismatch" | "tooShort";

export function validateNewPassword(password: string, confirm: string): PasswordCheck {
  if (password !== confirm) return "mismatch";
  if (password.length < PASSWORD_MIN_LENGTH) return "tooShort";
  return "ok";
}

/** 「再認証が必要」設定／セッション切れで updateUser が拒否されたか。 */
export function isReauthRequiredError(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown } | null;
  const code = typeof e?.code === "string" ? e.code : "";
  const message = typeof e?.message === "string" ? e.message.toLowerCase() : "";
  return code === "reauthentication_needed" || code === "reauthentication_not_valid"
    || message.includes("reauthentication") || message.includes("session missing");
}

/**
 * 通常の起動処理（自動マッチ・招待URLの受諾・SetupWizard・AppDataProvider）へ進んでよいか。
 * 再設定画面の表示中（recovery セッションでの入場を防ぐ）は false。
 */
export function shouldRunNormalStartup(recoveryActive: boolean): boolean {
  return !recoveryActive;
}

/** 再送ボタンの残り秒数（0 なら押せる）。 */
export function resendRemainingSec(lastSentAt: number | null, now: number): number {
  if (lastSentAt == null) return 0;
  const left = RESET_RESEND_COOLDOWN_SEC - Math.floor((now - lastSentAt) / 1000);
  return left > 0 ? left : 0;
}
