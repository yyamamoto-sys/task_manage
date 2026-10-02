// src/lib/adminMessages/__tests__/adminMessageLogic.test.ts
//
// 管理者からのお知らせ（v3.131・v3.132で送信者本人も宛先に選べるよう変更）の純粋関数：
// 宛先の範囲・入力の検査・期限前日の再通知日（休日・JST）・
// 送信者へのまとめ通知の文面と未読へ戻す規則・通知の文面・本文のリンク化（HTML を解釈しない）。

import { describe, it, expect } from "vitest";
import {
  ADMIN_MESSAGE_BODY_MAX, ADMIN_MESSAGE_MAX_SELECTED, ADMIN_MESSAGE_SUBJECT_MAX,
  buildAckSummary, daysUntil, extractMessageId, jstDateOf, reminderDateFor, resolveRecipients,
  shouldRemindToday, shouldResurfaceAckNotice, todayJst, validateDraft,
  type AdminMessageSender, type AdminMessageTarget, type ScopeMember,
} from "../adminMessages";
import {
  buildAdminMessagePushPayload, buildAdminReminderPushPayload,
} from "../../../../supabase/functions/_shared/adminMessageLogic";
import { linkifyPlainText } from "../linkify";

const MEMBERS: ScopeMember[] = [
  { id: "admin-a", group_id: "grp-a" },
  { id: "a1", group_id: "grp-a" },
  { id: "a2", group_id: "grp-a", group_ids: ["grp-a"] },
  { id: "b1", group_id: "grp-b" },
  { id: "b2-kenmu", group_id: "grp-b", group_ids: ["grp-b", "grp-a"] },
  { id: "a-deleted", group_id: "grp-a", is_deleted: true },
  { id: "super", group_id: "grp-b" },
];
const deptAdmin: AdminMessageSender = { id: "admin-a", isSuperAdmin: false, isAdmin: true, homeGroupId: "grp-a" };
const superAdmin: AdminMessageSender = { id: "super", isSuperAdmin: true, isAdmin: false, homeGroupId: "grp-b" };
const general: AdminMessageSender = { id: "a1", isSuperAdmin: false, isAdmin: false, homeGroupId: "grp-a" };

describe("宛先の範囲（send_admin_message と同じ規則）", () => {
  it("一般メンバーは送れない（どの宛先でも）", () => {
    const targets: AdminMessageTarget[] = [{ kind: "all" }, { kind: "group", groupId: "grp-a" }, { kind: "members", memberIds: ["a2"] }];
    for (const target of targets) {
      expect(resolveRecipients(general, target, MEMBERS).ok).toBe(false);
    }
  });

  it("部署の管理者は全員宛てに送れない", () => {
    expect(resolveRecipients(deptAdmin, { kind: "all" }, MEMBERS)).toMatchObject({ ok: false });
  });

  it("部署の管理者は他部署を指定して送れない", () => {
    expect(resolveRecipients(deptAdmin, { kind: "group", groupId: "grp-b" }, MEMBERS)).toMatchObject({ ok: false });
  });

  it("部署の管理者は他部署の人を個人で選んでも送れない（1人でも混ざれば全体を拒否）", () => {
    expect(resolveRecipients(deptAdmin, { kind: "members", memberIds: ["a1", "b1"] }, MEMBERS)).toMatchObject({ ok: false });
  });

  it("部署の管理者は自分のホーム部署の全員（兼務で所属する人を含む・本人を含む・削除済みは除く）に送れる", () => {
    const r = resolveRecipients(deptAdmin, { kind: "group", groupId: "grp-a" }, MEMBERS);
    expect(r).toEqual({ ok: true, recipientIds: ["admin-a", "a1", "a2", "b2-kenmu"] });
  });

  it("部署の管理者は自分の部署のメンバーを選んで送れる（重複は除く・自分も選べる）", () => {
    const r = resolveRecipients(deptAdmin, { kind: "members", memberIds: ["a1", "a1", "admin-a", "b2-kenmu"] }, MEMBERS);
    expect(r).toEqual({ ok: true, recipientIds: ["a1", "admin-a", "b2-kenmu"] });
  });

  it("super_admin は全員・任意の部署・任意の個人に送れる（自分も宛先に含まれる）", () => {
    expect(resolveRecipients(superAdmin, { kind: "all" }, MEMBERS)).toEqual({ ok: true, recipientIds: ["admin-a", "a1", "a2", "b1", "b2-kenmu", "super"] });
    expect(resolveRecipients(superAdmin, { kind: "group", groupId: "grp-a" }, MEMBERS)).toMatchObject({ ok: true });
    expect(resolveRecipients(superAdmin, { kind: "members", memberIds: ["b1", "a1"] }, MEMBERS)).toEqual({ ok: true, recipientIds: ["b1", "a1"] });
  });

  it("🔴 v3.132：送信者本人も宛先として選べる（本人を1人だけ選んでも送れる）", () => {
    expect(resolveRecipients(deptAdmin, { kind: "members", memberIds: ["admin-a"] }, MEMBERS)).toEqual({ ok: true, recipientIds: ["admin-a"] });
    expect(resolveRecipients(superAdmin, { kind: "members", memberIds: ["super"] }, MEMBERS)).toEqual({ ok: true, recipientIds: ["super"] });
  });

  it("削除済みの人は個人で選んでも送れない", () => {
    expect(resolveRecipients(superAdmin, { kind: "members", memberIds: ["a-deleted"] }, MEMBERS)).toMatchObject({ ok: false });
  });

  it("個人を選ぶのは1通100人まで（super_admin でも）", () => {
    const many = Array.from({ length: ADMIN_MESSAGE_MAX_SELECTED + 1 }, (_, i) => ({ id: `m${i}`, group_id: "grp-a" }));
    expect(resolveRecipients(superAdmin, { kind: "members", memberIds: many.map(m => m.id) }, many)).toMatchObject({ ok: false });
    expect(resolveRecipients(superAdmin, { kind: "members", memberIds: many.slice(0, 100).map(m => m.id) }, many)).toMatchObject({ ok: true });
  });

  it("宛先が0人なら送れない", () => {
    expect(resolveRecipients(superAdmin, { kind: "group", groupId: "grp-none" }, MEMBERS)).toEqual({ ok: false, reason: "宛先がいません" });
  });
});

describe("入力の検査（件名100字・本文2000字・期限は確認ボタンありのときだけ）", () => {
  const base = { subject: "件名", body: "本文", requiresAck: false, dueDate: null };
  it("上限ちょうどは通り、1文字超えると弾く（絵文字は1文字として数える＝DB の char_length と同じ）", () => {
    expect(validateDraft({ ...base, subject: "あ".repeat(ADMIN_MESSAGE_SUBJECT_MAX) }, "2026-10-01")).toBeNull();
    expect(validateDraft({ ...base, subject: "あ".repeat(ADMIN_MESSAGE_SUBJECT_MAX + 1) }, "2026-10-01")).not.toBeNull();
    expect(validateDraft({ ...base, body: "📣".repeat(ADMIN_MESSAGE_BODY_MAX) }, "2026-10-01")).toBeNull();
    expect(validateDraft({ ...base, body: "x".repeat(ADMIN_MESSAGE_BODY_MAX + 1) }, "2026-10-01")).not.toBeNull();
  });
  it("空白だけの件名・本文は弾く", () => {
    expect(validateDraft({ ...base, subject: "   " }, "2026-10-01")).not.toBeNull();
    expect(validateDraft({ ...base, body: "\n\n" }, "2026-10-01")).not.toBeNull();
  });
  it("確認ボタンなしで期限を付けられない・過去の期限は付けられない", () => {
    expect(validateDraft({ ...base, dueDate: "2026-10-05" }, "2026-10-01")).not.toBeNull();
    expect(validateDraft({ ...base, requiresAck: true, dueDate: "2026-09-30" }, "2026-10-01")).not.toBeNull();
    expect(validateDraft({ ...base, requiresAck: true, dueDate: "2026-10-01" }, "2026-10-01")).toBeNull();
  });
});

// 2026年の祝日の一部（テスト用。本番は japanese-holidays）
const HOLIDAYS: Record<string, string> = { "2026-10-12": "スポーツの日", "2026-11-03": "文化の日", "2026-11-23": "勤労感謝の日" };
const isHoliday = (d: string) => HOLIDAYS[d] ?? null;

describe("期限前日の再通知日＝期限の直前の平日（JST・土日祝を飛ばす）", () => {
  it("期限が平日（木）なら前日（水）", () => {
    expect(reminderDateFor("2026-10-08", isHoliday)).toBe("2026-10-07");
  });
  it("期限が月曜なら前の金曜", () => {
    expect(reminderDateFor("2026-10-05", isHoliday)).toBe("2026-10-02");
  });
  it("期限の前日が祝日（10/12 スポーツの日・月）なら、その前の金曜", () => {
    expect(reminderDateFor("2026-10-13", isHoliday)).toBe("2026-10-09");
  });
  it("期限が土曜なら金曜", () => {
    expect(reminderDateFor("2026-10-10", isHoliday)).toBe("2026-10-09");
  });

  it("送ったのが再通知日より前なら、再通知日の朝に送る。期限当日・それ以降は送らない", () => {
    const m = { id: 1, requires_ack: true, due_date: "2026-10-08", created_at: "2026-10-05T01:00:00Z" };
    expect(shouldRemindToday(m, "2026-10-06", isHoliday)).toBe(false);
    expect(shouldRemindToday(m, "2026-10-07", isHoliday)).toBe(true);
    expect(shouldRemindToday(m, "2026-10-08", isHoliday)).toBe(false);
  });

  it("再通知日当日に送ったお知らせは再通知しない（届いたばかり）", () => {
    // 10/7 9:00 JST に送信 → 10/7 が再通知日
    const m = { id: 2, requires_ack: true, due_date: "2026-10-08", created_at: "2026-10-07T00:00:00Z" };
    expect(shouldRemindToday(m, "2026-10-07", isHoliday)).toBe(false);
  });

  it("🔴 JST で日付を判定する：UTC では前日でも JST では再通知日当日の送信は再通知しない", () => {
    // 2026-10-06T15:30Z ＝ JST 10/7 0:30（UTC の日付だと 10/6 になってしまう）
    expect(jstDateOf("2026-10-06T15:30:00Z")).toBe("2026-10-07");
    const m = { id: 3, requires_ack: true, due_date: "2026-10-08", created_at: "2026-10-06T15:30:00Z" };
    expect(shouldRemindToday(m, "2026-10-07", isHoliday)).toBe(false);
  });

  it("cron が再通知日に止まっても、期限前の平日なら翌日に送る（1人1回は DB の reminded_at が保証）", () => {
    const m = { id: 4, requires_ack: true, due_date: "2026-10-09", created_at: "2026-10-01T00:00:00Z" };
    expect(reminderDateFor("2026-10-09", isHoliday)).toBe("2026-10-08");
    expect(shouldRemindToday(m, "2026-10-08", isHoliday)).toBe(true);
  });

  it("確認ボタンなし・期限なしは再通知しない", () => {
    expect(shouldRemindToday({ id: 5, requires_ack: false, due_date: "2026-10-08", created_at: "2026-10-01T00:00:00Z" }, "2026-10-07", isHoliday)).toBe(false);
    expect(shouldRemindToday({ id: 6, requires_ack: true, due_date: null, created_at: "2026-10-01T00:00:00Z" }, "2026-10-07", isHoliday)).toBe(false);
  });

  it("今日（JST）と残り日数", () => {
    expect(todayJst(new Date("2026-10-01T15:00:00Z"))).toBe("2026-10-02");
    expect(daysUntil("2026-10-03", "2026-10-01")).toBe(2);
    expect(daysUntil("2026-09-30", "2026-10-01")).toBe(-1);
  });
});

describe("送信者へのまとめ通知（同じお知らせは1件に差し替える）", () => {
  it("文面：人数と残り人数。全員なら「全員」", () => {
    expect(buildAckSummary("アップデートのお知らせ", 5, 7)).toEqual({ title: "「アップデートのお知らせ」を5人が確認しました", body: "残り2人（宛先7人）" });
    expect(buildAckSummary("x", 7, 7).body).toBe("全員（7人）が確認しました");
    expect(buildAckSummary("あ".repeat(31), 1, 2).title).toBe(`「${"あ".repeat(30)}…」を1人が確認しました`);
  });

  it("確認が増えるたびに未読へ戻さない：既読にした後1時間以内は既読のまま、全員そろったら・1時間たったら未読に戻す", () => {
    const now = new Date("2026-10-01T03:00:00Z");
    const recentRead = { read_at: "2026-10-01T02:50:00Z", created_at: "2026-10-01T02:40:00Z" };
    expect(shouldResurfaceAckNotice(recentRead, false, now)).toBe(false);
    expect(shouldResurfaceAckNotice(recentRead, true, now)).toBe(true);
    expect(shouldResurfaceAckNotice({ read_at: "2026-10-01T01:00:00Z", created_at: "2026-10-01T01:30:00Z" }, false, now)).toBe(true);
    expect(shouldResurfaceAckNotice({ read_at: null, created_at: "2026-10-01T02:59:00Z" }, false, now)).toBe(true);
    expect(shouldResurfaceAckNotice(null, false, now)).toBe(true);
  });
});

describe("通知の文面（Windows）", () => {
  it("お知らせ：📣 件名・本文の先頭120字・クリック先はお知らせの詳細・タグはお知らせごと", () => {
    const p = buildAdminMessagePushPayload({ id: 12, subject: "更新", body: "Ctrl+Shift+R\nで再読み込み" + "あ".repeat(200) });
    expect(p.title).toBe("📣 更新");
    expect([...p.body].length).toBe(121);
    expect(p.body.startsWith("Ctrl+Shift+R で再読み込み")).toBe(true);
    expect(p.url).toBe("/?open=admin-message&mid=12");
    expect(p.tag).toBe("admin-message-12");
  });
  it("再通知：期限の日付を件名の前に付ける", () => {
    const p = buildAdminReminderPushPayload({ id: 3, subject: "担当タスクの確認", due_date: "2026-10-08" });
    expect(p.title).toBe("📣 【期限 10/8】担当タスクの確認");
    expect(p.tag).toBe("admin-message-remind-3");
  });
  it("URL の mid を読む（数字以外は無視）", () => {
    expect(extractMessageId("?open=admin-message&mid=42")).toBe(42);
    expect(extractMessageId("?open=admin-message&mid=abc")).toBeNull();
    expect(extractMessageId("?open=admin-message")).toBeNull();
    expect(extractMessageId("?mid=0")).toBeNull();
  });
});

describe("本文のリンク化（プレーンテキスト・HTML を解釈しない）", () => {
  it("HTML のタグは文字のまま（リンクにも要素にもしない）", () => {
    const segs = linkifyPlainText("<b>太字</b><img src=x onerror=alert(1)>");
    expect(segs).toEqual([{ type: "text", text: "<b>太字</b><img src=x onerror=alert(1)>" }]);
  });
  it("http(s) の URL だけをリンクにする。javascript: や data: は文字のまま", () => {
    const segs = linkifyPlainText("手順は https://example.com/a?b=1 を見てください。javascript:alert(1) data:text/html,x");
    expect(segs.filter(s => s.type === "link")).toEqual([{ type: "link", text: "https://example.com/a?b=1", href: "https://example.com/a?b=1" }]);
    expect(segs.map(s => s.text).join("")).toBe("手順は https://example.com/a?b=1 を見てください。javascript:alert(1) data:text/html,x");
  });
  it("文末の句読点・閉じ括弧はURLに含めない", () => {
    const segs = linkifyPlainText("（http://example.com/x）。");
    expect(segs).toEqual([
      { type: "text", text: "（" },
      { type: "link", text: "http://example.com/x", href: "http://example.com/x" },
      { type: "text", text: "）。" },
    ]);
  });
  it("引用符でURLを抜け出させない（\" や < で区切る）", () => {
    const segs = linkifyPlainText('https://example.com/"onmouseover="x');
    expect(segs[0]).toEqual({ type: "link", text: "https://example.com/", href: "https://example.com/" });
  });
});
