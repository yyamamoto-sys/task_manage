// src/lib/supabase/backupStore.ts
//
// 【設計意図】
// 日次バックアップ（docs/dev/backup-design.md）フェーズ4：管理画面「バックアップ」タブ
// （BackupSection）・バナー（BackupHealthBanner）から使う読み取り・操作の窓口。
//
// 🔴 このファイルの全 select() には必ず .limit() を付けること（フェーズ1で最も重要
// だった教訓＝PostgRESTの既定1000行上限。CLAUDE.md参照）。
//
// 🔴 backup-daily / backup-export-urls の呼び出しは supabase.functions.invoke() を使う。
// supabase-js は現在のログインセッションのアクセストークンを自動的に
// `Authorization: Bearer <token>` として付与するため、呼び出し側で明示的にヘッダーを
// 組み立てる必要は無い（node_modules/@supabase/supabase-js の fetchWithAuth 実装で確認済み）。
// これが「super-adminのJWTで呼ぶ」の実体。
//
// 非2xx時のエラー本文の読み取りは lib/ai/edgeFunctionError.ts の buildInvokeErrorMessage を
// 再利用する（AI専用ではなく supabase.functions.invoke() 全般に使える汎用ロジックのため。
// CLAUDE.md「新しい流儀を発明しない」の趣旨）。

import { supabase } from "./client";
import { buildInvokeErrorMessage } from "../ai/edgeFunctionError";
import type { BackupRun, BackupObject } from "../localData/types";

const RUNS_LIST_LIMIT = 10;
const OBJECTS_LIST_LIMIT = 500; // 保持世代は最大 (14+8+12+8)×(全体+部署数) 程度。十分な余裕を持たせる
const HEALTH_QUERY_LIMIT = 1;

/** 直近の実行状況（最新N件・既定10件）。 */
export async function fetchRecentBackupRuns(limit = RUNS_LIST_LIMIT): Promise<BackupRun[]> {
  const { data, error } = await supabase
    .from("backup_runs")
    .select("id, started_at, finished_at, trigger, triggered_by, status, group_count, bytes_written, duration_ms, deleted_count, error_message")
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as BackupRun[];
}

/** 現在有効な世代一覧（deleted_at IS NULL）。 */
export async function fetchActiveBackupObjects(limit = OBJECTS_LIST_LIMIT): Promise<BackupObject[]> {
  const { data, error } = await supabase
    .from("backup_objects")
    .select("path, run_id, scope, group_id, taken_at, bytes, sha256, retention, deleted_at")
    .is("deleted_at", null)
    .order("taken_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as BackupObject[];
}

/** 一次バックアップ（backup_runs）の最新 success の finished_at。一度も成功していなければ null。 */
export async function fetchLastBackupRunSuccessAt(): Promise<string | null> {
  const { data, error } = await supabase
    .from("backup_runs")
    .select("finished_at")
    .eq("status", "success")
    .order("finished_at", { ascending: false })
    .limit(HEALTH_QUERY_LIMIT);
  if (error) throw error;
  const row = data && data.length > 0 ? data[0] : null;
  return (row?.finished_at as string | null | undefined) ?? null;
}

export interface BackupExportsHealth {
  /** backup_exports に1件でもレコードがあるか（フェーズ5未実施なら false） */
  hasAnyRecord: boolean;
  /** 最新 status='success' の reported_at。記録はあるが未成功なら null。 */
  lastSuccessAt: string | null;
}

/** 二次保管（backup_exports）の健全性判定に必要な最小限のデータ。 */
export async function fetchBackupExportsHealth(): Promise<BackupExportsHealth> {
  const { data: anyRows, error: anyError } = await supabase
    .from("backup_exports")
    .select("id")
    .limit(1);
  if (anyError) throw anyError;
  const hasAnyRecord = (anyRows?.length ?? 0) > 0;
  if (!hasAnyRecord) return { hasAnyRecord: false, lastSuccessAt: null };

  const { data: successRows, error: successError } = await supabase
    .from("backup_exports")
    .select("reported_at")
    .eq("status", "success")
    .order("reported_at", { ascending: false })
    .limit(1);
  if (successError) throw successError;
  const row = successRows && successRows.length > 0 ? successRows[0] : null;
  return { hasAnyRecord: true, lastSuccessAt: (row?.reported_at as string | undefined) ?? null };
}

export interface BackupDailyRunResult {
  scope: "full" | "group";
  groupId: string | null;
  ok: boolean;
  error?: string;
}

export interface BackupDailyRunResponse {
  run_id: number;
  status: "success" | "partial" | "failed";
  trigger: "cron" | "manual";
  results: BackupDailyRunResult[];
  deleted_count: number;
}

/**
 * backup-daily Edge Function を手動実行する。
 * 認証は supabase.functions.invoke() が自動で付与する Authorization: Bearer <現在のセッション
 * のアクセストークン> のみ（x-cron-secret は送らない＝手動実行はJWT経路を通る）。
 * Edge Function内部の自前検証（members.is_super_admin）が唯一のガード。
 */
export async function runBackupNow(): Promise<BackupDailyRunResponse> {
  const { data, error, response } = await supabase.functions.invoke("backup-daily", { body: {} });
  if (error) {
    throw new Error(await buildInvokeErrorMessage(data, error, response));
  }
  return data as BackupDailyRunResponse;
}

export interface BackupDownloadUrlResult {
  path: string;
  signedUrl?: string;
  sha256?: string;
  bytes?: number;
  error?: string;
}

/**
 * backup-export-urls Edge Function を呼び、指定パスの署名URL（5分）を取得する。
 * 認証は runBackupNow と同じくJWT自動付与のみ。
 */
export async function requestBackupDownloadUrls(paths: string[]): Promise<BackupDownloadUrlResult[]> {
  if (paths.length === 0) return [];
  const { data, error, response } = await supabase.functions.invoke("backup-export-urls", {
    body: { paths },
  });
  if (error) {
    throw new Error(await buildInvokeErrorMessage(data, error, response));
  }
  const results = (data as { results?: BackupDownloadUrlResult[] } | null)?.results ?? [];
  return results;
}

/** 1件のパスだけ署名URLを取得する薄いラッパー（ダウンロードボタン用）。 */
export async function requestSingleBackupDownloadUrl(path: string): Promise<BackupDownloadUrlResult> {
  const results = await requestBackupDownloadUrls([path]);
  return results[0] ?? { path, error: "署名URLの取得結果が空でした" };
}
