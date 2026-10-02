// supabase/functions/push-reminders/index.ts
//
// 期限リマインド（Windows通知＝Web Push ＋ アプリ内通知）。正本：docs/dev/web-push-reminder-design.md §6・§7。
//
// 【起動と認証】（--no-verify-jwt でデプロイする。config.toml が無いため付け忘れると cron が401になる）
//   - pg_cron：x-cron-secret = REMINDER_CRON_SECRET → 平日30分ごと。その時刻を選んでいる人へ送る（trigger='cron'）
//   - 管理画面：super_admin の JWT → 同じ処理（trigger='manual'）。?dryRun=1（または body.dryRun）なら何も書かず送らない
//   - 設定画面のテスト：本人の JWT ＋ ?test=1（または body.mode="test"）→ 本人の購読だけへ固定文面（trigger='test'）
//   - v3.131 お知らせの即時送信：送信者本人の JWT ＋ body.mode="admin_message"・body.messageId。
//     🔴 宛先はクライアントから受け取らない。DB に記録済みの admin_message_recipients だけへ送る。
//     送信者本人のお知らせでなければ 403。push_dispatched_at で1通につき1回だけ（二重呼び出しでも再送しない）
//
// 【v3.131 お知らせの cron 側】(1) 送信直後の呼び出しが届かなかったお知らせ（画面を閉じた等）の Windows通知を
//   代わりに送る（作成から2分以上・5日以内で push_dispatched_at が空のもの。独立レビュー指摘・中：cron は
//   平日7:00〜19:30のみ起動のため、金曜夜の送信を月曜朝が拾えるように24時間から広げた）。(2) 期限つき・確認ボタンありの
//   お知らせを、期限の直前の平日（_shared/adminMessageLogic.ts の shouldRemindToday）に未確認の人へ1回だけ再通知。
//
// 【1人1日1回】claim_reminder_sends（INSERT … ON CONFLICT DO NOTHING RETURNING）が返した人だけへ送る（§6.1）。
// 【黙って止まらない】最初に running の行を書き、最後に結果で更新する。例外でも failed で閉じる（§6）。
// 【v3.129 エラーのまとめ通知】cron の実行ごとに、前回以降に利用者の画面で起きたエラーの件数を
//   super_admin（エラー種類の Windows がオンの人）へ Windows通知で1回送る。期限の1人1日1回とは別枠
//   （reminder_send_log を使わない）。どこまで送ったかは notification_cursors に持つ。
//   🔴 独立レビュー指摘・軽：「休日でも送る」ではない。cron 自体が平日 JST 7:00〜19:30 のみ起動するため、
//   土日に起きたエラーは実行されず、月曜7:00の実行がまとめて拾う（notification_cursors が前回からの
//   窓を持つため、週末分もその1回に含まれる）。祝日は cron の曜日判定（0-4/1-5）だけで動き、休日判定
//   （isHolidayJst・下の daySkip）を関知しないため、平日の祝日は通常どおり送る（daySkip は期限リマインド
//   だけを止める。runErrorDigest はその判定より前に実行する）。
//
// 必要な secrets：SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY（自動）・REMINDER_CRON_SECRET・
//   VAPID_PUBLIC_KEY・VAPID_PRIVATE_KEY・VAPID_SUBJECT・ALLOWED_ORIGINS（CORS。backup-daily と同じ）

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as JapaneseHolidays from "https://esm.sh/japanese-holidays@1";
import { fetchAllRows } from "../_shared/fetchAllRows.ts";
import {
  buildDigestPayload, buildDigests, buildJstHolidayDate, normalizeTime, pickClaimedTargets, resolveDaySkip,
  resolveHolidayCheckFn, resolveJstSlot, resolveRunStatus, TEST_PAYLOAD,
  type PrefsRow, type ReminderMemberRow, type ReminderTaskRow,
} from "../_shared/reminderLogic.ts";
import { readVapidConfig, sendToSubscriptions, type SendSummary, type StoredSubscription } from "../_shared/webPush.ts";
import { timingSafeEqualString } from "../_shared/timingSafeEqual.ts";
import { runWithConcurrency } from "../_shared/concurrencyPool.ts";
import {
  addDays, buildAdminMessagePushPayload, buildAdminReminderPushPayload, shouldRemindToday,
  type ReminderCandidate,
} from "../_shared/adminMessageLogic.ts";
import { isKindEnabled } from "../_shared/notificationKinds.ts";
import type { PushPayload } from "../_shared/reminderLogic.ts";
import {
  buildErrorDigestPayload, countErrorsSince, ERROR_DIGEST_CURSOR, resolveDigestWindow, selectErrorDigestRecipients,
  type ErrorDigestLogRow, type ErrorDigestMemberRow,
} from "../_shared/clientErrorDigest.ts";

const ALLOWED_ORIGINS = new Set<string>([
  "http://localhost:5173",
  "http://localhost:4173",
  ...(Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
]);

function getCorsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : [...ALLOWED_ORIGINS][0] ?? "*";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

// src/lib/date/holidays.ts と同じ判定（japanese-holidays の isHoliday(d, true)。振替休日を含む）。
// 日付構築・関数解決（読み込めない場合は throw）は _shared/reminderLogic.ts の純粋関数
// （buildJstHolidayDate・resolveHolidayCheckFn）に切り出し、vitest で検証している
// （独立レビュー指摘・軽。実行環境のタイムゾーン非依存・フェイルオープン防止）。
function isHolidayJst(dateStr: string): string | null {
  const fn = resolveHolidayCheckFn(JapaneseHolidays as unknown as Record<string, unknown>);
  return (fn(buildJstHolidayDate(dateStr), true) as string | undefined) ?? null;
}

// 1回の実行でWeb Pushを送る人数分、同時に何人まで並列送信するか（独立レビュー指摘・中）
const PUSH_SEND_CONCURRENCY = 10;

// JWT 呼び出しの連打防止（Section 18。テスト送信・手動実行のみが対象）
const RATE_LIMIT_PER_MIN = 6;
const rateMap = new Map<string, { count: number; resetAt: number }>();
function allowRate(key: string): boolean {
  const now = Date.now();
  const cur = rateMap.get(key);
  if (!cur || cur.resetAt <= now) {
    rateMap.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  cur.count += 1;
  return cur.count <= RATE_LIMIT_PER_MIN;
}

// deno-lint-ignore no-explicit-any
type Sb = any;

async function finishRun(supabase: Sb, runId: number, fields: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from("reminder_runs")
    .update({ ...fields, finished_at: new Date().toISOString() })
    .eq("id", runId);
  if (error) console.error("[push-reminders] reminder_runs の更新に失敗:", error.message);
}

async function fetchSubscriptions(supabase: Sb, memberIds: string[]): Promise<StoredSubscription[]> {
  if (memberIds.length === 0) return [];
  const { data, error } = await fetchAllRows<StoredSubscription>((o) => supabase
    .from("push_subscriptions")
    .select("id, member_id, endpoint, p256dh, auth, failure_count", o)
    .in("member_id", memberIds));
  if (error) throw new Error(`push_subscriptions の取得に失敗: ${error.message}`);
  return data;
}

interface ErrorDigestOutcome {
  errors: number;
  pushSucceeded: number;
  failure: string | null;
}

// 失敗しても期限リマインドは止めない（結果は error_summary に残す）。カーソルは送信の成否に関わらず進める
// （同じエラーを次の回に二重で知らせない。期限リマインドの「その日は再送しない」と同じ考え方）。
async function runErrorDigest(supabase: Sb, vapid: ReturnType<typeof readVapidConfig>, now: Date): Promise<ErrorDigestOutcome> {
  try {
    const { data: cursorRow, error: curErr } = await supabase
      .from("notification_cursors").select("cursor_at").eq("name", ERROR_DIGEST_CURSOR).maybeSingle();
    if (curErr) throw new Error(`notification_cursors の取得に失敗: ${curErr.message}`);
    const win = resolveDigestWindow((cursorRow?.cursor_at as string | undefined) ?? null, now);
    // last_notified_at で絞る（新規／解決済みからの再発だけを数える。既知の未解決の繰り返しは数えない。
    // 独立レビュー指摘・軽）
    const { data: logs, error: lErr } = await fetchAllRows<ErrorDigestLogRow>((o) => supabase
      .from("client_error_logs").select("id, first_seen, last_notified_at", o)
      .gt("last_notified_at", win.since).lte("last_notified_at", win.until));
    if (lErr) throw new Error(`client_error_logs の取得に失敗: ${lErr.message}`);
    const counts = countErrorsSince(logs, win.since, win.until);

    let pushSucceeded = 0;
    let failure: string | null = null;
    if (counts.total > 0) {
      const { data: admins, error: aErr } = await supabase
        .from("members").select("id, is_super_admin, is_deleted").eq("is_super_admin", true).eq("is_deleted", false);
      if (aErr) throw new Error(`super_admin の取得に失敗: ${aErr.message}`);
      const adminRows = (admins ?? []) as ErrorDigestMemberRow[];
      const { data: prefRows, error: prErr } = adminRows.length === 0 ? { data: [], error: null } : await supabase
        .from("notification_prefs").select("member_id, inapp_enabled, push_enabled, kind_channels")
        .in("member_id", adminRows.map((m) => m.id));
      if (prErr) throw new Error(`notification_prefs の取得に失敗: ${prErr.message}`);
      const prefsById = new Map((prefRows ?? []).map((r: PrefsRow) => [r.member_id, r]));
      const recipients = selectErrorDigestRecipients(adminRows, prefsById);
      if (recipients.length > 0) {
        if (!vapid) {
          failure = "VAPID の鍵が未設定のためエラーのまとめ通知を送れません";
        } else {
          const subs = await fetchSubscriptions(supabase, recipients);
          if (subs.length > 0) {
            const r = await sendToSubscriptions(supabase, subs, buildErrorDigestPayload(counts), vapid);
            pushSucceeded = r.succeeded;
            if (r.errorSummary) failure = `エラーのまとめ通知の送信失敗 ${r.errorSummary}`;
          }
        }
      }
    }

    const { error: upErr } = await supabase.from("notification_cursors")
      .upsert({ name: ERROR_DIGEST_CURSOR, cursor_at: win.until }, { onConflict: "name" });
    if (upErr) failure = [failure, `notification_cursors の更新に失敗: ${upErr.message}`].filter(Boolean).join(" / ");
    return { errors: counts.total, pushSucceeded, failure };
  } catch (e) {
    return { errors: 0, pushSucceeded: 0, failure: `エラーのまとめ通知: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ===== v3.131 管理者からのお知らせ =====

interface AdminPushOutcome {
  attempted: number;
  succeeded: number;
  failure: string | null;
}

/** 宛先のうち、お知らせの Windows通知がオンの人（全体スイッチ push_enabled AND 種類 admin_message の push） */
async function pushEnabledMembers(supabase: Sb, memberIds: string[]): Promise<string[]> {
  if (memberIds.length === 0) return [];
  const { data, error } = await fetchAllRows<PrefsRow>((o) => supabase
    .from("notification_prefs").select("member_id, inapp_enabled, push_enabled, kind_channels", o)
    .in("member_id", memberIds), ["member_id"]);
  if (error) throw new Error(`notification_prefs の取得に失敗: ${error.message}`);
  const byId = new Map(data.map((r) => [r.member_id, r]));
  // 行が無い人は既定値（push_enabled=false）＝送らない
  return memberIds.filter((id) => {
    const p = byId.get(id);
    return p ? isKindEnabled({
      inapp_enabled: p.inapp_enabled ?? true, push_enabled: p.push_enabled ?? false, kind_channels: p.kind_channels ?? {},
    }, "admin_message", "push") : false;
  });
}

async function sendPushToMembers(
  supabase: Sb, vapid: NonNullable<ReturnType<typeof readVapidConfig>>, memberIds: string[], payload: PushPayload,
): Promise<AdminPushOutcome> {
  const targets = await pushEnabledMembers(supabase, memberIds);
  if (targets.length === 0) return { attempted: 0, succeeded: 0, failure: null };
  const subs = await fetchSubscriptions(supabase, targets);
  const results = await runWithConcurrency(targets, PUSH_SEND_CONCURRENCY, async (id) => {
    const mine = subs.filter((s) => s.member_id === id);
    if (mine.length === 0) return { attempted: 0, succeeded: 0, failed: 0, removed: 0, errorSummary: null } as SendSummary;
    return sendToSubscriptions(supabase, mine, payload, vapid);
  });
  let attempted = 0;
  let succeeded = 0;
  const failures: string[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") {
      attempted += r.value.attempted;
      succeeded += r.value.succeeded;
      if (r.value.errorSummary) failures.push(r.value.errorSummary);
    } else {
      failures.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
    }
  }
  return { attempted, succeeded, failure: failures.length > 0 ? failures.join(" / ").slice(0, 300) : null };
}

/**
 * 1通のお知らせの Windows通知を送る。push_dispatched_at を「空なら今」に更新できたときだけ送る
 * （送信直後の呼び出しと cron の代行が重なっても1回だけ）。送信の成否に関わらず再送しない。
 */
async function dispatchAdminMessagePush(
  supabase: Sb, vapid: ReturnType<typeof readVapidConfig>, messageId: number,
): Promise<AdminPushOutcome & { alreadySent: boolean }> {
  const { data: claimed, error: cErr } = await supabase.from("admin_messages")
    .update({ push_dispatched_at: new Date().toISOString() })
    .eq("id", messageId).is("push_dispatched_at", null)
    .select("id, subject, body");
  if (cErr) throw new Error(`admin_messages の更新に失敗: ${cErr.message}`);
  const msg = (claimed ?? [])[0] as { id: number; subject: string; body: string } | undefined;
  if (!msg) return { attempted: 0, succeeded: 0, failure: null, alreadySent: true };
  if (!vapid) {
    const { error: uErr } = await supabase.from("admin_messages").update({ push_succeeded: 0 }).eq("id", messageId);
    if (uErr) console.error(`[push-reminders] admin_messages.push_succeeded の更新に失敗 (id=${messageId}):`, uErr.message);
    return { attempted: 0, succeeded: 0, failure: "VAPID の鍵が未設定のためお知らせの Windows通知を送れません", alreadySent: false };
  }
  const { data: recRows, error: rErr } = await fetchAllRows<{ member_id: string }>((o) => supabase
    .from("admin_message_recipients").select("member_id", o).eq("message_id", messageId), ["member_id"]);
  if (rErr) throw new Error(`admin_message_recipients の取得に失敗: ${rErr.message}`);
  const out = await sendPushToMembers(supabase, vapid, recRows.map((r) => r.member_id), buildAdminMessagePushPayload(msg));
  // 🔴 独立レビュー指摘・軽：更新の失敗を無視しない（console.error ＋ 送信記録の failure に残す。
  // push_dispatched_at は既に確定済みのため、ここが失敗しても再送はされない＝記録だけでも残す意味がある）
  const { error: uErr } = await supabase.from("admin_messages").update({ push_succeeded: out.succeeded }).eq("id", messageId);
  if (uErr) {
    console.error(`[push-reminders] admin_messages.push_succeeded の更新に失敗 (id=${messageId}):`, uErr.message);
  }
  const failures = [out.failure, uErr ? `push_succeeded の更新に失敗: ${uErr.message}` : null].filter(Boolean) as string[];
  return { ...out, failure: failures.length > 0 ? failures.join(" / ").slice(0, 300) : null, alreadySent: false };
}

// 代行送信の対象窓（独立レビュー指摘・中：24時間だと金曜夜の送信を月曜朝が拾えない。cron は平日
// JST 7:00〜19:30 のみ起動するため、金曜20時台の送信は月曜7:00には72時間以上経っていて24時間窓から
// 漏れていた。5日に広げる。push_dispatched_at IS NULL の1回保証はそのまま＝広げても二重送信にはならない）
const ADMIN_MESSAGE_BACKLOG_WINDOW_MS = 5 * 24 * 3_600_000;

/** 送信直後の呼び出しが届かなかったお知らせを cron が代わりに送る（作成から2分以上・5日以内） */
async function runAdminMessageBacklog(supabase: Sb, vapid: ReturnType<typeof readVapidConfig>, now: Date): Promise<string | null> {
  try {
    const { data, error } = await supabase.from("admin_messages").select("id")
      .is("push_dispatched_at", null)
      .lt("created_at", new Date(now.getTime() - 2 * 60_000).toISOString())
      .gt("created_at", new Date(now.getTime() - ADMIN_MESSAGE_BACKLOG_WINDOW_MS).toISOString())
      .limit(50);
    if (error) throw new Error(`admin_messages の取得に失敗: ${error.message}`);
    const failures: string[] = [];
    for (const row of (data ?? []) as { id: number }[]) {
      const r = await dispatchAdminMessagePush(supabase, vapid, row.id);
      if (r.failure) failures.push(r.failure);
    }
    return failures.length > 0 ? `お知らせの代行送信: ${failures.join(" / ")}`.slice(0, 400) : null;
  } catch (e) {
    return `お知らせの代行送信: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** 期限の直前の平日に、未確認の人へ1回だけ再通知（アプリ内は claim の中で必ず作る。Windows は本人の設定どおり） */
async function runAdminMessageReminders(
  supabase: Sb, vapid: ReturnType<typeof readVapidConfig>, today: string,
): Promise<string | null> {
  try {
    const { data, error } = await supabase.from("admin_messages")
      .select("id, due_date, requires_ack, created_at")
      .eq("requires_ack", true)
      .gt("due_date", today)
      .lte("due_date", addDays(today, 31));
    if (error) throw new Error(`admin_messages の取得に失敗: ${error.message}`);
    const ids = ((data ?? []) as ReminderCandidate[]).filter((m) => shouldRemindToday(m, today, isHolidayJst)).map((m) => m.id);
    if (ids.length === 0) return null;
    const { data: claimed, error: cErr } = await supabase.rpc("claim_admin_message_reminders", { p_message_ids: ids });
    if (cErr) throw new Error(`claim_admin_message_reminders に失敗: ${cErr.message}`);
    const rows = (claimed ?? []) as { message_id: number; member_id: string; subject: string; due_date: string }[];
    if (rows.length === 0) return null;
    if (!vapid) return "VAPID の鍵が未設定のためお知らせの再通知を Windows通知で送れません";
    const failures: string[] = [];
    // お知らせごとに1回送る（タグがお知らせごとに違うため、1人に複数あれば Windows 側で別の通知になる）
    for (const msgId of [...new Set(rows.map((r) => r.message_id))]) {
      const mine = rows.filter((r) => r.message_id === msgId);
      const payload = buildAdminReminderPushPayload({ id: msgId, subject: mine[0].subject, due_date: mine[0].due_date });
      const out = await sendPushToMembers(supabase, vapid, mine.map((r) => r.member_id), payload);
      if (out.failure) failures.push(out.failure);
    }
    return failures.length > 0 ? `お知らせの再通知: ${failures.join(" / ")}`.slice(0, 400) : null;
  } catch (e) {
    return `お知らせの再通知: ${e instanceof Error ? e.message : String(e)}`;
  }
}

Deno.serve(async (req: Request) => {
  const cors = getCorsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json({ error: "server misconfigured", status: 500 }, 500, cors);
  }
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const url = new URL(req.url);
  let body: Record<string, unknown> = {};
  if (req.method === "POST") {
    try { body = (await req.json()) ?? {}; } catch { body = {}; }
  }
  const isTest = url.searchParams.get("test") === "1" || body.mode === "test";
  const isAdminMessage = body.mode === "admin_message";
  const isDryRun = url.searchParams.get("dryRun") === "1" || body.dryRun === true;

  // ===== 認証 =====
  const cronSecret = Deno.env.get("REMINDER_CRON_SECRET");
  let trigger: "cron" | "manual" | "test";
  let callerId: string | null = null;
  if (cronSecret && timingSafeEqualString(req.headers.get("x-cron-secret") ?? "", cronSecret)) {
    if (isTest || isAdminMessage) return json({ error: "この操作は本人のログインでのみ実行できます", status: 400 }, 400, cors);
    trigger = "cron";
  } else {
    const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Unauthorized", status: 401 }, 401, cors);
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    const email = userData?.user?.email;
    if (userError || !email) return json({ error: "Unauthorized", status: 401 }, 401, cors);
    const { data: member, error: memberError } = await supabase
      .from("members").select("id, is_super_admin").eq("email", email).eq("is_deleted", false).maybeSingle();
    if (memberError || !member) return json({ error: "Unauthorized", status: 401 }, 401, cors);
    callerId = member.id as string;
    if (!isTest && !isAdminMessage && !member.is_super_admin) return json({ error: "Forbidden", status: 403 }, 403, cors);
    // 🔴 独立レビュー指摘・軽：お知らせの即時送信（isAdminMessage）はこの1分6回の上限から外す
    // （send_admin_message が1人1時間10通・24時間30通で頻度を制限済み。二重に制限しない）
    if (!isAdminMessage && !allowRate(callerId)) {
      return json({ error: "RATE_LIMIT_EXCEEDED", status: 429, message: "短時間に繰り返し実行されています。1分ほど待ってから再度お試しください。" }, 429, cors);
    }
    trigger = isTest ? "test" : "manual";
  }

  const vapid = readVapidConfig();

  // ===== お知らせの即時送信（送信者本人のみ。宛先は DB に記録済みのものだけ） =====
  if (isAdminMessage) {
    const messageId = Number(body.messageId);
    if (!Number.isSafeInteger(messageId) || messageId <= 0) return json({ error: "messageId が不正です", status: 400 }, 400, cors);
    const { data: msg, error: mErr } = await supabase.from("admin_messages").select("id, sender_id").eq("id", messageId).maybeSingle();
    if (mErr) return json({ error: "admin_messages の取得に失敗", status: 500, detail: mErr.message }, 500, cors);
    if (!msg || msg.sender_id !== callerId) return json({ error: "Forbidden", status: 403 }, 403, cors);
    try {
      const r = await dispatchAdminMessagePush(supabase, vapid, messageId);
      return json({ ok: true, ...r }, 200, cors);
    } catch (e) {
      return json({ error: "ADMIN_MESSAGE_PUSH_FAILED", status: 500, message: e instanceof Error ? e.message : String(e) }, 500, cors);
    }
  }

  // ===== テスト送信（本人の購読だけ） =====
  if (trigger === "test") {
    if (!vapid) return json({ error: "VAPID_NOT_CONFIGURED", status: 500, message: "Windows通知の鍵が未設定です（管理者に連絡してください）" }, 500, cors);
    const { data: run } = await supabase.from("reminder_runs")
      .insert({ trigger: "test", triggered_by: callerId, status: "running" }).select("id").single();
    try {
      const subs = await fetchSubscriptions(supabase, [callerId as string]);
      const summary: SendSummary = subs.length === 0
        ? { attempted: 0, succeeded: 0, failed: 0, removed: 0, errorSummary: null }
        : await sendToSubscriptions(supabase, subs, TEST_PAYLOAD, vapid);
      if (run) {
        await finishRun(supabase, run.id, {
          status: summary.failed > 0 ? (summary.succeeded > 0 ? "partial" : "failed") : "success",
          target_members: 1, inapp_written: 0,
          push_attempted: summary.attempted, push_succeeded: summary.succeeded, push_failed: summary.failed,
          subscriptions_removed: summary.removed,
          error_summary: subs.length === 0 ? "購読なし" : summary.errorSummary,
        });
      }
      return json({ ok: true, ...summary }, 200, cors);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (run) await finishRun(supabase, run.id, { status: "failed", error_summary: msg.slice(0, 500) });
      return json({ error: "TEST_FAILED", status: 500, message: msg }, 500, cors);
    }
  }

  // ===== 定期送信（cron）・手動実行・dryRun =====
  const now = new Date();
  const slot = resolveJstSlot(now);

  let runId: number | null = null;
  if (!isDryRun) {
    const { data: run, error: runError } = await supabase.from("reminder_runs")
      .insert({ trigger, triggered_by: callerId, status: "running", slot_time: slot.slotTime })
      .select("id").single();
    if (runError || !run) {
      return json({ error: "reminder_runs insert failed", status: 500, detail: runError?.message }, 500, cors);
    }
    runId = run.id as number;
  }

  let digest: ErrorDigestOutcome | null = null;
  const adminFailures: string[] = [];
  try {
    if (trigger === "cron" && !isDryRun) {
      digest = await runErrorDigest(supabase, vapid, now);
      const backlog = await runAdminMessageBacklog(supabase, vapid, now);
      if (backlog) adminFailures.push(backlog);
    }
    // 届いたときだけ列に書く（マイグレ未適用で列が無いと、実行記録の更新ごと失敗して running のまま残るため）
    const digestFields = digest && digest.pushSucceeded > 0 ? { error_digest_sent: digest.pushSucceeded } : {};

    // 祝日判定（isHolidayJst）は読み込み失敗時に throw しうる。ここで投げれば下の catch が
    // reminder_runs を failed で閉じて 500 を返す（黙って「祝日ではない」扱いにしない）。
    const daySkip = resolveDaySkip(slot, isHolidayJst);
    if (daySkip.skip && !isDryRun) {
      await finishRun(supabase, runId as number, {
        status: digest?.failure || adminFailures.length > 0 ? "partial" : "success", target_members: 0, inapp_written: 0,
        push_attempted: 0, push_succeeded: 0, push_failed: 0, subscriptions_removed: 0,
        error_summary: [daySkip.reason, digest?.failure, ...adminFailures].filter(Boolean).join(" | "),
        ...digestFields,
      });
      return json({ run_id: runId, status: "success", skipped: daySkip.reason }, 200, cors);
    }

    // 期限前日の再通知は平日だけ（上の休日スキップより後）。期限リマインドの1人1日1回とは別枠
    if (trigger === "cron" && !isDryRun) {
      const reminderFailure = await runAdminMessageReminders(supabase, vapid, slot.date);
      if (reminderFailure) adminFailures.push(reminderFailure);
    }

    const { data: members, error: mErr } = await fetchAllRows<ReminderMemberRow>((o) => supabase
      .from("members").select("id, is_deleted", o).eq("is_deleted", false));
    if (mErr) throw new Error(`members の取得に失敗: ${mErr.message}`);
    const { data: prefs, error: pErr } = await fetchAllRows<PrefsRow>((o) => supabase
      .from("notification_prefs")
      .select("member_id, inapp_enabled, push_enabled, notify_overdue, notify_due_today, reminder_time, kind_channels", o), ["member_id"]);
    if (pErr) throw new Error(`notification_prefs の取得に失敗: ${pErr.message}`);
    const { data: tasks, error: tErr } = await fetchAllRows<ReminderTaskRow>((o) => supabase
      .from("tasks")
      .select("id, name, status, due_date, created_at, is_deleted, assignee_member_id, assignee_member_ids", o)
      .eq("is_deleted", false)
      .in("status", ["todo", "in_progress"])
      .not("due_date", "is", null)
      .lte("due_date", slot.date));
    if (tErr) throw new Error(`tasks の取得に失敗: ${tErr.message}`);

    // ===== dryRun：時刻で絞らず全員分を返す（各人の送信時刻つき）。DB には何も書かない =====
    if (isDryRun) {
      const all = buildDigests({ members, prefs, tasks, today: slot.date, slotTime: null });
      const subs = await fetchSubscriptions(supabase, all.map((d) => d.memberId));
      const subCount = new Map<string, number>();
      for (const s of subs) subCount.set(s.member_id, (subCount.get(s.member_id) ?? 0) + 1);
      const timeById = new Map(prefs.map((p) => [p.member_id, normalizeTime(p.reminder_time)]));
      return json({
        dryRun: true,
        date: slot.date,
        currentSlot: slot.slotTime,
        daySkip: daySkip.skip ? daySkip.reason : null,
        vapidConfigured: vapid !== null,
        people: all.map((d) => ({
          memberId: d.memberId,
          reminderTime: timeById.get(d.memberId) ?? "08:30",
          inapp: d.wantsInapp,
          push: d.wantsPush,
          title: d.title,
          body: d.body,
          subscriptionCount: subCount.get(d.memberId) ?? 0,
        })),
      }, 200, cors);
    }

    const digests = buildDigests({ members, prefs, tasks, today: slot.date, slotTime: slot.slotTime });
    let targets: typeof digests = [];
    if (digests.length > 0) {
      const { data: claimRows, error: cErr } = await supabase.rpc("claim_reminder_sends", {
        p_member_ids: digests.map((d) => d.memberId), p_send_date: slot.date, p_run_id: runId,
      });
      if (cErr) throw new Error(`claim_reminder_sends に失敗: ${cErr.message}`);
      targets = pickClaimedTargets(digests, claimRows);
    }

    // ① アプリ内通知（プッシュの成否と独立）
    let inappWritten = 0;
    let inappFailed = 0;
    const errors: string[] = [];
    const inappRows = targets.filter((d) => d.wantsInapp).map((d) => ({
      member_id: d.memberId, run_id: runId, kind: "deadline_digest", title: d.title, body: d.body, url: d.url,
    }));
    if (inappRows.length > 0) {
      const { error: iErr } = await supabase.from("in_app_notifications").insert(inappRows);
      if (iErr) {
        inappFailed = inappRows.length;
        errors.push(`アプリ内通知の書き込みに失敗（${inappRows.length}件）: ${iErr.message}`);
      } else {
        inappWritten = inappRows.length;
      }
    }

    // ② Web Push
    //
    // 送信は人ごとに同時実行数の上限（PUSH_SEND_CONCURRENCY）をつけて並列化する
    // （独立レビュー指摘・中。1人ずつawaitだと人数分だけ直列に時間がかかる）。
    // 1人1日1回のclaim（claim_reminder_sends）は↑で既に完了しているため、ここより後で
    // 何人並列に処理しても二重送信にはならない。送信に失敗した人をその場で再試行する
    // ことはしない＝「その日は再送しない」仕様のまま（claimは送信の成否を問わない。
    // 設計書 §6.1・§12）。
    const pushTargets = targets.filter((d) => d.wantsPush);
    const totals = { attempted: 0, succeeded: 0, failed: 0, removed: 0 };
    const failureSummaries: string[] = [];
    if (pushTargets.length > 0) {
      if (!vapid) {
        errors.push("VAPID の鍵が未設定のため Windows通知を送れません");
      } else {
        const subs = await fetchSubscriptions(supabase, pushTargets.map((d) => d.memberId));
        const results = await runWithConcurrency(pushTargets, PUSH_SEND_CONCURRENCY, async (d) => {
          const mine = subs.filter((s) => s.member_id === d.memberId);
          if (mine.length === 0) {
            return { attempted: 0, succeeded: 0, failed: 0, removed: 0, errorSummary: null } as SendSummary;
          }
          // sendToSubscriptions は内部で購読ごとの失敗を握りつぶす設計だが、ネットワーク断等で
          // この呼び出し自体が例外を投げても runWithConcurrency が他の人への送信を止めない
          // （Promise.allSettledベース）。
          return sendToSubscriptions(supabase, mine, buildDigestPayload(d, slot.date), vapid);
        });
        results.forEach((r, i) => {
          if (r.status === "fulfilled") {
            totals.attempted += r.value.attempted;
            totals.succeeded += r.value.succeeded;
            totals.failed += r.value.failed;
            totals.removed += r.value.removed;
            if (r.value.errorSummary) failureSummaries.push(r.value.errorSummary);
            return;
          }
          const d = pushTargets[i];
          const mineCount = subs.filter((s) => s.member_id === d.memberId).length;
          totals.attempted += mineCount;
          totals.failed += mineCount;
          const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
          failureSummaries.push(`member送信で例外(${mineCount}件): ${msg}`);
        });
      }
    }
    if (failureSummaries.length > 0) errors.push(`送信失敗 ${failureSummaries.join(" / ")}`);
    if (digest?.failure) errors.push(digest.failure);
    errors.push(...adminFailures);

    // 鍵が未設定で送れなかった人数も失敗に数える（黙って成功にしない）
    const pushConfigFailed = !vapid ? pushTargets.length : 0;
    const reminderStatus = resolveRunStatus({
      pushAttempted: totals.attempted, pushSucceeded: totals.succeeded, pushFailed: totals.failed + pushConfigFailed,
      inappFailed, inappWritten,
    });
    // エラーのまとめ通知の失敗は期限リマインドの成否と独立だが、黙って成功にしない（黄バナーに出す）
    const status = reminderStatus === "success" && (digest?.failure || adminFailures.length > 0) ? "partial" : reminderStatus;
    await finishRun(supabase, runId as number, {
      status,
      target_members: targets.length,
      inapp_written: inappWritten,
      push_attempted: totals.attempted,
      push_succeeded: totals.succeeded,
      push_failed: totals.failed,
      subscriptions_removed: totals.removed,
      error_summary: errors.length > 0 ? errors.join(" | ").slice(0, 1000) : null,
      ...digestFields,
    });
    return json({ run_id: runId, status, slot: slot.slotTime, target_members: targets.length, inapp_written: inappWritten, ...totals }, 200, cors);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[push-reminders] 失敗:", msg);
    if (runId !== null) await finishRun(supabase, runId, { status: "failed", error_summary: msg.slice(0, 1000) });
    return json({ error: "push-reminders failed", status: 500, detail: msg }, 500, cors);
  }
});
