// src/lib/notifications/notificationKinds.ts
//
// 通知の種類（v3.129）。定義の正本は supabase/functions/_shared/notificationKinds.ts（Edge Function と共有）。
// ここでは画面用のアイコンと未読バッジの表記だけを足す。種類を足す手順は CLAUDE.md Section 67。

import { audienceOfInAppKind, type NotificationKindId } from "../../../supabase/functions/_shared/notificationKinds.ts";

export {
  NOTIFICATION_KINDS, NOTIFICATION_CHANNELS, DEFAULT_KIND_PREFS,
  audienceOfInAppKind, buildKindChannelPatch, findKind, isKindEnabled, kindChannelChecked, kindChannelSetting,
  kindsVisibleTo, sanitizeKindChannels,
} from "../../../supabase/functions/_shared/notificationKinds.ts";
export type {
  KindChannels, KindPrefsLike, NotificationAudience, NotificationChannel, NotificationKindDef, NotificationKindId,
} from "../../../supabase/functions/_shared/notificationKinds.ts";

/** 表示名・説明は i18n の layout.notifyKind.<id>.label / .desc */
export const NOTIFICATION_KIND_ICON: Record<NotificationKindId, string> = {
  deadline_overdue: "⏰",
  deadline_due_today: "📅",
  mention: "💬",
  client_error: "🛡",
};

/** in_app_notifications.kind の CHECK 制約にある値（migrations/20261001c と同じ） */
export const ALL_IN_APP_KINDS = ["deadline_digest", "backup_failure", "backup_weekly_summary", "client_error"] as const;

/** ベルの「管理者向け」で絞り込む kind */
export const ADMIN_IN_APP_KINDS: string[] = ALL_IN_APP_KINDS.filter((k) => audienceOfInAppKind(k) === "super_admin");

/** 管理者向けの印（ベル・設定画面で共通） */
export const ADMIN_NOTICE_ICON = "🛡";

/** ベルの未読バッジ：0 は出さない、100 以上は "99+" */
export function formatBadgeCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "";
  return n >= 100 ? "99+" : String(Math.floor(n));
}
