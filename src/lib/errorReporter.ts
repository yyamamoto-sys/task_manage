// src/lib/errorReporter.ts
//
// アプリ全体のエラーをグローバルに通知するユーティリティ。
// カスタムイベント "app:error" を window に発火し、
// ErrorBar コンポーネントがリッスンして画面下部に表示する。

export interface AppError {
  message: string;
  /**
   * 画面のエラー記録（clientErrorLog）に送る用のメッセージ。PostgREST の details
   * （"Failing row contains (…)" 等、行データを含みうる）を含めない。無ければ message を使う
   * （v3.129 独立レビュー指摘・軽）。
   */
  logMessage?: string;
  code?: string;
  context?: string;   // どの操作で発生したか（例: "プロジェクト保存"）
  timestamp: string;  // ISO8601
  raw?: unknown;      // 元のエラーオブジェクト（コピー用）
}

export function reportError(error: unknown, context?: string) {
  const timestamp = new Date().toISOString();

  let message = "不明なエラー";
  let logMessage: string | undefined;
  let code: string | undefined;

  if (error instanceof Error) {
    message = error.message;
  } else if (error != null && typeof error === "object") {
    const e = error as Record<string, unknown>;
    if (typeof e.message === "string") message = e.message;
    if (typeof e.code    === "string") code    = e.code;
    // details（PostgREST の "Failing row contains (…)" 等、行データを含みうる）は画面表示には足すが、
    // エラー記録（logMessage）には含めない
    logMessage = message;
    if (typeof e.details === "string" && !message.includes(e.details as string)) {
      message += ` — ${e.details}`;
    }
  } else if (typeof error === "string") {
    message = error;
  }

  const appError: AppError = { message, logMessage, code, context, timestamp, raw: error };
  window.dispatchEvent(new CustomEvent<AppError>("app:error", { detail: appError }));
}
