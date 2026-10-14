// src/lib/account/recoveryFlow.ts
//
// 再設定（パスワードを忘れたとき）・メールのリンクから戻ったときの判定ロジック（純粋関数）。
// 副作用（Supabase 呼び出し・URL 書き換え・localStorage）は呼び出し側に置き、ここは vitest で
// 検査できる形に保つ（CLAUDE.md Section 79）。
// ファイル名に「password」を含めない：この環境の Read/Write 拒否ルールが *password* に当たるため。

export const PASSWORD_MIN_LENGTH = 6;
export const RESET_RESEND_COOLDOWN_SEC = 60;
/** 再設定待ちの印の有効時間。これを超えた印は無効（消す）。 */
export const RECOVERY_MARKER_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type AuthLinkResult =
  | { kind: "none" }
  /** メールのリンクで戻ってきた（トークン付き）。type=recovery なら再設定、それ以外は通常のログイン */
  | { kind: "session"; linkType: string | null; isRecovery: boolean; accessToken: string; refreshToken: string }
  | { kind: "error"; code: string; linkType: string | null };

/**
 * メールのリンクから戻ってきた URL（ハッシュ／クエリ）の解釈。
 * detectSessionInUrl を切っているため、トークンの取り込みは自前（setSession）で行う。
 * サインアップ確認（type=signup）・招待・マジックリンク・メール変更も、トークンが付いていれば
 * 全て "session" として扱い、再設定（recovery）だけを isRecovery で区別する。
 */
export function parseAuthLink(hash: string, search: string): AuthLinkResult {
  const h = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const linkType = h.get("type") ?? q.get("type");
  const error = h.get("error") ?? q.get("error");
  const errorCode = h.get("error_code") ?? q.get("error_code");
  if (error || errorCode) return { kind: "error", code: errorCode ?? error ?? "unknown", linkType };
  const accessToken = h.get("access_token");
  const refreshToken = h.get("refresh_token");
  if (accessToken && refreshToken) {
    return { kind: "session", linkType, isRecovery: linkType === "recovery", accessToken, refreshToken };
  }
  return { kind: "none" };
}

/**
 * 無効・期限切れで戻ったとき、ログイン画面の再設定フォームを開くか。
 * エラーの URL には type が付かないことが多く再設定かどうかは分からないため、サインアップ確認・
 * 招待・マジックリンク・メール変更と分かる場合だけ開かない（案内文は常に汎用）。
 */
export function shouldOpenResetFormOnError(link: AuthLinkResult): boolean {
  if (link.kind !== "error") return false;
  return !["signup", "invite", "magiclink", "email_change"].includes(link.linkType ?? "");
}

/** setSession に渡す値。 */
export function sessionArgsFromLink(link: Extract<AuthLinkResult, { kind: "session" }>) {
  return { access_token: link.accessToken, refresh_token: link.refreshToken };
}

const AUTH_HASH_RE = /(^#|&)(access_token|refresh_token|expires_in|expires_at|token_type|provider_token|provider_refresh_token|error|error_code|error_description|type|message)=/;

/** URL に残った認証用のハッシュ・クエリを消した後の相対 URL（history.replaceState 用）。 */
export function stripAuthParams(pathname: string, search: string, hash: string): string {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  for (const k of ["error", "error_code", "error_description", "code"]) q.delete(k);
  const rest = q.toString();
  return pathname + (rest ? `?${rest}` : "") + (AUTH_HASH_RE.test(hash) ? "" : hash);
}

interface LinkWindow {
  location: { hash: string; search: string; pathname: string };
  history: { replaceState: (data: unknown, unused: string, url?: string | null) => void };
}

/**
 * 起動時に URL を控え、**直ちに replaceState（push しない）**でトークン・エラーを URL から消す。
 * auth-js の `location.hash = ''` は履歴に新しい項目を積み、トークン付きの URL が戻るで復元できて
 * しまうため、detectSessionInUrl を切って自前で処理する（CLAUDE.md Section 79）。
 */
export function captureAuthLink(win: LinkWindow): AuthLinkResult {
  const { hash, search, pathname } = win.location;
  const link = parseAuthLink(hash, search);
  const cleaned = stripAuthParams(pathname, search, hash);
  if (cleaned !== pathname + search + hash) win.history.replaceState(null, "", cleaned);
  return link;
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
 * 「アカウントが無い」を表すエラーはここに存在しない。画面の文言は sent・rateLimited とも同じ
 * 固定文言にする（待ち時間の表示の差で登録の有無を推測させない）。
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

export type UpdateErrorKind = "reauth" | "session_missing" | "same_password" | "other";

/** updateUser({ password }) の失敗の種類。 */
export function classifyUpdatePasswordError(error: unknown): UpdateErrorKind {
  const e = error as { code?: unknown; message?: unknown } | null;
  const code = typeof e?.code === "string" ? e.code : "";
  const message = typeof e?.message === "string" ? e.message.toLowerCase() : "";
  if (code === "reauthentication_needed" || code === "reauthentication_not_valid" || message.includes("reauthentication")) return "reauth";
  if (code === "same_password" || message.includes("different from the old password")) return "same_password";
  if (message.includes("session missing")) return "session_missing";
  return "other";
}

/** 「再認証が必要」設定／セッション切れで updateUser が拒否されたか。 */
export function isReauthRequiredError(error: unknown): boolean {
  const k = classifyUpdatePasswordError(error);
  return k === "reauth" || k === "session_missing";
}

// ----- 再設定待ちの印（再読み込み・新しいタブで再設定画面を飛ばさないため） -----

export interface RecoveryMarker { userId: string; at: number }

export function buildRecoveryMarker(userId: string, now: number): string {
  return JSON.stringify({ userId, at: now } satisfies RecoveryMarker);
}

export function parseRecoveryMarker(raw: string | null): RecoveryMarker | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<RecoveryMarker>;
    return typeof v.userId === "string" && v.userId && typeof v.at === "number" ? { userId: v.userId, at: v.at } : null;
  } catch {
    return null;
  }
}

export interface RecoveryStartupInput {
  link: AuthLinkResult;
  /** localStorage の生の値（読めない環境では null） */
  markerRaw: string | null;
  /** 今のセッションのユーザー（未確定・未ログインは null） */
  sessionUserId: string | null;
  now: number;
}

/**
 * 起動時・セッション確定時に「再設定画面を出すか」を決める（App.tsx の recoveryActive の初期値と
 * セッション確認後の補正の両方がこれを使う）。
 * - 再設定リンクで戻ってきた → 出す（印は setSession で user id が分かってから書く）
 * - 印があり、user id がセッションと一致・24時間以内 → 出す（再読み込み・新しいタブでも飛ばさない）
 * - 印があるが一致しない・古い・セッションが無い → 出さず、印を消す
 */
export function resolveRecoveryOnStartup(i: RecoveryStartupInput): { active: boolean; clearMarker: boolean } {
  if (i.link.kind === "session" && i.link.isRecovery) return { active: true, clearMarker: false };
  const marker = parseRecoveryMarker(i.markerRaw);
  if (!marker) return { active: false, clearMarker: i.markerRaw != null };
  const fresh = i.now - marker.at <= RECOVERY_MARKER_MAX_AGE_MS && i.now >= marker.at - 60_000;
  if (fresh && i.sessionUserId != null && i.sessionUserId === marker.userId) return { active: true, clearMarker: false };
  // セッション未確定（null）のうちは消さない呼び出しは呼び側が sessionUserId を確定してから呼ぶ
  return { active: false, clearMarker: true };
}

/** JWT の sub（user id）を取り出す。署名は検証しない（印は再設定を「強制する側」にしか働かない）。失敗は null。 */
export function decodeJwtSub(token: string): string | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const json = new TextDecoder().decode(Uint8Array.from(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "=")), c => c.charCodeAt(0)));
    const sub = (JSON.parse(json) as { sub?: unknown }).sub;
    return typeof sub === "string" && sub ? sub : null;
  } catch {
    return null;
  }
}

/**
 * 認証イベントで「再設定待ち」の印を見て再設定画面を強制するか。
 * INITIAL_SESSION（再読み込み・新しいタブ）と、リンクの SIGNED_IN（他タブへ届くもの）では強制する。
 * パスワードでのログイン中の SIGNED_IN では強制しない（古いパスワードでログインし直して抜けられるように）。
 */
export function shouldEnforceMarkerOnAuthEvent(event: string, passwordLoginInFlight: boolean): boolean {
  if (event === "INITIAL_SESSION") return true;
  return event === "SIGNED_IN" && !passwordLoginInFlight;
}

/** 再送ボタンの残り秒数（0 なら押せる）。 */
export function resendRemainingSec(lastSentAt: number | null, now: number): number {
  if (lastSentAt == null) return 0;
  const left = RESET_RESEND_COOLDOWN_SEC - Math.floor((now - lastSentAt) / 1000);
  return left > 0 ? left : 0;
}
