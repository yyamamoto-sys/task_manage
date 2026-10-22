// subscribeToRealtime：解除の直後に同期的に購読し直しても、新しい購読が実際に張られる（巡回54回目）。
// realtime-js の supabase.channel(topic) は、一覧に残っている同名のチャンネルを返す。解除（removeChannel）は
// leave の応答待ちで一覧から消えるまで遅れるため、固定名だと解除中の古いチャンネルに subscribe しても何も起きない。
import { describe, it, expect, vi, beforeEach } from "vitest";

type SubscribeCb = (status: string) => void;
interface FakeChannel {
  topic: string;
  leaving: boolean;
  cb: SubscribeCb | null;
  on: () => FakeChannel;
  subscribe: (cb?: SubscribeCb) => FakeChannel;
}

const registry: FakeChannel[] = [];
const created: FakeChannel[] = [];

vi.mock("../client", () => ({
  supabase: {
    channel: (topic: string) => {
      const existing = registry.find(c => c.topic === topic);
      if (existing) return existing;
      const ch: FakeChannel = {
        topic, leaving: false, cb: null,
        on() { return ch; },
        // 実装と同じ：解除中のチャンネルへの subscribe は何も起こさない
        subscribe(cb) { if (!ch.leaving) ch.cb = cb ?? null; return ch; },
      };
      registry.push(ch);
      created.push(ch);
      return ch;
    },
    // 応答待ちで一覧から消えるのは後（このテストでは消さない）
    removeChannel: (c: FakeChannel) => { c.leaving = true; return new Promise(() => undefined); },
  },
}));

import { subscribeToRealtime } from "../realtime";

beforeEach(() => { registry.length = 0; created.length = 0; });

describe("解除の直後の張り直し", () => {
  it("解除直後に購読し直すと、新しいチャンネルで状態通知を受けられる（解除中の古いチャンネルを使い回さない）", () => {
    const first = subscribeToRealtime(() => {});
    first();
    const onFirstSubscribed = vi.fn();
    subscribeToRealtime(() => {}, { onFirstSubscribed });
    const live = created.filter(c => !c.leaving && c.cb);
    expect(live.length).toBe(2);
    live[0].cb!("SUBSCRIBED");
    expect(onFirstSubscribed).toHaveBeenCalledTimes(1);
  });
});
