// 右上のベルの Realtime 購読（v3.133）：購読の条件・後片付け・失敗時に例外を出さないこと・再接続時の取り直し。

import { describe, it, expect, vi, beforeEach } from "vitest";

type SubscribeCb = (status: string, err?: Error) => void;
interface FakeChannel {
  name: string;
  ons: { type: string; filter: Record<string, string>; cb: () => void }[];
  subscribeCb: SubscribeCb | null;
  on: (type: string, filter: Record<string, string>, cb: () => void) => FakeChannel;
  subscribe: (cb: SubscribeCb) => FakeChannel;
}
const channels: FakeChannel[] = [];
const removeChannel = vi.fn(async (_ch: unknown) => "ok");

vi.mock("../client", () => ({
  supabase: {
    channel: (name: string) => {
      const ch: FakeChannel = {
        name, ons: [], subscribeCb: null,
        on(type, filter, cb) { ch.ons.push({ type, filter, cb }); return ch; },
        subscribe(cb) { ch.subscribeCb = cb; return ch; },
      };
      channels.push(ch);
      return ch;
    },
    removeChannel: (ch: FakeChannel) => removeChannel(ch),
  },
}));

import { subscribeInAppNotifications } from "../notificationRealtime";

beforeEach(() => {
  channels.length = 0;
  removeChannel.mockClear();
});

describe("subscribeInAppNotifications", () => {
  it("自分の in_app_notifications の INSERT と UPDATE だけを member_id で絞って購読する（DELETE は購読しない）", () => {
    subscribeInAppNotifications("m-1", () => {});
    expect(channels).toHaveLength(1);
    const ons = channels[0].ons;
    expect(ons.map(o => o.filter.event).sort()).toEqual(["INSERT", "UPDATE"]);
    for (const o of ons) {
      expect(o.type).toBe("postgres_changes");
      expect(o.filter).toMatchObject({ schema: "public", table: "in_app_notifications", filter: "member_id=eq.m-1" });
    }
  });

  it("イベントが届いたら取り直しを呼ぶ", () => {
    const onChange = vi.fn();
    subscribeInAppNotifications("m-1", onChange);
    channels[0].ons[0].cb();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("解除するとチャンネルを removeChannel で片付ける", () => {
    const off = subscribeInAppNotifications("m-1", () => {});
    off();
    expect(removeChannel).toHaveBeenCalledWith(channels[0]);
  });

  it("購読ごとにチャンネル名を変える（StrictMode の再マウントで解除中のチャンネルを使い回さない）", () => {
    subscribeInAppNotifications("m-1", () => {})();
    subscribeInAppNotifications("m-1", () => {});
    expect(channels[0].name).not.toBe(channels[1].name);
  });

  it("購読に失敗しても例外を出さず console.warn だけにする（ポーリングで動き続ける）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onChange = vi.fn();
    subscribeInAppNotifications("m-1", onChange);
    expect(() => channels[0].subscribeCb!("CHANNEL_ERROR", new Error("publication missing"))).not.toThrow();
    expect(() => channels[0].subscribeCb!("TIMED_OUT")).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(onChange).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("最初の接続では取り直さず、切断後に再接続したときだけ取りこぼしを埋めるため1回取り直す", () => {
    const onChange = vi.fn();
    subscribeInAppNotifications("m-1", onChange);
    channels[0].subscribeCb!("SUBSCRIBED");
    expect(onChange).not.toHaveBeenCalled();
    channels[0].subscribeCb!("SUBSCRIBED");
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
