-- ============================================================
-- マイグレーション: admin_change_logs 14日経過削除の自動化（pg_cron）
-- 実行日: 2026-05-01
-- Supabase SQL Editor で実行してください
-- ============================================================
--
-- 【背景】
-- 元のスキーマでは admin_change_logs の 14日経過レコード削除は
-- 「手動 or pg_cron で定期実行」というコメントのみで未自動化だった。
-- ログが無限に増えるため pg_cron で日次自動削除する。
--
-- 【前提】
-- Supabase Dashboard → Database → Extensions で `pg_cron` を有効化しておくこと。
-- 拡張未有効の場合は CREATE EXTENSION でエラーになるので Dashboard で先に enable する。
--
-- 【スケジュール】
-- 毎日 03:00 UTC（JST 12:00）に実行。利用ピーク外の時間帯。
-- ============================================================

-- pg_cron 拡張を有効化（Dashboard で有効化済みなら no-op）
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 既存のジョブがあれば削除（再実行可にするため）
SELECT cron.unschedule('cleanup-admin-change-logs')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-admin-change-logs');

-- 日次 03:00 UTC に 14日より古いログを削除
SELECT cron.schedule(
  'cleanup-admin-change-logs',
  '0 3 * * *',
  $$DELETE FROM admin_change_logs WHERE performed_at < now() - interval '14 days';$$
);

-- 動作確認用クエリ（必要に応じて実行）:
--   SELECT * FROM cron.job WHERE jobname = 'cleanup-admin-change-logs';
--   SELECT * FROM cron.job_run_details WHERE jobname = 'cleanup-admin-change-logs' ORDER BY start_time DESC LIMIT 5;
