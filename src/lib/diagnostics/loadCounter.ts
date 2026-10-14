// src/lib/diagnostics/loadCounter.ts
//
// appStore.load()（全テーブルの再取得）が実際に走った回数を数える。計測用（v3.146・CLAUDE.md Section 76）。
// 配列は上限つき（古いものから捨てる）＝計測自体が溜まり続けない。

const MAX_KEPT = 200;
let total = 0;
let times: number[] = [];

export function recordLoad(now: number = Date.now()): void {
  total++;
  times.push(now);
  if (times.length > MAX_KEPT) times = times.slice(times.length - MAX_KEPT);
}

export function getLoadTotal(): number {
  return total;
}

export function countLoadsWithin(windowMs: number, now: number = Date.now()): number {
  return times.filter(t => now - t <= windowMs).length;
}

export function _resetLoadCounterForTest(): void {
  total = 0;
  times = [];
}
