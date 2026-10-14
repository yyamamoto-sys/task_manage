// subscribeToRealtime：切断からの復帰のときだけ onResync を呼ぶ（v3.146・CLAUDE.md Section 76）。
import { describe, it, expect, vi, beforeEach } from "vitest";

type SubscribeCb = (status: string) => void;
interface FakeChannel { ons: number; cb: SubscribeCb | null; on: () => FakeChannel; subscribe: (cb?: SubscribeCb) => FakeChannel }
const channels: FakeChannel[] = [];
const removeChannel = vi.fn(async (_c: unknown) => "ok");

vi.mock("../client", () => ({
  supabase: {
    channel: () => {
      const ch: FakeChannel = {
        ons: 0, cb: null,
        on() { ch.ons++; return ch; },
        subscribe(cb) { ch.cb = cb ?? null; return ch; },
      };
      channels.push(ch);
      return ch;
    },
    removeChannel: (c: unknown) => removeChannel(c),
  },
}));

import { subscribeToRealtime } from "../realtime";

beforeEach(() => { channels.length = 0; removeChannel.mockClear(); });

describe("subscribeToRealtime の onResync", () => {
  it("最初の接続では呼ばない／切断→復帰で1回だけ呼ぶ", () => {
    const onResync = vi.fn();
    subscribeToRealtime(() => {}, { onResync });
    const cb = channels[0].cb!;
    cb("SUBSCRIBED");
    expect(onResync).not.toHaveBeenCalled();
    cb("CHANNEL_ERROR");
    cb("SUBSCRIBED");
    expect(onResync).toHaveBeenCalledTimes(1);
    cb("SUBSCRIBED");
    expect(onResync).toHaveBeenCalledTimes(1);
  });
  it("11表を購読し、解除で removeChannel する／opts なしでも落ちない", () => {
    const off = subscribeToRealtime(() => {});
    expect(channels[0].ons).toBe(11);
    channels[0].cb!("CLOSED");
    channels[0].cb!("SUBSCRIBED");
    off();
    expect(removeChannel).toHaveBeenCalledWith(channels[0]);
  });
});
