// src/lib/prefetchChunks.ts
//
// 【設計意図・v3.163（CLAUDE.md Section 76）】
// ログイン後の初回描画が落ち着いたら、全画面のチャンク（lazyWithRetry の登録簿）と、添付解析系の
// 生の動的 import を低優先で1本ずつ先読みする。一度解決したモジュールはタブ内に残るため、その後に
// デプロイがあっても古いタブが 404 で壊れない。デモデータセット（lib/demo/*）と i18n の英語辞書は
// 使う人が限られるので対象外。開発サーバーでは走らせない。

import { registerPrefetchChunk, prefetchAllChunks } from "./lazyWithRetry";

registerPrefetchChunk("docxText", () => import("./docxText"));
registerPrefetchChunk("xlsxText", () => import("./xlsxText"));
registerPrefetchChunk("pptxText", () => import("./pptxText"));
registerPrefetchChunk("htmlText", () => import("./htmlText"));
registerPrefetchChunk("pdfAttachment", () => import("./pdfAttachment"));
registerPrefetchChunk("pdfText", () => import("./pdfText"));

export const PREFETCH_START_DELAY_MS = 4000;
export const PREFETCH_IDLE_TIMEOUT_MS = 10000;

let started = false;

export function startChunkPrefetch(): void {
  if (started || import.meta.env.DEV || typeof window === "undefined") return;
  started = true;
  window.setTimeout(() => {
    const run = (): void => { void prefetchAllChunks(); };
    const ric = (window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    }).requestIdleCallback;
    if (ric) ric(run, { timeout: PREFETCH_IDLE_TIMEOUT_MS });
    else run();
  }, PREFETCH_START_DELAY_MS);
}
