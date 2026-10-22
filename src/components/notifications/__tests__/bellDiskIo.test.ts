// src/components/notifications/__tests__/bellDiskIo.test.ts
//
// v3.171（CLAUDE.md Section 76）：ベルの in_app_notifications 取得を間引く（Supabase の Disk IO 対策）。
//   - 非表示の間は未読数を取りに行かない。前面に戻ったら1回だけ取る。
//   - 通知の Realtime が SUBSCRIBED の間は3分では取らない（15分の保険だけ）。切れているときだけ3分。
//   - 取得の実行中に届いた要求は重ねず、終わってから1回だけ取り直す。
//   - 10分以上の非表示で購読を解除し、前面に戻ったら張り直す。
// 実際に描画して取得の回数を数える。

import { miniDocument } from "../../../__tests__/miniDom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  countUnreadInAppNotifications: vi.fn(async () => 2),
  fetchInAppNotifications: vi.fn(async () => [] as unknown[]),
  markInAppNotificationsRead: vi.fn(async () => {}),
}));
const adminStore = vi.hoisted(() => ({
  acknowledgeAdminMessage: vi.fn(async () => "2026-10-02T00:00:00Z"),
  fetchPendingAckMessages: vi.fn(async () => [] as unknown[]),
  fetchReceivedAdminMessages: vi.fn(async () => [] as unknown[]),
  listSentAdminMessages: vi.fn(async () => [] as unknown[]),
  fetchAdminMessageStatus: vi.fn(async () => [] as unknown[]),
  markAdminMessageRead: vi.fn(async () => {}),
}));
const rt = vi.hoisted(() => ({
  subscribes: 0,
  unsubscribes: 0,
  onChange: null as null | (() => void),
  onLive: null as null | ((live: boolean) => void),
}));

vi.mock("../../../lib/supabase/notificationStore", () => store);
vi.mock("../../../lib/supabase/adminMessageStore", () => adminStore);
vi.mock("../../../lib/supabase/notificationRealtime", () => ({
  subscribeInAppNotifications: (_memberId: string, onChange: () => void, onLive?: (live: boolean) => void) => {
    rt.subscribes++;
    rt.onChange = onChange;
    rt.onLive = onLive ?? null;
    return () => { rt.unsubscribes++; rt.onChange = null; rt.onLive?.(false); };
  },
}));
vi.mock("../../../hooks/useFloatingPanel", () => ({
  useFloatingPanel: () => ({ panelStyle: {}, scrollAreaStyle: {} }),
}));

import { InAppNotificationBell } from "../InAppNotificationBell";
import { installHiddenPause, HIDDEN_PAUSE_MS } from "../../../lib/supabase/realtimePause";
import { BELL_FALLBACK_MS, BELL_LIVE_SAFETY_MS } from "../../../lib/notifications/bellPolling";

const doc = miniDocument as unknown as { visibilityState: string; dispatchEvent: (e: Event) => boolean };
let root: Root | null = null;
let stopPause: (() => void) | null = null;

function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(createElement(InAppNotificationBell, {
    memberId: "m1", isSuperAdmin: false, isAdmin: false,
    onOpenLink: () => {}, onOpenSettings: () => {}, onOpenFeedback: () => {}, onOpenMessage: () => {}, size: 36,
  })));
}

async function settle(rounds = 20) {
  for (let i = 0; i < rounds; i++) await act(async () => { await Promise.resolve(); });
}

async function advance(ms: number) {
  await act(async () => { vi.advanceTimersByTime(ms); });
  await settle();
}

async function setVisibility(state: "visible" | "hidden") {
  doc.visibilityState = state;
  await act(async () => { doc.dispatchEvent(new Event("visibilitychange")); });
  await settle();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] });
  vi.clearAllMocks();
  rt.subscribes = 0; rt.unsubscribes = 0; rt.onChange = null; rt.onLive = null;
  doc.visibilityState = "visible";
});

afterEach(() => {
  stopPause?.();
  stopPause = null;
  if (root) act(() => root!.unmount());
  root = null;
  for (const c of [...document.body.childNodes]) document.body.removeChild(c);
  doc.visibilityState = "visible";
  vi.useRealTimers();
});

describe("ベルの未読数の取得を間引く", () => {
  it("非表示の間は、Realtime のイベントでも定期取得でも取らず、前面に戻ったとき1回だけ取る", async () => {
    mount();
    await settle();
    expect(store.countUnreadInAppNotifications).toHaveBeenCalledTimes(1);

    await setVisibility("hidden");
    await advance(BELL_FALLBACK_MS * 3);
    await act(async () => { rt.onChange?.(); });
    await settle();
    expect(store.countUnreadInAppNotifications).toHaveBeenCalledTimes(1);

    await setVisibility("visible");
    expect(store.countUnreadInAppNotifications).toHaveBeenCalledTimes(2);
  });

  it("Realtime が切れている間は3分ごとに取り直す", async () => {
    mount();
    await settle();
    const base = store.countUnreadInAppNotifications.mock.calls.length;
    await advance(BELL_FALLBACK_MS);
    expect(store.countUnreadInAppNotifications).toHaveBeenCalledTimes(base + 1);
  });

  it("Realtime が SUBSCRIBED の間は3分では取らず、15分の保険で1回だけ取る", async () => {
    mount();
    await settle();
    await act(async () => { rt.onLive?.(true); });
    const base = store.countUnreadInAppNotifications.mock.calls.length;
    await advance(BELL_FALLBACK_MS * 3);
    expect(store.countUnreadInAppNotifications).toHaveBeenCalledTimes(base);
    await advance(BELL_LIVE_SAFETY_MS - BELL_FALLBACK_MS * 3);
    expect(store.countUnreadInAppNotifications).toHaveBeenCalledTimes(base + 1);
  });

  it("取得の実行中に届いた要求は重ねず、終わってから1回だけ取り直す", async () => {
    mount();
    await settle();
    const base = store.countUnreadInAppNotifications.mock.calls.length;

    let release: () => void = () => {};
    store.countUnreadInAppNotifications.mockImplementationOnce(() => new Promise<number>(r => { release = () => r(5); }));
    await act(async () => { rt.onChange?.(); });
    await act(async () => { rt.onChange?.(); });
    await act(async () => { rt.onChange?.(); });
    expect(store.countUnreadInAppNotifications).toHaveBeenCalledTimes(base + 1);

    await act(async () => { release(); });
    await settle();
    expect(store.countUnreadInAppNotifications).toHaveBeenCalledTimes(base + 2);
  });
});

describe("10分以上の非表示で購読を解除し、前面に戻ったら張り直す", () => {
  it("10分未満の非表示では購読を変えない", async () => {
    mount();
    stopPause = installHiddenPause();
    await settle();
    expect(rt.subscribes).toBe(1);

    await setVisibility("hidden");
    await advance(HIDDEN_PAUSE_MS - 1000);
    expect(rt.unsubscribes).toBe(0);
    await setVisibility("visible");
    expect(rt.subscribes).toBe(1);
    expect(rt.unsubscribes).toBe(0);
  });

  it("10分で解除し、前面に戻ったら張り直して未読数を1回取る", async () => {
    mount();
    stopPause = installHiddenPause();
    await settle();
    await setVisibility("hidden");
    await advance(HIDDEN_PAUSE_MS);
    expect(rt.unsubscribes).toBe(1);
    expect(rt.subscribes).toBe(1);

    const base = store.countUnreadInAppNotifications.mock.calls.length;
    await setVisibility("visible");
    expect(rt.subscribes).toBe(2);
    expect(store.countUnreadInAppNotifications).toHaveBeenCalledTimes(base + 1);
  });
});
