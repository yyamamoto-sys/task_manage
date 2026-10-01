// supabase/functions/_shared/clientErrorDigest.ts
//
// 利用者の画面で起きたエラーを、super_admin へ Windows通知でまとめて知らせる（v3.129・push-reminders の
// 30分ごとの cron 実行で1回）。アプリ内通知は log_client_error（SQL）がその場で作るため、ここは
// Windows通知だけを扱う。期限リマインドの1人1日1回（reminder_send_log）とは別枠。

import { isKindEnabled, type KindPrefsLike } from "./notificationKinds.ts";
import type { PushPayload } from "./reminderLogic.ts";

export const ERROR_DIGEST_URL = "/?open=admin-errors";
export const ERROR_DIGEST_CURSOR = "client_error_push_digest";
/** カーソルが無い（初回）ときに遡る幅＝cron の間隔 */
export const ERROR_DIGEST_INITIAL_LOOKBACK_MS = 30 * 60 * 1000;

export interface ErrorDigestLogRow {
  first_seen: string;
  last_seen: string;
}

export interface ErrorDigestMemberRow {
  id: string;
  is_super_admin?: boolean | null;
  is_deleted?: boolean | null;
}

export interface ErrorDigestCounts {
  /** 前回以降に発生したエラーの種類数（同じエラーは1件） */
  total: number;
  /** そのうち初めて記録されたもの */
  fresh: number;
}

export function countErrorsSince(rows: ErrorDigestLogRow[], sinceIso: string, untilIso: string): ErrorDigestCounts {
  const since = Date.parse(sinceIso);
  const until = Date.parse(untilIso);
  let total = 0;
  let fresh = 0;
  for (const r of rows) {
    const last = Date.parse(r.last_seen);
    if (!(last > since && last <= until)) continue;
    total += 1;
    if (Date.parse(r.first_seen) > since) fresh += 1;
  }
  return { total, fresh };
}

export function buildErrorDigestPayload(c: ErrorDigestCounts): PushPayload {
  const freshPart = c.fresh > 0 ? `（新しいエラー${c.fresh}件）` : "";
  return {
    title: "🛡 管理者向け：利用者の画面でエラー",
    body: `前回の確認以降にエラー${c.total}件${freshPart}。設定 → 部署の管理 → アプリ設定 → エラー で確認できます。`,
    url: ERROR_DIGEST_URL,
    tag: "client-error-digest",
  };
}

/** Windows通知を受け取る super_admin（エラー種類の Windows がオンの人） */
export function selectErrorDigestRecipients(
  members: ErrorDigestMemberRow[],
  prefsById: Map<string, KindPrefsLike>,
): string[] {
  return members
    .filter((m) => m.is_super_admin === true && !m.is_deleted)
    .filter((m) => isKindEnabled(prefsById.get(m.id), "client_error", "push"))
    .map((m) => m.id);
}

export function resolveDigestWindow(cursorIso: string | null, now: Date): { since: string; until: string } {
  const until = now.toISOString();
  const since = cursorIso ?? new Date(now.getTime() - ERROR_DIGEST_INITIAL_LOOKBACK_MS).toISOString();
  return { since, until };
}
