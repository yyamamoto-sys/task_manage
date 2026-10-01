// supabase/functions/push-reminders/index.ts
//
// 期限リマインド（Windows通知＝Web Push ＋ アプリ内通知）。正本：docs/dev/web-push-reminder-design.md §6・§7。
//
// 【起動と認証】（--no-verify-jwt でデプロイする。config.toml が無いため付け忘れると cron が401になる）
//   - pg_cron：x-cron-secret = REMINDER_CRON_SECRET → 平日30分ごと。その時刻を選んでいる人へ送る（trigger='cron'）
//   - 管理画面：super_admin の JWT → 同じ処理（trigger='manual'）。?dryRun=1（または body.dryRun）なら何も書かず送らない
//   - 設定画面のテスト：本人の JWT ＋ ?test=1（または body.mode="test"）→ 本人の購読だけへ固定文面（trigger='test'）
//
// 【1人1日1回】claim_reminder_sends（INSERT … ON CONFLICT DO NOTHING RETURNING）が返した人だけへ送る（§6.1）。
// 【黙って止まらない】最初に running の行を書き、最後に結果で更新する。例外でも failed で閉じる（§6）。
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
  const isDryRun = url.searchParams.get("dryRun") === "1" || body.dryRun === true;

  // ===== 認証 =====
  const cronSecret = Deno.env.get("REMINDER_CRON_SECRET");
  let trigger: "cron" | "manual" | "test";
  let callerId: string | null = null;
  if (cronSecret && timingSafeEqualString(req.headers.get("x-cron-secret") ?? "", cronSecret)) {
    if (isTest) return json({ error: "test は本人のログインでのみ実行できます", status: 400 }, 400, cors);
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
    if (!isTest && !member.is_super_admin) return json({ error: "Forbidden", status: 403 }, 403, cors);
    if (!allowRate(callerId)) {
      return json({ error: "RATE_LIMIT_EXCEEDED", status: 429, message: "短時間に繰り返し実行されています。1分ほど待ってから再度お試しください。" }, 429, cors);
    }
    trigger = isTest ? "test" : "manual";
  }

  const vapid = readVapidConfig();

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

  try {
    // 祝日判定（isHolidayJst）は読み込み失敗時に throw しうる。ここで投げれば下の catch が
    // reminder_runs を failed で閉じて 500 を返す（黙って「祝日ではない」扱いにしない）。
    const daySkip = resolveDaySkip(slot, isHolidayJst);
    if (daySkip.skip && !isDryRun) {
      await finishRun(supabase, runId as number, {
        status: "success", target_members: 0, inapp_written: 0,
        push_attempted: 0, push_succeeded: 0, push_failed: 0, subscriptions_removed: 0,
        error_summary: daySkip.reason,
      });
      return json({ run_id: runId, status: "success", skipped: daySkip.reason }, 200, cors);
    }

    const { data: members, error: mErr } = await fetchAllRows<ReminderMemberRow>((o) => supabase
      .from("members").select("id, is_deleted", o).eq("is_deleted", false));
    if (mErr) throw new Error(`members の取得に失敗: ${mErr.message}`);
    const { data: prefs, error: pErr } = await fetchAllRows<PrefsRow>((o) => supabase
      .from("notification_prefs")
      .select("member_id, inapp_enabled, push_enabled, notify_overdue, notify_due_today, reminder_time", o), ["member_id"]);
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

    // 鍵が未設定で送れなかった人数も失敗に数える（黙って成功にしない）
    const pushConfigFailed = !vapid ? pushTargets.length : 0;
    const status = resolveRunStatus({
      pushAttempted: totals.attempted, pushSucceeded: totals.succeeded, pushFailed: totals.failed + pushConfigFailed,
      inappFailed, inappWritten,
    });
    await finishRun(supabase, runId as number, {
      status,
      target_members: targets.length,
      inapp_written: inappWritten,
      push_attempted: totals.attempted,
      push_succeeded: totals.succeeded,
      push_failed: totals.failed,
      subscriptions_removed: totals.removed,
      error_summary: errors.length > 0 ? errors.join(" | ").slice(0, 1000) : null,
    });
    return json({ run_id: runId, status, slot: slot.slotTime, target_members: targets.length, inapp_written: inappWritten, ...totals }, 200, cors);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[push-reminders] 失敗:", msg);
    if (runId !== null) await finishRun(supabase, runId, { status: "failed", error_summary: msg.slice(0, 1000) });
    return json({ error: "push-reminders failed", status: 500, detail: msg }, 500, cors);
  }
});
