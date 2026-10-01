-- ============================================================
-- 想定クエリ名：利用者の画面のエラー記録を90日で削除する（pg_cron）登録
-- v3.129 / 2026-10-01
--
-- 正本：CLAUDE.md Section 67
--
-- 【登録するジョブ】
--   cleanup-client-error-logs …… 毎日 UTC 03:10（JST 12:10）。最後に発生してから90日を過ぎたエラーを削除する
--   （client_error_reporters は ON DELETE CASCADE で一緒に消える）。
--   in_app_notifications の client_error の行は、既存の cleanup-push-reminders（90日）が消す。
--
-- 【前提】20261001c_notify_v2_client_errors.sql を適用済み
-- 【置き換えるもの】なし（シークレットを含まない。このまま SQL Editor で実行してよい）
-- 【適用先】本番（fyturlzvbtlnxpjhxyjz）。dev は任意
-- 【止め方】select cron.unschedule('cleanup-client-error-logs');
-- ============================================================

create extension if not exists pg_cron;

select cron.unschedule('cleanup-client-error-logs')
  where exists (select 1 from cron.job where jobname = 'cleanup-client-error-logs');

select cron.schedule(
  'cleanup-client-error-logs',
  '10 3 * * *',
  $cron_cleanup_client_error_logs$
  delete from public.client_error_logs where last_seen < now() - interval '90 days';
  $cron_cleanup_client_error_logs$
);

-- 確認：1行出れば登録済み
select jobname, schedule, active from cron.job where jobname = 'cleanup-client-error-logs';
