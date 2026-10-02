// src/components/notifications/__tests__/bellFetchLoop.test.ts
//
// 🔴 v3.135（CLAUDE.md Section 69）：ベルとお知らせの詳細は、開いている間に取得を繰り返さない。
// v3.133 は取得関数の依存に翻訳関数（描画ごとに別物）が入り、取得完了 → 再描画 → 再取得が止まらず
// 「Failed to fetch」が点滅した。ここでは実際に描画して取得の回数を数える。

import { allElements, reactProps, type MiniElement } from "../../../__tests__/miniDom";
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
const realtime = vi.hoisted(() => ({ onChange: null as null | (() => void) }));

vi.mock("../../../lib/supabase/notificationStore", () => store);
vi.mock("../../../lib/supabase/adminMessageStore", () => adminStore);
vi.mock("../../../lib/supabase/notificationRealtime", () => ({
  subscribeInAppNotifications: (_memberId: string, onChange: () => void) => {
    realtime.onChange = onChange;
    return () => { realtime.onChange = null; };
  },
}));
vi.mock("../../../hooks/useFloatingPanel", () => ({
  useFloatingPanel: () => ({ panelStyle: {}, scrollAreaStyle: {} }),
}));

import { InAppNotificationBell } from "../InAppNotificationBell";
import { AdminMessageDialog } from "../AdminMessageDialog";

let root: Root | null = null;

function mount(el: ReturnType<typeof createElement>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(el));
}

/** 取得の Promise と、それに続く再描画・effect を何周も流し切る */
async function settle(rounds = 30) {
  for (let i = 0; i < rounds; i++) await act(async () => { await Promise.resolve(); });
}

async function click(el: MiniElement) {
  await act(async () => { (reactProps(el).onClick as () => void)(); });
}

const trigger = () => allElements().find(e => e.getAttribute("aria-haspopup") === "dialog")!;
const tabButtons = () => allElements().filter(e => e.getAttribute("role") === "tab");

const bell = () => createElement(InAppNotificationBell, {
  memberId: "m1", isSuperAdmin: false, isAdmin: true,
  onOpenLink: () => {}, onOpenSettings: () => {}, onOpenMessage: () => {}, size: 36,
});

beforeEach(() => {
  vi.clearAllMocks();
  store.fetchInAppNotifications.mockImplementation(async () => [
    { id: 1, kind: "deadline_digest", title: "a", body: "b", url: "/", created_at: "2026-10-02T00:00:00Z", read_at: null },
  ]);
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  for (const c of [...document.body.childNodes]) document.body.removeChild(c);
});

describe("ベル：開いている間に取得を繰り返さない", () => {
  it("開いたら一覧の取得は1回で止まり、流し切った後も増えない", async () => {
    mount(bell());
    await settle();
    expect(store.fetchInAppNotifications).toHaveBeenCalledTimes(0);

    await click(trigger());
    await settle();
    expect(store.fetchInAppNotifications).toHaveBeenCalledTimes(1);
    await settle(60);
    expect(store.fetchInAppNotifications).toHaveBeenCalledTimes(1);
    expect(adminStore.fetchPendingAckMessages).toHaveBeenCalledTimes(1);
  });

  it("タブを切り替えると、そのタブの取得が1回ずつ増えるだけ", async () => {
    mount(bell());
    await click(trigger());
    await settle();
    expect(tabButtons()).toHaveLength(2);

    await click(tabButtons()[1]);
    await settle();
    expect(adminStore.listSentAdminMessages).toHaveBeenCalledTimes(1);
    expect(store.fetchInAppNotifications).toHaveBeenCalledTimes(1);

    await click(tabButtons()[0]);
    await settle();
    expect(store.fetchInAppNotifications).toHaveBeenCalledTimes(2);
    expect(adminStore.listSentAdminMessages).toHaveBeenCalledTimes(1);
  });

  it("Realtime のイベント1回で、一覧の取得も未読数の取得も1回", async () => {
    mount(bell());
    await click(trigger());
    await settle();
    const list = store.fetchInAppNotifications.mock.calls.length;
    const count = store.countUnreadInAppNotifications.mock.calls.length;

    await act(async () => { realtime.onChange!(); });
    await settle();
    expect(store.fetchInAppNotifications).toHaveBeenCalledTimes(list + 1);
    expect(store.countUnreadInAppNotifications).toHaveBeenCalledTimes(count + 1);
  });

  it("取得の実行中に届いたイベントは重ねず、終わってから1回だけ取り直す", async () => {
    mount(bell());
    await click(trigger());
    await settle();
    const base = store.fetchInAppNotifications.mock.calls.length;

    let release: () => void = () => {};
    store.fetchInAppNotifications.mockImplementationOnce(() => new Promise(r => { release = () => r([]); }));
    await act(async () => { realtime.onChange!(); });
    await act(async () => { realtime.onChange!(); });
    await act(async () => { realtime.onChange!(); });
    expect(store.fetchInAppNotifications).toHaveBeenCalledTimes(base + 1);

    await act(async () => { release(); });
    await settle();
    expect(store.fetchInAppNotifications).toHaveBeenCalledTimes(base + 2);
  });

  it("閉じている間の Realtime のイベントは未読数だけ取り直す", async () => {
    mount(bell());
    await settle();
    await act(async () => { realtime.onChange!(); });
    await settle();
    expect(store.fetchInAppNotifications).toHaveBeenCalledTimes(0);
  });
});

describe("お知らせの詳細：開いている間に取得を繰り返さない", () => {
  it("取得は1回で止まり、流し切った後も増えない", async () => {
    adminStore.fetchReceivedAdminMessages.mockImplementation(async () => [{
      message_id: 7, read_at: null, acknowledged_at: null, subject: "件名", body: "本文", sender_name: "送信者",
      requires_ack: true, due_date: null, created_at: "2026-10-02T00:00:00Z",
    }]);
    const onChanged = vi.fn();
    mount(createElement(AdminMessageDialog, { memberId: "m1", messageId: 7, onClose: () => {}, onChanged }));
    await settle();
    expect(adminStore.fetchReceivedAdminMessages).toHaveBeenCalledTimes(1);
    await settle(60);
    expect(adminStore.fetchReceivedAdminMessages).toHaveBeenCalledTimes(1);
    expect(adminStore.markAdminMessageRead).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
});
