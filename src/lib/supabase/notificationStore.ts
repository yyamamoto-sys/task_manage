// src/lib/supabase/notificationStore.ts
//
// 期限リマインド（v3.128）の読み書き。テーブルは migrations/20261001_web_push_reminders.sql。
// RLS は本人の行のみ（reminder_runs は super_admin のみ）。一覧は件数を絞る（.limit）ため
// fetchAllRows の対象外（Section 61 の例外規定）。

import { supabase } from "./client";
import { buildInvokeErrorMessage } from "../ai/edgeFunctionError";
import type { NotificationPrefs } from "../reminder/notificationPrefs";
import type { ReminderRunLite } from "../reminder/reminderHealth";

export const IN_APP_LIST_LIMIT = 30;
export const REMINDER_RUNS_LIMIT = 30;

export interface InAppNotification {
  id: number;
  kind: "deadline_digest" | "backup_failure" | "backup_weekly_summary" | "client_error" | "admin_message" | "admin_message_ack";
  title: string;
  body: string;
  url: string;
  created_at: string;
  read_at: string | null;
  /** v3.131：管理者からのお知らせへの参照（admin_message / admin_message_ack のみ） */
  message_id?: number | null;
}

export interface ReminderRun extends ReminderRunLite {
  id: number;
  finished_at: string | null;
  triggered_by: string | null;
  slot_time: string | null;
  target_members: number | null;
  inapp_written: number | null;
  push_succeeded: number | null;
  subscriptions_removed: number | null;
  error_summary: string | null;
  error_digest_sent?: number | null;
}

export async function fetchNotificationPrefsRow(memberId: string): Promise<Partial<NotificationPrefs> | null> {
  const { data, error } = await supabase
    .from("notification_prefs")
    .select("inapp_enabled, push_enabled, notify_overdue, notify_due_today, reminder_time, kind_channels")
    .eq("member_id", memberId)
    .maybeSingle();
  if (error) throw error;
  return (data as Partial<NotificationPrefs> | null) ?? null;
}

export async function upsertNotificationPrefs(memberId: string, prefs: NotificationPrefs): Promise<void> {
  const { error } = await supabase
    .from("notification_prefs")
    .upsert({ member_id: memberId, ...prefs, reminder_time: `${prefs.reminder_time}:00` }, { onConflict: "member_id" });
  if (error) throw error;
}

export async function registerPushSubscription(endpoint: string, p256dh: string, auth: string): Promise<void> {
  const { error } = await supabase.rpc("register_push_subscription", {
    p_endpoint: endpoint, p_p256dh: p256dh, p_auth: auth,
    p_user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
  });
  if (error) throw error;
}

export async function deletePushSubscription(endpoint: string): Promise<void> {
  const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  if (error) throw error;
}

/** このブラウザの endpoint が自分の購読としてDBにあるか */
export async function hasPushSubscriptionRow(endpoint: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("push_subscriptions").select("id").eq("endpoint", endpoint).limit(1);
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

export async function fetchInAppNotifications(memberId: string, opts: { kinds?: string[] } = {}): Promise<InAppNotification[]> {
  const base = supabase
    .from("in_app_notifications")
    .select("id, kind, title, body, url, created_at, read_at, message_id")
    .eq("member_id", memberId)
    .order("created_at", { ascending: false })
    .limit(IN_APP_LIST_LIMIT);
  const { data, error } = await (opts.kinds ? base.in("kind", opts.kinds) : base);
  if (error) throw error;
  return (data ?? []) as InAppNotification[];
}

export async function countUnreadInAppNotifications(memberId: string): Promise<number> {
  const { count, error } = await supabase
    .from("in_app_notifications")
    .select("id", { count: "exact", head: true })
    .eq("member_id", memberId)
    .is("read_at", null)
    .limit(1);
  if (error) throw error;
  return count ?? 0;
}

/** ids を省略すると本人の未読をすべて既読にする */
export async function markInAppNotificationsRead(ids: number[] | null): Promise<void> {
  const { error } = await supabase.rpc("mark_in_app_notifications_read", { p_ids: ids });
  if (error) throw error;
}

export interface PushTestResult {
  attempted: number;
  succeeded: number;
  failed: number;
  removed: number;
  errorSummary: string | null;
}

export async function sendTestPush(): Promise<PushTestResult> {
  const { data, error, response } = await supabase.functions.invoke("push-reminders", { body: { mode: "test" } });
  if (error) throw new Error(await buildInvokeErrorMessage(data, error, response));
  return data as PushTestResult;
}

export interface ReminderDryRunPerson {
  memberId: string;
  reminderTime: string;
  inapp: boolean;
  push: boolean;
  title: string;
  body: string;
  subscriptionCount: number;
}

export interface ReminderDryRunResult {
  date: string;
  currentSlot: string;
  daySkip: string | null;
  vapidConfigured: boolean;
  people: ReminderDryRunPerson[];
}

export async function runReminderDryRun(): Promise<ReminderDryRunResult> {
  const { data, error, response } = await supabase.functions.invoke("push-reminders", { body: { dryRun: true } });
  if (error) throw new Error(await buildInvokeErrorMessage(data, error, response));
  return data as ReminderDryRunResult;
}

export async function fetchRecentReminderRuns(opts: { cronOnly?: boolean } = {}): Promise<ReminderRun[]> {
  const base = supabase
    .from("reminder_runs")
    .select("id, started_at, finished_at, trigger, triggered_by, slot_time, status, target_members, inapp_written, push_attempted, push_succeeded, push_failed, subscriptions_removed, error_summary, error_digest_sent")
    .order("started_at", { ascending: false })
    .limit(REMINDER_RUNS_LIMIT);
  const { data, error } = await (opts.cronOnly ? base.eq("trigger", "cron") : base);
  if (error) throw error;
  return (data ?? []) as ReminderRun[];
}

export async function fetchPushSubscriptionStats(): Promise<{ subscriptions: number; members: number }> {
  const { data, error } = await supabase.rpc("push_subscription_stats");
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    subscriptions: Number(row?.subscription_count ?? 0),
    members: Number(row?.member_count ?? 0),
  };
}
