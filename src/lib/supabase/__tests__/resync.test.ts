// realtime の取りこぼしを埋める load() を「必要なときだけ」走らせる部品（v3.146・CLAUDE.md Section 76）。
import { describe, it, expect, vi } from "vitest";
import { createReconnectTracker, createHiddenReturnGate, createResyncRunner, HIDDEN_RESYNC_MS } from "../resync";

describe("createReconnectTracker", () => {
  it("最初の SUBSCRIBED では再取得しない", () => {
    const t = createReconnectTracker();
    expect(t.onStatus("SUBSCRIBED")).toBe(false);
  });
  it.each(["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"])("%s のあとの SUBSCRIBED だけ true（1回きり）", (lost) => {
    const t = createReconnectTracker();
    t.onStatus("SUBSCRIBED");
    expect(t.onStatus(lost)).toBe(false);
    expect(t.onStatus("SUBSCRIBED")).toBe(true);
    expect(t.onStatus("SUBSCRIBED")).toBe(false);
  });
});

describe("createHiddenReturnGate", () => {
  it("10分以上非表示だったときだけ true", () => {
    let now = 0;
    const g = createHiddenReturnGate(HIDDEN_RESYNC_MS, () => now);
    g.onHidden();
    now = HIDDEN_RESYNC_MS - 1;
    expect(g.onVisible()).toBe(false);
    g.onHidden();
    now += HIDDEN_RESYNC_MS;
    expect(g.onVisible()).toBe(true);
  });
  it("非表示になっていない（visible だけ来た）なら false", () => {
    expect(createHiddenReturnGate().onVisible()).toBe(false);
  });
  it("hidden が重ねて来ても最初の時刻を基準にする", () => {
    let now = 0;
    const g = createHiddenReturnGate(100, () => now);
    g.onHidden();
    now = 60;
    g.onHidden();
    now = 120;
    expect(g.onVisible()).toBe(true);
  });
});

describe("createResyncRunner", () => {
  /** 手動で進められる時計とタイマー */
  function fakeClock() {
    let now = 0;
    let seq = 0;
    const timers = new Map<number, { at: number; fn: () => void }>();
    return {
      now: () => now,
      timers: {
        setTimeout: (fn: () => void, ms: number) => { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; },
        clearTimeout: (h: unknown) => { timers.delete(h as number); },
      },
      advance(ms: number) {
        now += ms;
        for (const [id, t] of [...timers]) if (t.at <= now) { timers.delete(id); t.fn(); }
      },
      pending: () => timers.size,
    };
  }

  it("最短間隔の外では即時に実行する", () => {
    const c = fakeClock();
    const run = vi.fn();
    const r = createResyncRunner(run, 30_000, c.now, c.timers);
    r();
    expect(run).toHaveBeenCalledTimes(1);
  });
  it("🔴 間隔内に呼ばれた分は捨てず、間隔が明けた時点で1回だけ後追い実行する（何度呼ばれても1回）", () => {
    const c = fakeClock();
    const run = vi.fn();
    const r = createResyncRunner(run, 30_000, c.now, c.timers);
    r();
    c.advance(10_000);
    r(); r(); r();
    expect(run).toHaveBeenCalledTimes(1);
    expect(c.pending()).toBe(1);
    c.advance(19_999);
    expect(run).toHaveBeenCalledTimes(1);
    c.advance(1);
    expect(run).toHaveBeenCalledTimes(2);
    expect(c.pending()).toBe(0);
  });
  it("後追いのあとに間隔が明けてから呼ばれたら、また即時に実行する", () => {
    const c = fakeClock();
    const run = vi.fn();
    const r = createResyncRunner(run, 30_000, c.now, c.timers);
    r();
    c.advance(5_000);
    r();
    c.advance(25_000);
    expect(run).toHaveBeenCalledTimes(2);
    c.advance(30_000);
    r();
    expect(run).toHaveBeenCalledTimes(3);
  });
  it("cancel（アンマウント）で予約中の後追いを解除する", () => {
    const c = fakeClock();
    const run = vi.fn();
    const r = createResyncRunner(run, 30_000, c.now, c.timers);
    r();
    c.advance(1_000);
    r();
    expect(c.pending()).toBe(1);
    r.cancel();
    expect(c.pending()).toBe(0);
    c.advance(60_000);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
