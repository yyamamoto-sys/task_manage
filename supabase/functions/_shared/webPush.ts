// supabase/functions/_shared/webPush.ts
//
// Web Push の送信（RFC 8291 暗号化・VAPID 署名は npm:web-push が行う）と、送信結果の
// push_subscriptions への反映。push-reminders が使い、フェーズ5.5で backup-daily も使う
// （設計書 §6.2：送信処理を二重実装しない）。
//
// ライブラリ選定は dev 試作（proto/web-push・commit 5374964）で Supabase Edge Runtime からの
// import と FCM への実送信を確認済み。送信先はブラウザが決めるプッシュサービス
// （Chrome=FCM・Edge=WNS）だけで、それ以外へは通信しない（設計書 §8.3）。
//
// 必要な secrets：VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY（web-push generate-vapid-keys の値）／
//   VAPID_SUBJECT（アプリのURL https://…。mailto: にしない＝個人アドレスをプッシュサービスに渡さない）

import webpush from "npm:web-push@3.6.7";
import { classifyPushStatus, summarizeFailures, type PushOutcome } from "./webPushCore.ts";
import { PUSH_TTL_SECONDS, type PushPayload } from "./reminderLogic.ts";

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export interface StoredSubscription {
  id: number;
  member_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  failure_count: number;
}

export interface SendSummary {
  attempted: number;
  succeeded: number;
  failed: number;
  removed: number;
  errorSummary: string | null;
}

// deno-lint-ignore no-explicit-any
type SupabaseLike = { from: (table: string) => any };

export function readVapidConfig(): VapidConfig | null {
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
  const subject = Deno.env.get("VAPID_SUBJECT") ?? "";
  if (!publicKey || !privateKey || !/^https:\/\//.test(subject)) return null;
  return { publicKey, privateKey, subject };
}

let configuredFor: string | null = null;
function ensureConfigured(c: VapidConfig): void {
  if (configuredFor === c.publicKey) return;
  webpush.setVapidDetails(c.subject, c.publicKey, c.privateKey);
  configuredFor = c.publicKey;
}

export async function sendOne(sub: StoredSubscription, payload: PushPayload, config: VapidConfig): Promise<PushOutcome> {
  ensureConfigured(config);
  try {
    const res = await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      { TTL: PUSH_TTL_SECONDS, urgency: "normal" },
    );
    return classifyPushStatus(res?.statusCode ?? null);
  } catch (e) {
    // deno-lint-ignore no-explicit-any
    const status = (e as any)?.statusCode;
    return classifyPushStatus(typeof status === "number" ? status : null, e instanceof Error ? e.name : "error");
  }
}

/**
 * 購読ごとに送り、結果を push_subscriptions に書き戻す。1件の失敗で全体を止めない。
 * 410/404 は失効した購読として行を消す。
 */
export async function sendToSubscriptions(
  supabase: SupabaseLike,
  subs: StoredSubscription[],
  payload: PushPayload,
  config: VapidConfig,
): Promise<SendSummary> {
  const outcomes = await Promise.all(subs.map((s) => sendOne(s, payload, config)));
  const nowIso = new Date().toISOString();
  const okIds: number[] = [];
  const goneIds: number[] = [];
  const failed: StoredSubscription[] = [];
  outcomes.forEach((o, i) => {
    if (o.kind === "ok") okIds.push(subs[i].id);
    else if (o.kind === "gone") goneIds.push(subs[i].id);
    else failed.push(subs[i]);
  });

  if (okIds.length > 0) {
    await supabase.from("push_subscriptions")
      .update({ last_success_at: nowIso, failure_count: 0 })
      .in("id", okIds);
  }
  if (goneIds.length > 0) {
    await supabase.from("push_subscriptions").delete().in("id", goneIds);
  }
  for (const s of failed) {
    await supabase.from("push_subscriptions")
      .update({ last_failure_at: nowIso, failure_count: (s.failure_count ?? 0) + 1 })
      .eq("id", s.id);
  }

  return {
    attempted: subs.length,
    succeeded: okIds.length,
    failed: failed.length,
    removed: goneIds.length,
    errorSummary: summarizeFailures(outcomes),
  };
}
