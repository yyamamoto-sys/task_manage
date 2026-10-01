// src/lib/adminMessages/adminMessages.ts
//
// 管理者からのお知らせ（v3.131）。純粋関数の正本は supabase/functions/_shared/adminMessageLogic.ts
// （Edge Function と共有）。画面からはここを通して読む。

export {
  ADMIN_MESSAGE_BODY_MAX, ADMIN_MESSAGE_MAX_SELECTED, ADMIN_MESSAGE_PER_DAY, ADMIN_MESSAGE_PER_HOUR,
  ADMIN_MESSAGE_SUBJECT_MAX, addDays, buildAckSummary, formatDueShort, jstDateOf, reminderDateFor,
  resolveRecipients, shouldRemindToday, shouldResurfaceAckNotice, validateDraft,
} from "../../../supabase/functions/_shared/adminMessageLogic.ts";
export type {
  AdminMessageDraft, AdminMessageSender, AdminMessageTarget, ScopeMember, ScopeResult,
} from "../../../supabase/functions/_shared/adminMessageLogic.ts";

/** 今日（JST）の "YYYY-MM-DD" */
export function todayJst(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

/** 期限まであと何日か（JST の日付どうし。期限当日は 0、過ぎていれば負） */
export function daysUntil(dueDate: string, today: string): number {
  const [y1, m1, d1] = today.split("-").map(Number);
  const [y2, m2, d2] = dueDate.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

/** URL の mid（お知らせの id）を読む */
export function extractMessageId(search: string): number | null {
  const v = new URLSearchParams(search).get("mid");
  if (!v || !/^\d{1,15}$/.test(v)) return null;
  const n = Number(v);
  return n > 0 ? n : null;
}
