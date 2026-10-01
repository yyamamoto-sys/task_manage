// src/lib/reminder/notificationPrefs.ts
//
// 期限リマインドの個人設定（notification_prefs）の型・既定値・時刻の選択肢。
// 既定値は Edge Function 側（supabase/functions/_shared/reminderLogic.ts）と同じ値を持つ
// （一致は src/lib/reminder/__tests__/reminderLogic.test.ts で検査する）。

export interface NotificationPrefs {
  inapp_enabled: boolean;
  push_enabled: boolean;
  notify_overdue: boolean;
  notify_due_today: boolean;
  /** "HH:MM"（JST） */
  reminder_time: string;
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  inapp_enabled: true,
  push_enabled: false,
  notify_overdue: true,
  notify_due_today: true,
  reminder_time: "08:30",
};

/** 7:00〜19:00 の30分刻み（25件）。DB の CHECK 制約と同じ範囲 */
export const REMINDER_TIME_OPTIONS: readonly string[] = (() => {
  const out: string[] = [];
  for (let m = 7 * 60; m <= 19 * 60; m += 30) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  }
  return out;
})();

/** "08:30:00" → "08:30"。選択肢に無い値は既定値に寄せる（不正な時刻をそのまま保存しない） */
export function toReminderTimeOption(dbTime: string | null | undefined): string {
  const m = /^(\d{1,2}):(\d{2})/.exec((dbTime ?? "").trim());
  if (!m) return DEFAULT_NOTIFICATION_PREFS.reminder_time;
  const hhmm = `${m[1].padStart(2, "0")}:${m[2]}`;
  return REMINDER_TIME_OPTIONS.includes(hhmm) ? hhmm : DEFAULT_NOTIFICATION_PREFS.reminder_time;
}

/** 表示用 "08:30" → "8:30" */
export function formatReminderTime(hhmm: string): string {
  return hhmm.replace(/^0(\d):/, "$1:");
}

/** DB の行（無ければ null）から画面で使う設定を作る。行が無い人は既定値 */
export function prefsFromRow(row: Partial<NotificationPrefs> | null | undefined): NotificationPrefs {
  if (!row) return { ...DEFAULT_NOTIFICATION_PREFS };
  return {
    inapp_enabled: row.inapp_enabled ?? DEFAULT_NOTIFICATION_PREFS.inapp_enabled,
    push_enabled: row.push_enabled ?? DEFAULT_NOTIFICATION_PREFS.push_enabled,
    notify_overdue: row.notify_overdue ?? DEFAULT_NOTIFICATION_PREFS.notify_overdue,
    notify_due_today: row.notify_due_today ?? DEFAULT_NOTIFICATION_PREFS.notify_due_today,
    reminder_time: toReminderTimeOption(row.reminder_time),
  };
}
