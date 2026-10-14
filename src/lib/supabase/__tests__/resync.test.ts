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
  it("最短間隔の間は連打しない", () => {
    let now = 0;
    const run = vi.fn();
    const r = createResyncRunner(run, 30_000, () => now);
    r(); r();
    expect(run).toHaveBeenCalledTimes(1);
    now = 30_000;
    r();
    expect(run).toHaveBeenCalledTimes(2);
  });
});
