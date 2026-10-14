// src/lib/lazyWithRetry.ts
//
// 【設計意図（v3.146で全面改訂・CLAUDE.md Section 76）】
// React.lazy で読み込む動的 import のチャンクファイル名は Vite のビルドごとにハッシュが変わる。
// 再デプロイ後、古い index.html を開いたままのタブが lazy 画面を開くと、もう存在しないチャンクを
// fetch して "Failed to fetch dynamically imported module" になる。
//
// 旧実装は失敗のたびに黙って window.location.reload() していた。これは
//  - 未保存の編集が無警告で消える
//  - 画面（チャンク）ごとにフラグが別なので、色々な画面を開くたびに連続でリロードされる
//  - 記録に残らず（無視リスト）頻度が分からない
// という問題があった。現在は **reload しない**：
//  1. 失敗したら1回だけ自動で再取得する（一時的な通信エラーなら直る）
//  2. それでも失敗なら、その画面の位置に ChunkLoadFailed（再読み込みの案内）を出し、全体バナー
//     （ReloadNoticeBanner）にも知らせる。再読み込みは利用者が押したときだけ（未保存は確認）
//  3. client_error_logs へ code="chunk-load" で画面ごとに1回だけ記録する
// 失敗は例外として外へ出さない（ErrorBoundary・unhandledrejection に二重に流れない）。

import { lazy } from "react";
import type { ComponentType, LazyExoticComponent } from "react";
import { ChunkLoadFailed } from "../components/common/ChunkLoadFailed";
import { logDiagnostic } from "./errors/diagnosticLog";
import { APP_VERSION } from "./version";
import { CHUNK_LOAD_FAILED_EVENT } from "./reloadNotice";

export const CHUNK_RETRY_DELAY_MS = 1000;

export interface ChunkLoadDeps {
  wait: (ms: number) => Promise<void>;
  /** 画面名ごとに1回だけ記録する側（呼び出し側が重複を除く） */
  report: (name: string, err: unknown) => void;
  notify: () => void;
}

export async function loadChunkOrFallback<T>(
  factory: () => Promise<{ default: T }>,
  name: string,
  fallback: T,
  deps: ChunkLoadDeps,
): Promise<{ default: T }> {
  try {
    return await factory();
  } catch {
    // 一時的な通信エラーの可能性があるので、1回だけ待って再取得する
  }
  await deps.wait(CHUNK_RETRY_DELAY_MS);
  try {
    return await factory();
  } catch (err) {
    deps.report(name, err);
    deps.notify();
    return { default: fallback };
  }
}

const reportedNames = new Set<string>();

export function reportChunkLoadFailure(name: string, err: unknown): void {
  if (reportedNames.has(name)) return;
  reportedNames.add(name);
  // URL（ハッシュ付きファイル名）は伏せ字の対象外なので、メッセージには入れずスタックの先頭だけ残す
  const detail = err instanceof Error ? err.message : String(err);
  logDiagnostic({
    source: "report",
    code: "chunk-load",
    message: "画面の読み込みに失敗しました（新しい版が公開された可能性）",
    context: `chunk-load:${name} v${APP_VERSION}`,
    stack: detail,
  });
}

export function _resetChunkReportForTest(): void {
  reportedNames.clear();
}

const defaultDeps: ChunkLoadDeps = {
  wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
  report: reportChunkLoadFailure,
  notify: () => {
    if (typeof window !== "undefined") window.dispatchEvent(new Event(CHUNK_LOAD_FAILED_EVENT));
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
  name: string,
): LazyExoticComponent<T> {
  return lazy(() => loadChunkOrFallback(factory, name, ChunkLoadFailed as unknown as T, defaultDeps));
}
