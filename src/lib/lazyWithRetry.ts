// src/lib/lazyWithRetry.ts
//
// 【設計意図（v3.146で全面改訂・v3.163で再改訂・CLAUDE.md Section 76）】
// React.lazy で読み込む動的 import のチャンクファイル名は Vite のビルドごとにハッシュが変わる。
// 再デプロイ後、古い index.html を開いたままのタブが未読込の lazy 画面を開くと、もう存在しないチャンクを
// fetch して "Failed to fetch dynamically imported module" になる（Vercel Hobby は Skew Protection が無い）。
//
// 対策は二段構え：
//  1. 【本命】ログイン後に全画面のチャンクを1本ずつ先読みしておく（prefetchAllChunks）。一度解決した
//     モジュールはタブ内に残るので、その後にデプロイがあっても古いタブが壊れない。
//  2. それでも失敗したとき（先読み完了前に新版が出た等）：
//     - 1回だけ待って再取得する（一時的な通信エラーなら直る）
//     - 安全な状況（未保存・入力中・モーダル・AI会話中・ゲストのいずれでもなく、直近1分に自動再読み込みして
//       いない）なら黙って reload する（画面遷移と同じ扱い。判定は chunkRecovery.ts）
//     - 安全でなければ、その画面の位置だけに ChunkLoadFailed（再読み込みの案内）を出す。全体バナーは出さない
//     - client_error_logs へ code="chunk-load" で画面ごとに1回だけ記録する
// 失敗は例外として外へ出さない（ErrorBoundary・unhandledrejection に二重に流れない）。

import { lazy } from "react";
import type { ComponentType, LazyExoticComponent } from "react";
import { ChunkLoadFailed } from "../components/common/ChunkLoadFailed";
import { logDiagnostic } from "./errors/diagnosticLog";
import { APP_VERSION } from "./version";
import { attemptChunkRecoveryReload, defaultChunkRecoveryDeps } from "./chunkRecovery";

export const CHUNK_RETRY_DELAY_MS = 1000;
/** 先読みの1本ごとの間隔（回線・描画を占有しない） */
export const PREFETCH_GAP_MS = 150;

export interface ChunkLoadDeps {
  wait: (ms: number) => Promise<void>;
  /** 画面名ごとに1回だけ記録する側（呼び出し側が重複を除く） */
  report: (name: string, err: unknown) => void;
  /** 安全なら黙って再読み込みを始めて true を返す。しなかったら false */
  tryReload: () => boolean;
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
    if (deps.tryReload()) {
      // 再読み込みが始まるので、画面は読み込み中のまま（案内を一瞬出さない）
      return new Promise<{ default: T }>(() => {});
    }
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

export const defaultChunkDeps: ChunkLoadDeps = {
  wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
  report: reportChunkLoadFailure,
  tryReload: () => typeof window !== "undefined" && attemptChunkRecoveryReload(defaultChunkRecoveryDeps),
};

// ---- 先読み ----

interface RegisteredChunk {
  name: string;
  factory: () => Promise<unknown>;
}

const registry: RegisteredChunk[] = [];

function register(name: string, factory: () => Promise<unknown>): void {
  if (registry.some(r => r.name === name)) return;
  registry.push({ name, factory });
}

/** lazyWithRetry を通さない動的 import（添付解析系など）も先読みの対象に登録する */
export function registerPrefetchChunk(name: string, factory: () => Promise<unknown>): void {
  register(name, factory);
}

export function registeredChunkNames(): string[] {
  return registry.map(r => r.name);
}

export function _resetPrefetchRegistryForTest(): void {
  registry.length = 0;
}

export interface PrefetchDeps {
  pause: (ms: number) => Promise<void>;
  debug: (name: string, err: unknown) => void;
}

const defaultPrefetchDeps: PrefetchDeps = {
  pause: ms => new Promise(resolve => setTimeout(resolve, ms)),
  // 先読みの失敗は client_error_logs に記録しない（利用者の操作に影響しないため）
  debug: (name, err) => console.debug(`[prefetch] ${name} を先読みできませんでした`, err),
};

/**
 * 登録済みの全チャンクを登録順に1本ずつ読み込む。1本の失敗で止めない。
 * 戻り値は成功した本数。
 */
export async function prefetchAllChunks(deps: PrefetchDeps = defaultPrefetchDeps): Promise<number> {
  let ok = 0;
  for (const { name, factory } of [...registry]) {
    try {
      await factory();
      ok++;
    } catch (err) {
      deps.debug(name, err);
    }
    await deps.pause(PREFETCH_GAP_MS);
  }
  return ok;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
  name: string,
): LazyExoticComponent<T> {
  register(name, factory);
  return lazy(() => loadChunkOrFallback(factory, name, ChunkLoadFailed as unknown as T, defaultChunkDeps));
}
