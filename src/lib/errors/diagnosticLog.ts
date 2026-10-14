// src/lib/errors/diagnosticLog.ts
//
// 画面のエラー記録（client_error_logs）へ「例外ではない診断」を1件送る入口（v3.146・CLAUDE.md Section 76）。
// lazyWithRetry（チャンク読み込み失敗）と healthMonitor（メモリ・load 連発）が使う。
// 実体は main.tsx が setDiagnosticLogger で差し込む（未設定・開発サーバー・ゲストでは何もしない）。

import type { ClientErrorInput } from "./clientErrorLog";

type Sender = (input: ClientErrorInput) => void;
let impl: Sender | null = null;

export function setDiagnosticLogger(fn: Sender | null): void {
  impl = fn;
}

export function logDiagnostic(input: ClientErrorInput): void {
  try {
    impl?.(input);
  } catch (e) {
    console.warn("[diagnosticLog] 診断の記録に失敗（再記録はしない）:", e);
  }
}
