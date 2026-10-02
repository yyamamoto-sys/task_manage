// 右上のベル（v3.133）：未読バッジが欠けないこと・送信済みタブの出し分け・自分の操作の直後の取り直し・Realtime の配線。
// ソース走査は Section 59 に従いコメントを除去してから行う。

import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BELL_BADGE_MIN_WIDTH_PX, BELL_BADGE_OFFSET_RIGHT_PX, BELL_BADGE_OFFSET_TOP_PX, bellBadgeStyle, bellTabsFor,
  canSendAdminMessages, estimateBellBadgeWidthPx, ownSentMessages,
} from "../bell";
import { formatBadgeCount } from "../notificationKinds";
import { computeBellRightPc } from "../../layout/topRightBell";
import { onBellRefreshRequest, requestBellRefresh } from "../bellRefresh";

const SRC = join(__dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");
const stripComments = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line))
  .map(line => line.replace(/\s\/\/\s.*$/, ""))
  .join("\n");

describe("未読バッジの形（1桁・2桁・99+）", () => {
  const style = bellBadgeStyle();

  it.each([[5, "5"], [42, "42"], [150, "99+"]])("%i 件は「%s」と表示し、幅を固定せず中身に合わせて広がる", (n, text) => {
    expect(formatBadgeCount(n)).toBe(text);
    expect(style.width).toBeUndefined();
    expect(style.maxWidth).toBeUndefined();
    expect(style.whiteSpace).toBe("nowrap");
    expect(parseFloat(String(style.minWidth))).toBe(BELL_BADGE_MIN_WIDTH_PX);
    expect(estimateBellBadgeWidthPx(text)).toBeGreaterThanOrEqual(BELL_BADGE_MIN_WIDTH_PX);
  });

  it("99+ は 1桁より広い見積もりになる（minWidth で切り詰めない）", () => {
    expect(estimateBellBadgeWidthPx("99+")).toBeGreaterThan(estimateBellBadgeWidthPx("9"));
  });

  it("バッジ自身は内容を切らず、クリックを奪わない", () => {
    expect(style.overflow).toBe("visible");
    expect(style.pointerEvents).toBe("none");
    expect(style.position).toBe("absolute");
  });

  it("PC でバッジの右端・上端が画面の外へ出ない", () => {
    expect(computeBellRightPc(false, 0) + BELL_BADGE_OFFSET_RIGHT_PX).toBeGreaterThanOrEqual(0);
    expect(BELL_BADGE_OFFSET_TOP_PX).toBeLessThan(0);
  });
});

describe("見切れの原因：バッジをベルのボタンの内側に置かない", () => {
  it("globals.css はすべての押せるボタンを overflow:hidden にしている（＝円の外は切り取られる）", () => {
    expect(read("styles/globals.css")).toMatch(/button:not\(:disabled\)\s*\{[^}]*overflow:\s*hidden/);
  });

  it("InAppNotificationBell はバッジをトリガーのボタンの外（兄弟要素）に描画する", () => {
    const src = stripComments(read("components/notifications/InAppNotificationBell.tsx"));
    const start = src.indexOf("ref={triggerRef}");
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf("</button>", start);
    const inside = src.slice(start, end);
    expect(inside).not.toMatch(/badge/i);
    expect(src.slice(end)).toContain("bellBadgeStyle()");
  });
});

describe("送信済みタブの出し分け", () => {
  it("一般メンバーは送れないので「すべて」だけ（タブ列自体を出さない）", () => {
    expect(canSendAdminMessages({ isSuperAdmin: false, isAdmin: false })).toBe(false);
    expect(bellTabsFor({ isSuperAdmin: false, isAdmin: false })).toEqual(["all"]);
  });
  it("部署の管理者は「すべて／送信済み」", () => {
    expect(bellTabsFor({ isSuperAdmin: false, isAdmin: true })).toEqual(["all", "sent"]);
  });
  it("super_admin は「すべて／管理者向け／送信済み」", () => {
    expect(bellTabsFor({ isSuperAdmin: true, isAdmin: false })).toEqual(["all", "admin", "sent"]);
  });
  it("super_admin でも送信済みタブは自分が送ったものだけ（全件は設定の送信履歴）", () => {
    const rows = [{ id: 1, sender_id: "me" }, { id: 2, sender_id: "other" }, { id: 3, sender_id: "me" }];
    expect(ownSentMessages(rows, "me").map(r => r.id)).toEqual([1, 3]);
  });
});

describe("自分の操作の直後の取り直し", () => {
  const g = globalThis as { window?: unknown };
  afterEach(() => { delete g.window; });

  it("requestBellRefresh で登録した取り直しが呼ばれ、解除後は呼ばれない", () => {
    g.window = new EventTarget();
    const handler = vi.fn();
    const off = onBellRefreshRequest(handler);
    requestBellRefresh();
    expect(handler).toHaveBeenCalledTimes(1);
    off();
    requestBellRefresh();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("お知らせの送信が成功した直後に requestBellRefresh を呼ぶ（Windows通知の即時送信より前）", () => {
    const src = stripComments(read("components/admin/AdminMessageSection.tsx"));
    const sendAt = src.indexOf("await sendAdminMessage(");
    const refreshAt = src.indexOf("requestBellRefresh()", sendAt);
    const dispatchAt = src.indexOf("await dispatchAdminMessagePush(", sendAt);
    expect(sendAt).toBeGreaterThan(-1);
    expect(refreshAt).toBeGreaterThan(sendAt);
    expect(refreshAt).toBeLessThan(dispatchAt);
  });

  it("ベルは Realtime と取り直しの要求を購読し、ポーリング（保険）も残している", () => {
    const src = stripComments(read("components/notifications/InAppNotificationBell.tsx"));
    expect(src).toContain("subscribeInAppNotifications(memberId");
    expect(src).toContain("onBellRefreshRequest(");
    expect(src).toMatch(/setInterval\(\(\) => void refreshCount\(\), FALLBACK_REFRESH_MS\)/);
  });
});

describe("Realtime の publication マイグレ", () => {
  const sql = readFileSync(join(SRC, "..", "supabase", "migrations", "20261002b_in_app_notifications_realtime.sql"), "utf8")
    .split("\n").map(l => l.replace(/--.*$/, "")).join("\n");
  it("in_app_notifications を supabase_realtime に冪等に追加する", () => {
    expect(sql).toMatch(/IF NOT EXISTS[\s\S]*pg_publication_tables[\s\S]*tablename = 'in_app_notifications'/);
    expect(sql).toContain("ALTER PUBLICATION supabase_realtime ADD TABLE public.in_app_notifications");
  });
});
