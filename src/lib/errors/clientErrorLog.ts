// src/lib/errors/clientErrorLog.ts
//
// 利用者の画面に出たエラーを super_admin 向けに記録する（v3.129・CLAUDE.md Section 67）。
// 拾うもの：reportError()（"app:error"。ErrorBoundary のクラッシュもここを通る）・window の error・unhandledrejection。
// 送り先：RPC log_client_error（同じエラーは fingerprint で1行にまとめ、回数を数える）。
//
// 🔴 無限ループ防止：記録の RPC が失敗しても reportError は呼ばない（console.warn のみ）。送信中に起きた
//    エラーは拾わない。送信の Promise は必ず catch する（unhandledrejection に戻ってこないように）。
// 🔴 送る内容を絞る：message・stack・context は長さを切り詰め、メールアドレス・トークンらしき文字列を伏せる
//    （DB 側の redact_client_error_text でも同じことをする）。入力欄の内容・リクエスト本文は送らない
//    （AppError.raw は送らない）。

import type { AppError } from "../errorReporter";

export type ClientErrorSource = "report" | "boundary" | "window" | "promise";

export const MAX_MESSAGE_CHARS = 500;
export const MAX_STACK_CHARS = 2000;
export const MAX_CONTEXT_CHARS = 200;
/** 同じ fingerprint をこのタブから送る最短間隔（DB 側も1人1分に1回） */
export const SAME_FINGERPRINT_INTERVAL_MS = 60_000;
/** このタブから1時間に送る上限（DB 側は1人1時間に新しい fingerprint 50件） */
export const MAX_SENDS_PER_HOUR = 30;

/** 記録しない既知の無害なエラー */
const IGNORED_MESSAGE_PATTERNS: readonly RegExp[] = [
  /ResizeObserver loop/i,
  /^Script error\.?$/i,
];

/** メールアドレス・JWT・Bearer トークン・長い英数字の塊を伏せる（DB の redact_client_error_text と同じ規則） */
export function redactSensitive(text: string): string {
  return text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, "[token]")
    .replace(/([Bb]earer)\s+[A-Za-z0-9._~+/=-]+/g, "$1 [token]")
    .replace(/[A-Za-z0-9+/_-]{40,}/g, "[redacted]");
}

export function truncateText(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max).join("") : text;
}

export function sanitizeText(text: string | null | undefined, max: number): string {
  return truncateText(redactSensitive(text ?? ""), max);
}

/** 同じエラーを1件にまとめるための正規化：数字・UUID・引用符の中身・URL のクエリを置き換える */
export function normalizeForFingerprint(text: string): string {
  return text
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
    .replace(/\?[^\s"']*/g, "?<q>")
    .replace(/"[^"]*"|'[^']*'|「[^」]*」/g, "<str>")
    .replace(/\d+/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** FNV-1a（32bit）を種違いで2回＝16桁の16進。暗号用途ではなく「同じエラーか」の判定用 */
function fnv1a32(text: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function computeFingerprint(input: { source: ClientErrorSource; code?: string | null; message: string; context?: string | null }): string {
  // ErrorBoundary の context はコンポーネントの位置を含むので、まとめ方には「ErrorBoundary」だけを使う
  const contextKey = input.source === "boundary" ? "boundary" : normalizeForFingerprint(input.context ?? "");
  const key = [input.source, (input.code ?? "").toLowerCase(), normalizeForFingerprint(input.message), contextKey].join("|");
  const a = fnv1a32(key, 0x811c9dc5).toString(16).padStart(8, "0");
  const b = fnv1a32(key, 0x01000193).toString(16).padStart(8, "0");
  return `${a}${b}`;
}

export interface ClientErrorPayload {
  p_fingerprint: string;
  p_source: ClientErrorSource;
  p_message: string;
  p_code: string | null;
  p_context: string | null;
  p_stack: string | null;
  p_route: string | null;
  p_screen: string | null;
  p_app_version: string | null;
  p_user_agent: string | null;
}

export interface ClientErrorInput {
  source: ClientErrorSource;
  message: string;
  code?: string | null;
  context?: string | null;
  stack?: string | null;
}

export interface ClientErrorEnv {
  route: string | null;
  screen: string | null;
  appVersion: string | null;
  userAgent: string | null;
}

export function isIgnoredError(message: string): boolean {
  return IGNORED_MESSAGE_PATTERNS.some((re) => re.test(message.trim()));
}

/** 送る行を作る。伏せ字・切り詰めのあとで fingerprint を計算する（DB に残る文字列と一致させるため） */
export function buildClientErrorPayload(input: ClientErrorInput, env: ClientErrorEnv): ClientErrorPayload {
  const message = sanitizeText(input.message, MAX_MESSAGE_CHARS) || "（メッセージなし）";
  const code = input.code ? sanitizeText(input.code, 60) : null;
  const context = input.context ? sanitizeText(input.context, MAX_CONTEXT_CHARS) : null;
  return {
    p_fingerprint: computeFingerprint({ source: input.source, code, message, context }),
    p_source: input.source,
    p_message: message,
    p_code: code,
    p_context: context,
    p_stack: input.stack ? sanitizeText(input.stack, MAX_STACK_CHARS) : null,
    p_route: env.route ? sanitizeText(env.route, 200) : null,
    p_screen: env.screen ? sanitizeText(env.screen, 60) : null,
    p_app_version: env.appVersion ? truncateText(env.appVersion, 20) : null,
    p_user_agent: env.userAgent ? truncateText(env.userAgent, 300) : null,
  };
}

/** reportError（"app:error"）の中身を記録の入力に変える。raw（元のエラー）は stack を取り出すだけで送らない */
export function inputFromAppError(err: AppError): ClientErrorInput {
  const isBoundary = (err.context ?? "").startsWith("ErrorBoundary");
  const raw = err.raw;
  const stack = raw instanceof Error ? raw.stack ?? null : null;
  return { source: isBoundary ? "boundary" : "report", message: err.message, code: err.code ?? null, context: err.context ?? null, stack };
}

export function inputFromUnknown(source: "window" | "promise", reason: unknown): ClientErrorInput {
  if (reason instanceof Error) return { source, message: `${reason.name}: ${reason.message}`, stack: reason.stack ?? null };
  if (typeof reason === "string") return { source, message: reason };
  if (reason && typeof reason === "object") {
    const r = reason as Record<string, unknown>;
    if (typeof r.message === "string") return { source, message: r.message, code: typeof r.code === "string" ? r.code : null };
  }
  return { source, message: "不明なエラー" };
}

/** 送信の間引き（このタブ単位）。同じ fingerprint は1分に1回、1時間の総数に上限 */
export function createSendThrottle(opts: { intervalMs?: number; maxPerHour?: number } = {}) {
  const intervalMs = opts.intervalMs ?? SAME_FINGERPRINT_INTERVAL_MS;
  const maxPerHour = opts.maxPerHour ?? MAX_SENDS_PER_HOUR;
  const lastByFingerprint = new Map<string, number>();
  let sentTimes: number[] = [];
  return {
    allow(fingerprint: string, now: number): boolean {
      const last = lastByFingerprint.get(fingerprint);
      if (last !== undefined && now - last < intervalMs) return false;
      sentTimes = sentTimes.filter((t) => now - t < 60 * 60 * 1000);
      if (sentTimes.length >= maxPerHour) return false;
      lastByFingerprint.set(fingerprint, now);
      sentTimes.push(now);
      return true;
    },
  };
}

// ===== 画面名（MainLayout が表示中の画面を知らせる） =====
let currentScreen: string | null = null;
export function setClientErrorScreen(name: string | null): void {
  currentScreen = name;
}
export function getClientErrorScreen(): string | null {
  return currentScreen;
}

// ===== 取り付け（main.tsx から1回だけ） =====

export interface ClientErrorLoggingDeps {
  /** RPC を呼ぶ。ログイン済みの登録メンバーでなければ false を返して送らない */
  send: (payload: ClientErrorPayload) => Promise<void>;
  canSend: () => Promise<boolean>;
  env: () => ClientErrorEnv;
  now?: () => number;
  target?: Pick<Window, "addEventListener" | "removeEventListener">;
}

export function installClientErrorLogging(deps: ClientErrorLoggingDeps): () => void {
  const target = deps.target ?? window;
  const now = deps.now ?? (() => Date.now());
  const throttle = createSendThrottle();
  let inRecord = false;

  const record = (input: ClientErrorInput) => {
    // 記録の処理の中から同期的に戻ってきたエラーは拾わない（失敗→記録→失敗…の連鎖を断つ）。
    // 非同期の送信の失敗は下の catch で握り、reportError も再記録もしない。
    if (inRecord) return;
    inRecord = true;
    try {
      if (isIgnoredError(input.message)) return;
      const payload = buildClientErrorPayload(input, deps.env());
      if (!throttle.allow(payload.p_fingerprint, now())) return;
      void (async () => {
        try {
          if (await deps.canSend()) await deps.send(payload);
        } catch (e) {
          console.warn("[clientErrorLog] エラーの記録に失敗（再記録はしない）:", e);
        }
      })();
    } catch (e) {
      console.warn("[clientErrorLog] エラーの記録の準備に失敗:", e);
    } finally {
      inRecord = false;
    }
  };

  const onAppError = (e: Event) => {
    const detail = (e as CustomEvent<AppError>).detail;
    if (detail) record(inputFromAppError(detail));
  };
  const onWindowError = (e: Event) => {
    const ev = e as ErrorEvent;
    // 画像・スクリプトの読み込み失敗（ErrorEvent でない error）は対象外
    if (typeof ev.message !== "string") return;
    record(ev.error !== undefined && ev.error !== null ? inputFromUnknown("window", ev.error) : { source: "window", message: ev.message });
  };
  const onRejection = (e: Event) => {
    record(inputFromUnknown("promise", (e as PromiseRejectionEvent).reason));
  };

  target.addEventListener("app:error", onAppError);
  target.addEventListener("error", onWindowError);
  target.addEventListener("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener("app:error", onAppError);
    target.removeEventListener("error", onWindowError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}
