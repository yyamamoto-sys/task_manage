// 計測の仕組み（v3.146・CLAUDE.md Section 76）：セッション中1回・ゲストでは動かない・タイマー解除・heap が無ければ何もしない。
import { describe, it, expect, vi } from "vitest";
import { startHealthMonitor, readHeapBytes, HEALTH_CHECK_INTERVAL_MS, MEMORY_HIGH_BYTES, LOAD_BURST_LIMIT, type HealthMonitorDeps } from "../healthMonitor";
import { buildClientErrorPayload } from "../../errors/clientErrorLog";

function setup(over: Partial<HealthMonitorDeps> = {}) {
  let tick: (() => void) | null = null;
  let now = 0;
  const log = vi.fn();
  const clear = vi.fn();
  const deps: HealthMonitorDeps = {
    log, now: () => now, heapBytes: () => null, screen: () => "gantt", loadTotal: () => 12, loadsWithin: () => 0, isGuest: () => false,
    setInterval: (fn, ms) => { expect(ms).toBe(HEALTH_CHECK_INTERVAL_MS); tick = fn; return 7; },
    clearInterval: clear,
    ...over,
  };
  const stop = startHealthMonitor(deps);
  return { log, clear, stop, run: (advanceMs = 0) => { now += advanceMs; tick!(); } };
}

describe("startHealthMonitor", () => {
  it("閾値未満・performance.memory なし・load 少数では何も記録しない", () => {
    const m = setup();
    m.run(); m.run();
    expect(m.log).not.toHaveBeenCalled();
  });
  it("heap が閾値以上なら memory-high を1回だけ（context に MB・経過分・画面・load累計）", () => {
    const m = setup({ heapBytes: () => 800 * 1024 * 1024 });
    m.run(5 * 60000); m.run(5 * 60000); m.run(5 * 60000);
    expect(m.log).toHaveBeenCalledTimes(1);
    const arg = m.log.mock.calls[0][0];
    expect(arg).toMatchObject({ source: "report", code: "memory-high" });
    expect(arg.context).toContain("800MB");
    expect(arg.context).toContain("経過5分");
    expect(arg.context).toContain("画面:gantt");
    expect(arg.context).toContain("load累計12回");
  });
  it("10分間の load が上限を超えたら load-burst を1回だけ（上限ちょうどは記録しない）", () => {
    const eq = setup({ loadsWithin: () => LOAD_BURST_LIMIT });
    eq.run();
    expect(eq.log).not.toHaveBeenCalled();
    const m = setup({ loadsWithin: () => LOAD_BURST_LIMIT + 1 });
    m.run(); m.run();
    expect(m.log).toHaveBeenCalledTimes(1);
    expect(m.log.mock.calls[0][0]).toMatchObject({ source: "report", code: "load-burst" });
  });
  it("ゲストモードでは動かさない", () => {
    const m = setup({ isGuest: () => true, heapBytes: () => MEMORY_HIGH_BYTES * 2, loadsWithin: () => 99 });
    m.run();
    expect(m.log).not.toHaveBeenCalled();
  });
  it("返り値でタイマーを解除する", () => {
    const m = setup();
    m.stop();
    expect(m.clear).toHaveBeenCalledWith(7);
  });
  it("source は DB の CHECK 制約（report/boundary/window/promise）の範囲", () => {
    const m = setup({ heapBytes: () => MEMORY_HIGH_BYTES, loadsWithin: () => 99 });
    m.run();
    expect(m.log).toHaveBeenCalledTimes(2);
    for (const [arg] of m.log.mock.calls) expect(["report", "boundary", "window", "promise"]).toContain(arg.source);
  });
  it("fingerprint は code ごとに束ねる（MB・画面名・回数が違っても同じ）", () => {
    const env = { route: "/", screen: "gantt", appVersion: "3.146", userAgent: "x" };
    const mk = (context: string) => buildClientErrorPayload({ source: "report", code: "memory-high", message: "JSヒープのメモリ使用量が閾値を超えました", context }, env).p_fingerprint;
    expect(mk("820MB / 経過35分 / 画面:gantt / load累計12回")).toBe(mk("1500MB / 経過120分 / 画面:calendar / load累計3回"));
    const lb = (code: string, context: string) => buildClientErrorPayload({ source: "report", code, message: "m", context }, env).p_fingerprint;
    expect(lb("load-burst", "10分間に12回 / 画面:list")).toBe(lb("load-burst", "10分間に40回 / 画面:kanban"));
    expect(lb("load-burst", "a")).not.toBe(lb("memory-high", "a"));
  });
});

describe("readHeapBytes", () => {
  it("Chrome 以外（memory が無い）は null", () => {
    expect(readHeapBytes({})).toBeNull();
    expect(readHeapBytes(undefined)).toBeNull();
  });
  it("usedJSHeapSize を返す", () => {
    expect(readHeapBytes({ memory: { usedJSHeapSize: 123 } })).toBe(123);
  });
});
