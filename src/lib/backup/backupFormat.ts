// src/lib/backup/backupFormat.ts
//
// 【設計意図】
// 管理画面「バックアップ」タブ（BackupSection）・バナー（BackupHealthBanner）で共有する
// 表示用フォーマッタ。純粋関数のみ（I/Oを持たない）。

/** バイト数を人が読みやすい単位（KB/MB/GB）に変換する。1000進法ではなく1024進法。 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || Number.isNaN(bytes)) return "—";
  if (bytes < 1024) return `${bytes}B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = -1;
  do {
    value /= 1024;
    unitIndex += 1;
  } while (value >= 1024 && unitIndex < units.length - 1);
  return `${value.toFixed(value < 10 ? 2 : 1)}${units[unitIndex]}`;
}

/** ミリ秒を「◯.◯秒」表記にする。null/undefinedは実行中や未確定を表す想定。 */
export function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms)) return "—";
  return `${(ms / 1000).toFixed(1)}秒`;
}

/**
 * ISO文字列を Asia/Tokyo のローカル時刻表記（"YYYY-MM-DD HH:mm"）に変換する。
 * src/lib/version.ts の formatBuildTime と同じ方式（hourCycle:"h23" で深夜0時が
 * "24:00" になる既知のICU不具合を回避）。
 */
export function formatJstDateTime(isoUtc: string | null | undefined): string {
  if (!isoUtc) return "—";
  const date = new Date(isoUtc);
  if (Number.isNaN(date.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

/** 経過時間を「◯時間前」「◯日前」の簡潔な表記にする（バナー用）。 */
export function formatElapsedHours(hours: number | null): string {
  if (hours == null) return "一度も成功していません";
  if (hours < 1) return "1時間未満前";
  return `約${Math.floor(hours)}時間前`;
}

export function formatElapsedDays(days: number | null): string {
  if (days == null) return "一度も成功していません";
  if (days < 1) return "1日未満前";
  return `約${Math.floor(days)}日前`;
}
