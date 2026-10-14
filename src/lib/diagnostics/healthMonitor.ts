// src/lib/diagnostics/healthMonitor.ts
//
// 「だんだん重くなる・ブラックアウト」の原因を切り分けるための軽い計測（v3.146・CLAUDE.md Section 76）。
// 5分ごとに ① JS ヒープ（Chrome の performance.memory のみ）② load() の実行回数 を見て、
// 閾値を超えたら client_error_logs へセッション中それぞれ1回だけ記録する。
// 記録は診断の入口（logDiagnostic）経由。source は既存の CHECK 制約に合う "report"、
// fingerprint は code ごとに束ねる（clientErrorLog.computeFingerprint の DIAGNOSTIC_CODES）。

import type { ClientErrorInput } from "../errors/clientErrorLog";

export const HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000;
export const MEMORY_HIGH_BYTES = 700 * 1024 * 1024;
export const LOAD_BURST_WINDOW_MS = 10 * 60 * 1000;
export const LOAD_BURST_LIMIT = 10;

export interface HealthMonitorDeps {
  log: (input: ClientErrorInput) => void;
  now: () => number;
  heapBytes: () => number | null;
  screen: () => string | null;
  loadTotal: () => number;
  loadsWithin: (windowMs: number) => number;
  isGuest: () => boolean;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
}

/** Chrome 以外（performance.memory が無い）は null＝何もしない */
export function readHeapBytes(perf: unknown = typeof performance !== "undefined" ? performance : undefined): number | null {
  const used = (perf as { memory?: { usedJSHeapSize?: unknown } } | undefined)?.memory?.usedJSHeapSize;
  return typeof used === "number" && Number.isFinite(used) ? used : null;
}

/** 開始する。返り値の関数でタイマーを解除する（アンマウント時に必ず呼ぶ） */
export function startHealthMonitor(deps: HealthMonitorDeps): () => void {
  const startedAt = deps.now();
  let memoryReported = false;
  let burstReported = false;

  const tick = () => {
    if (deps.isGuest()) return;
    const elapsedMin = Math.round((deps.now() - startedAt) / 60000);
    const tail = `経過${elapsedMin}分 / 画面:${deps.screen() ?? "不明"} / load累計${deps.loadTotal()}回`;

    const heap = deps.heapBytes();
    if (!memoryReported && heap !== null && heap >= MEMORY_HIGH_BYTES) {
      memoryReported = true;
      const mb = Math.round(heap / 1024 / 1024);
      deps.log({ source: "report", code: "memory-high", message: "JSヒープのメモリ使用量が閾値を超えました", context: `${mb}MB / ${tail}` });
    }

    const loads = deps.loadsWithin(LOAD_BURST_WINDOW_MS);
    if (!burstReported && loads > LOAD_BURST_LIMIT) {
      burstReported = true;
      deps.log({ source: "report", code: "load-burst", message: "短時間にデータの全件再取得（load）が多数回走りました", context: `10分間に${loads}回 / ${tail}` });
    }
  };

  const handle = deps.setInterval(tick, HEALTH_CHECK_INTERVAL_MS);
  return () => deps.clearInterval(handle);
}
