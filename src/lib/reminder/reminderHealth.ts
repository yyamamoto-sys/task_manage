// src/lib/reminder/reminderHealth.ts
//
// 期限リマインドが「黙って止まっていない」かの判定（管理画面バナー。設計書 §6.3）。
// BackupHealthBanner の backupHealth.ts と同じく、基準時刻は引数で受け取る純粋関数。
//
//   🔴 赤：JST の平日に、30分以上前の予定起動スロット（直前のもの）の cron 実行記録が無い、
//          または failed／running のまま（数秒で終わるはずの処理が終わっていない＝途中で落ちた）。
//          予定スロットは 7:00〜19:30（pg_cron の登録と同じ）。範囲外・土日は判定しない。
//   🟡 黄：直近の cron 実行が partial、または Windows通知の失敗率が50%以上。

export interface ReminderRunLite {
  started_at: string;
  trigger: "cron" | "manual" | "test";
  status: "running" | "success" | "partial" | "failed";
  push_attempted: number | null;
  push_failed: number | null;
}

export type ReminderHealthLevel = "red" | "yellow" | "none";

export interface ReminderHealthResult {
  level: ReminderHealthLevel;
  /** 赤のとき、記録が無い／失敗したスロット（JST "HH:MM"） */
  missedSlot: string | null;
  /** 赤のとき、記録が無いのか（missing）失敗したのか（failed） */
  reason: "missing" | "failed" | "partial" | "push_failures" | null;
}

const SLOT_MS = 30 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const FIRST_SLOT_MIN = 7 * 60;
const LAST_SLOT_MIN = 19 * 60 + 30;

function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function resolveReminderHealth(runs: readonly ReminderRunLite[], now: Date): ReminderHealthResult {
  const cronRuns = runs
    .filter(r => r.trigger === "cron")
    .sort((a, b) => (a.started_at < b.started_at ? 1 : -1));

  // 30分以上経った直前の予定スロット（UTC ms）
  const prevSlotStart = Math.floor(now.getTime() / SLOT_MS) * SLOT_MS - SLOT_MS;
  const jst = new Date(prevSlotStart + JST_OFFSET_MS);
  const dow = jst.getUTCDay();
  const minuteOfDay = jst.getUTCHours() * 60 + jst.getUTCMinutes();
  const inSchedule = dow >= 1 && dow <= 5 && minuteOfDay >= FIRST_SLOT_MIN && minuteOfDay <= LAST_SLOT_MIN;

  if (inSchedule) {
    const inWindow = cronRuns.filter(r => {
      const t = new Date(r.started_at).getTime();
      return t >= prevSlotStart && t < prevSlotStart + SLOT_MS;
    });
    const slot = hhmm(minuteOfDay);
    if (inWindow.length === 0) return { level: "red", missedSlot: slot, reason: "missing" };
    if (!inWindow.some(r => r.status === "success" || r.status === "partial")) {
      return { level: "red", missedSlot: slot, reason: "failed" };
    }
  }

  const latest = cronRuns.find(r => r.status !== "running");
  if (latest) {
    if (latest.status === "partial") return { level: "yellow", missedSlot: null, reason: "partial" };
    const attempted = latest.push_attempted ?? 0;
    const failed = latest.push_failed ?? 0;
    if (attempted > 0 && failed / attempted >= 0.5) return { level: "yellow", missedSlot: null, reason: "push_failures" };
  }
  return { level: "none", missedSlot: null, reason: null };
}
