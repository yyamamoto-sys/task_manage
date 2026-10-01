// supabase/functions/_shared/adminMessageLogic.ts
//
// 管理者からのお知らせ（v3.131・CLAUDE.md Section 68）の純粋関数。Edge Function（push-reminders）と
// フロント（src/lib/adminMessages/ が相対 import）の両方が読む。Deno・npm・DOM に依存しない。
// 宛先の範囲・文面・再通知日の正本は SQL（migrations/20261001e_admin_messages.sql）と、ここ。
// 両者の一致は src/lib/adminMessages/__tests__/ がマイグレの文面と照合する。

import type { PushPayload } from "./reminderLogic.ts";

export const ADMIN_MESSAGE_SUBJECT_MAX = 100;
export const ADMIN_MESSAGE_BODY_MAX = 2000;
/** 個人を選んで送るときの上限（全員宛て・部署宛ては上限なし） */
export const ADMIN_MESSAGE_MAX_SELECTED = 100;
export const ADMIN_MESSAGE_PER_HOUR = 10;
export const ADMIN_MESSAGE_PER_DAY = 30;

export type AdminMessageTarget =
  | { kind: "all" }
  | { kind: "group"; groupId: string }
  | { kind: "members"; memberIds: string[] };

export interface AdminMessageSender {
  id: string;
  isSuperAdmin: boolean;
  isAdmin: boolean;
  /** ホーム部署（members.group_id） */
  homeGroupId: string | null;
}

export interface ScopeMember {
  id: string;
  group_id: string | null;
  group_ids?: string[] | null;
  is_deleted?: boolean;
}

export type ScopeResult = { ok: true; recipientIds: string[] } | { ok: false; reason: string };

function inGroup(m: ScopeMember, groupId: string): boolean {
  return m.group_id === groupId || (m.group_ids ?? []).includes(groupId);
}

/**
 * 宛先の範囲（send_admin_message と同じ規則）。画面のプレビューで宛先の人数を出すのに使う。
 * 🔴 本物の強制は DB 側（send_admin_message）。ここは同じ判定の写し。
 */
export function resolveRecipients(sender: AdminMessageSender, target: AdminMessageTarget, members: ScopeMember[]): ScopeResult {
  if (!sender.isSuperAdmin && !sender.isAdmin) {
    return { ok: false, reason: "お知らせを送れるのは部署の管理者と全社スーパー管理者だけです" };
  }
  const alive = members.filter((m) => !m.is_deleted && m.id !== sender.id);
  let ids: string[];
  if (target.kind === "all") {
    if (!sender.isSuperAdmin) return { ok: false, reason: "全員宛てに送れるのは全社スーパー管理者だけです" };
    ids = alive.map((m) => m.id);
  } else if (target.kind === "group") {
    if (!sender.isSuperAdmin && (!sender.homeGroupId || target.groupId !== sender.homeGroupId)) {
      return { ok: false, reason: "部署の管理者が送れるのは自分の部署（ホーム部署）だけです" };
    }
    ids = alive.filter((m) => inGroup(m, target.groupId)).map((m) => m.id);
  } else {
    const wanted = [...new Set(target.memberIds.filter((x) => x && x !== sender.id))];
    if (wanted.length > ADMIN_MESSAGE_MAX_SELECTED) {
      return { ok: false, reason: `個人を選んで送れるのは1通${ADMIN_MESSAGE_MAX_SELECTED}人までです` };
    }
    const allowed = new Set(alive
      .filter((m) => sender.isSuperAdmin || (sender.homeGroupId !== null && inGroup(m, sender.homeGroupId)))
      .map((m) => m.id));
    if (wanted.some((id) => !allowed.has(id))) {
      return { ok: false, reason: "宛先に送れない人が含まれています（部署の管理者は自分の部署のメンバーにだけ送れます）" };
    }
    ids = wanted;
  }
  if (ids.length === 0) return { ok: false, reason: "宛先がいません" };
  return { ok: true, recipientIds: ids };
}

export interface AdminMessageDraft {
  subject: string;
  body: string;
  requiresAck: boolean;
  dueDate: string | null;
}

/** 入力の検査（send_admin_message と同じ規則）。問題が無ければ null */
export function validateDraft(d: AdminMessageDraft, todayJst: string): string | null {
  const subject = d.subject.trim();
  const body = d.body.trim();
  if (subject.length < 1 || [...subject].length > ADMIN_MESSAGE_SUBJECT_MAX) return `件名は1〜${ADMIN_MESSAGE_SUBJECT_MAX}文字で入力してください`;
  if (body.length < 1 || [...body].length > ADMIN_MESSAGE_BODY_MAX) return `本文は1〜${ADMIN_MESSAGE_BODY_MAX}文字で入力してください`;
  if (d.dueDate && !d.requiresAck) return "期限は「確認しました」ボタンを付けたときだけ設定できます";
  if (d.dueDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.dueDate)) return "期限の日付が不正です";
    if (d.dueDate < todayJst || d.dueDate > addDays(todayJst, 365)) return "期限は今日から1年以内の日付にしてください";
  }
  return null;
}

// ===== 日付（JST の "YYYY-MM-DD" を文字列のまま扱う。実行環境のタイムゾーンに依存しない） =====

export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** 0=日 … 6=土 */
export function dayOfWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** ISO の日時 → JST の日付 */
export function jstDateOf(iso: string): string {
  return new Date(new Date(iso).getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

/** 平日（土日でも祝日でもない）か。isHoliday は push-reminders の isHolidayJst（祝日名 or null） */
export function isBusinessDay(dateStr: string, isHoliday: (dateStr: string) => string | null): boolean {
  const dow = dayOfWeek(dateStr);
  return dow !== 0 && dow !== 6 && !isHoliday(dateStr);
}

/**
 * 再通知する日＝期限の「直前の平日」（期限当日より前で、土日・祝日でない最も近い日）。
 * 例：期限が月曜なら金曜、期限の前日が祝日ならその前の平日。30日さかのぼっても無ければ null。
 */
export function reminderDateFor(dueDate: string, isHoliday: (dateStr: string) => string | null): string | null {
  let d = addDays(dueDate, -1);
  for (let i = 0; i < 30; i++) {
    if (isBusinessDay(d, isHoliday)) return d;
    d = addDays(d, -1);
  }
  return null;
}

export interface ReminderCandidate {
  id: number;
  due_date: string | null;
  requires_ack: boolean;
  created_at: string;
}

/**
 * 今日（JST・平日の cron 実行）このお知らせの再通知を送るか。
 * - 確認ボタンあり・期限ありだけ
 * - 今日が再通知日以降、かつ期限当日より前（cron が1日止まっても、期限前なら翌平日に送る）
 * - 再通知日より前に送ったお知らせだけ（再通知日当日以降に送ったものは届いたばかりなので送らない）
 * 1人1回は DB（claim_admin_message_reminders の reminded_at）が保証する。
 */
export function shouldRemindToday(
  m: ReminderCandidate, today: string, isHoliday: (dateStr: string) => string | null,
): boolean {
  if (!m.requires_ack || !m.due_date) return false;
  if (today >= m.due_date) return false;
  const remind = reminderDateFor(m.due_date, isHoliday);
  if (!remind || today < remind) return false;
  return jstDateOf(m.created_at) < remind;
}

// ===== 送信者へのまとめ通知（SQL の acknowledge_admin_message と同じ文面・規則） =====

export function buildAckSummary(subject: string, acked: number, total: number): { title: string; body: string } {
  const chars = [...subject];
  const short = chars.length > 30 ? `${chars.slice(0, 30).join("")}…` : subject;
  const title = `「${short}」を${acked}人が確認しました`;
  const body = acked >= total ? `全員（${total}人）が確認しました` : `残り${total - acked}人（宛先${total}人）`;
  return { title, body };
}

/**
 * まとめ通知を未読に戻す（ベルに再び出す）か。まだ未読のまま・全員が確認した・前回出してから1時間以上、のどれか。
 * 確認が1件増えるたびに未読バッジが点くのを避けるため。
 */
export function shouldResurfaceAckNotice(
  existing: { read_at: string | null; created_at: string } | null, allAcked: boolean, now: Date,
): boolean {
  if (!existing) return true;
  if (existing.read_at === null || allAcked) return true;
  return new Date(existing.created_at).getTime() < now.getTime() - 3_600_000;
}

// ===== 通知の文面 =====

export function adminMessageUrl(messageId: number): string {
  return `/?open=admin-message&mid=${messageId}`;
}

export function truncateChars(s: string, n: number): string {
  const chars = [...s];
  return chars.length > n ? `${chars.slice(0, n).join("")}…` : s;
}

export function buildAdminMessagePushPayload(m: { id: number; subject: string; body: string }): PushPayload {
  return {
    title: `📣 ${truncateChars(m.subject, 60)}`,
    body: truncateChars(m.body.replace(/\s+/g, " ").trim(), 120),
    url: adminMessageUrl(m.id),
    tag: `admin-message-${m.id}`,
  };
}

export function formatDueShort(dueDate: string): string {
  const [, m, d] = dueDate.split("-").map(Number);
  return `${m}/${d}`;
}

export function buildAdminReminderPushPayload(m: { id: number; subject: string; due_date: string }): PushPayload {
  return {
    title: `📣 【期限 ${formatDueShort(m.due_date)}】${truncateChars(m.subject, 50)}`,
    body: "「確認しました」がまだです。内容を確認してボタンを押してください。",
    url: adminMessageUrl(m.id),
    tag: `admin-message-remind-${m.id}`,
  };
}
