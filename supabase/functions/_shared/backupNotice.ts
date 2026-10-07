// supabase/functions/_shared/backupNotice.ts
//
// 日次バックアップの通知（v3.136・設計書 §6.2・フェーズ5.5）。失敗・一部失敗と週次サマリを、super_admin への
// アプリ内通知＋Windows通知で送る（旧：Teams）。ここは文面と宛先の判定だけ（Deno・npm 非依存の純粋関数）。
// 送信は backup-daily が _shared/webPush.ts の sendToSubscriptions で行う。
//
// 🔴 本文に失敗理由（例外メッセージ）を載せない。接続先・キーが混ざりうるため。理由は backup_runs.error_message
// （伏せ字済み）に残っており、クリック先の管理画面「バックアップ」で読める。

import { isKindEnabled, type KindPrefsLike, type NotificationChannel } from "./notificationKinds.ts";
import type { PushPayload } from "./reminderLogic.ts";

export const BACKUP_NOTICE_URL = "/?open=admin-backup";

export type BackupNoticeKind = "backup_failure" | "backup_weekly_summary";

export interface BackupNotice {
  kind: BackupNoticeKind;
  title: string;
  body: string;
  url: string;
  tag: string;
}

export interface BackupNoticeMemberRow {
  id: string;
  is_super_admin?: boolean | null;
  is_deleted?: boolean | null;
}

export interface FailedScope {
  scope: "full" | "group";
  groupId: string | null;
}

export function buildBackupFailureNotice(p: {
  runId: number;
  status: "failed" | "partial";
  succeeded: number;
  total: number;
  failed: FailedScope[];
  dateStr: string;
}): BackupNotice {
  const labels = p.failed.map((f) => (f.scope === "full" ? "全体" : `部署 ${f.groupId ?? "?"}`));
  const shown = labels.slice(0, 5).join("、") + (labels.length > 5 ? ` ほか${labels.length - 5}件` : "");
  return {
    kind: "backup_failure",
    title: `🛡 管理者向け：日次バックアップが${p.status === "failed" ? "失敗" : "一部失敗"}しました`,
    body: `成功 ${p.succeeded}/${p.total}（run_id=${p.runId}）。失敗：${shown || "—"}。理由は 設定 → 部署の管理 → アプリ設定 → バックアップ で確認できます。`,
    url: BACKUP_NOTICE_URL,
    tag: `backup-failure-${p.dateStr}`,
  };
}

export function buildBackupFinalizeFailureNotice(runId: number, dateStr: string): BackupNotice {
  return {
    kind: "backup_failure",
    title: "🛡 管理者向け：バックアップの後片付けに失敗しました",
    body: `古い世代の整理（backup_finalize）に失敗しました（run_id=${runId}）。設定 → 部署の管理 → アプリ設定 → バックアップ で確認してください。`,
    url: BACKUP_NOTICE_URL,
    tag: `backup-finalize-${dateStr}`,
  };
}

export interface WeeklySummaryStats {
  successCount: number;
  totalBytes: number;
  totalOrphans: number;
  totalDeleted: number;
  /** 二次保管の最終取得日（YYYY-MM-DD）。一度も無ければ null */
  lastExportDate: string | null;
}

export function buildBackupWeeklySummaryNotice(s: WeeklySummaryStats, dateStr: string): BackupNotice {
  const mb = (s.totalBytes / (1024 * 1024)).toFixed(1);
  return {
    kind: "backup_weekly_summary",
    title: "🛡 管理者向け：日次バックアップの週次サマリ（直近7日）",
    body: `成功 ${s.successCount}件・容量 約${mb}MB・孤児 ${s.totalOrphans}件・削除 ${s.totalDeleted}件・二次保管の最終取得日 ${s.lastExportDate ?? "未設定"}`,
    url: BACKUP_NOTICE_URL,
    tag: `backup-weekly-${dateStr}`,
  };
}

export function toPushPayload(n: BackupNotice): PushPayload {
  return { title: n.title, body: n.body, url: n.url, tag: n.tag };
}

/** そのチャネルで受け取る super_admin（削除済みは除く。行が無い人はレジストリの既定値） */
export function selectBackupNoticeRecipients(
  members: BackupNoticeMemberRow[],
  prefsById: Map<string, KindPrefsLike>,
  kind: BackupNoticeKind,
  channel: NotificationChannel,
): string[] {
  return members
    .filter((m) => m.is_super_admin === true && !m.is_deleted)
    .filter((m) => isKindEnabled(prefsById.get(m.id), kind, channel))
    .map((m) => m.id);
}
