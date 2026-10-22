// ベルの未読数の定期取得を間引く判断（v3.171・CLAUDE.md Section 76 の Disk IO 対策）。
import { describe, it, expect } from "vitest";
import { BELL_FALLBACK_MS, BELL_LIVE_SAFETY_MS, shouldPollBell } from "../bellPolling";

describe("shouldPollBell", () => {
  const T = 10_000_000;
  it("非表示の間は、どれだけ時間がたっても取らない", () => {
    expect(shouldPollBell({ hidden: true, live: false, now: T, lastFetchAt: 0 })).toBe(false);
    expect(shouldPollBell({ hidden: true, live: true, now: T, lastFetchAt: 0 })).toBe(false);
  });
  it("Realtime が切れているときは3分で取り直す（3分未満では取らない）", () => {
    expect(shouldPollBell({ hidden: false, live: false, now: T + BELL_FALLBACK_MS - 1, lastFetchAt: T })).toBe(false);
    expect(shouldPollBell({ hidden: false, live: false, now: T + BELL_FALLBACK_MS, lastFetchAt: T })).toBe(true);
  });
  it("Realtime が SUBSCRIBED の間は3分では取らず、15分の保険だけ", () => {
    expect(shouldPollBell({ hidden: false, live: true, now: T + BELL_FALLBACK_MS, lastFetchAt: T })).toBe(false);
    expect(shouldPollBell({ hidden: false, live: true, now: T + BELL_LIVE_SAFETY_MS - 1, lastFetchAt: T })).toBe(false);
    expect(shouldPollBell({ hidden: false, live: true, now: T + BELL_LIVE_SAFETY_MS, lastFetchAt: T })).toBe(true);
  });
});
