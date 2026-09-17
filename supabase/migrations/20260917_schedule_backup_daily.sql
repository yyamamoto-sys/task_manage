-- ============================================================
-- 日次バックアップ フェーズ3（pg_cron 登録）
-- 2026-09-17
--
-- 正本：docs/dev/backup-design.md §3・§6・§8
--
-- 【このマイグレーションで登録するジョブ】
-- 1. backup-daily        … 毎日 UTC 18:00（= JST 翌3:00）に Edge Function を起動する
-- 2. cleanup-backup-runs … 毎日 UTC 03:00（= JST 12:00）に backup_runs / backup_exports の
--                          90日より古い行を削除する（§8。backup_objects は履歴として残す）
--
-- 【前提】
-- - Edge Function `backup-daily` がデプロイ済みであること（2026-09-17 デプロイ済み・version 2）
-- - 🔴 その Function が verify_jwt=false でデプロイされていること。pg_cron からは
--   Authorization ヘッダを付けずに呼ぶため、JWT検証が有効だと 401 で必ず失敗する
--   （2026-09-17に実際に発生。`supabase functions deploy backup-daily --no-verify-jwt`）
-- - Edge Function secrets に BACKUP_CRON_SECRET が設定済みであること（2026-09-17 設定済み）
--
-- 🔴【実行前に必ず置き換えること】
-- 下の <BACKUP_CRON_SECRET> を、`supabase secrets set BACKUP_CRON_SECRET=...` で設定した
-- 実際の値に置き換えてから Supabase SQL Editor で実行してください。
-- git履歴に本物のシークレットを残さないため、このファイルはプレースホルダーのままにしています
-- （20260702_schedule_notify_deadlines.sql と同じ運用）。
-- 置き換えたSQLは実行後に破棄し、このファイルには書き戻さないこと。
--
-- 【適用方法】
-- Supabase SQL Editor で本ファイルの全文を貼って実行する。**本番のみ**。
-- devには適用しない（devは個人OKR系テーブルが未適用のため、group スコープが失敗する）。
-- ============================================================


-- ============================================================
-- ブロック1/3：拡張機能（既に有効なら no-op）
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;


-- ============================================================
-- ブロック2/3：日次バックアップの起動
--
-- 実行時刻を UTC 18:00 = JST 翌3:00 にする理由（§3）：
--   - 利用のピーク外であること
--   - Edge Function 側のファイル名（jstDateStr）・backup_finalize の昇格判定が
--     どちらも JST 基準のため、日付境界（JST 0:00）から3時間離れた時刻を選ぶことで、
--     わずかな時刻ズレが日付をまたぐ事故を防ぐ
--
-- 既存の notify-deadlines は UTC 23:30（JST 翌8:30）なので、時間帯は重ならない。
-- ============================================================

select cron.unschedule('backup-daily')
  where exists (select 1 from cron.job where jobname = 'backup-daily');

select cron.schedule(
  'backup-daily',
  '0 18 * * *',
  $cron_backup_daily$
  select net.http_post(
    url := 'https://fyturlzvbtlnxpjhxyjz.supabase.co/functions/v1/backup-daily',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '<BACKUP_CRON_SECRET>'
    ),
    body := '{}'::jsonb
  );
  $cron_backup_daily$
);


-- ============================================================
-- ブロック3/3：実行記録の掃除（§8）
--
-- backup_runs / backup_exports は90日で削除する。
-- 🔴 backup_objects は削除しない（どの世代がいつ作られ、いつ Storage から消えたかの
--    履歴として残す。§6「deleted_at ... 行は履歴として残す」）。
--
-- 時刻は既存の cleanup-admin-change-logs（UTC 03:00）に合わせた。
-- ============================================================

select cron.unschedule('cleanup-backup-runs')
  where exists (select 1 from cron.job where jobname = 'cleanup-backup-runs');

select cron.schedule(
  'cleanup-backup-runs',
  '0 3 * * *',
  $cron_cleanup_backup_runs$
  delete from public.backup_runs    where started_at  < now() - interval '90 days';
  delete from public.backup_exports where reported_at < now() - interval '90 days';
  $cron_cleanup_backup_runs$
);


-- ============================================================
-- 適用後の確認（このマイグレーションの一部ではない。SQL Editorで実行して確認する）
-- ============================================================

-- 1) ジョブが2本登録されているか
-- select jobid, jobname, schedule, active
--   from cron.job
--  where jobname in ('backup-daily', 'cleanup-backup-runs')
--  order by jobname;

-- 2) 🔴 シークレットが置き換え済みか（プレースホルダーのまま登録すると毎晩401で失敗する）
-- select jobname,
--        case when command like '%<BACKUP_CRON_SECRET>%'
--             then '🔴 プレースホルダーのまま。登録し直すこと'
--             else '✅ 置き換え済み' end as secret_check
--   from cron.job
--  where jobname = 'backup-daily';

-- 3) 翌朝（JST 3:00 以降）に実行結果を確認する
-- select jobname, status, return_message, start_time, end_time
--   from cron.job_run_details
--  where jobname in ('backup-daily', 'cleanup-backup-runs')
--  order by start_time desc
--  limit 5;

-- 4) 翌朝、バックアップ自体が成功しているか
-- select id, trigger, status, group_count, bytes_written, duration_ms, error_message
--   from public.backup_runs
--  order by id desc
--  limit 3;

-- 5) 翌朝、世代が積み上がっているか（初日は3件、2日目以降は日数×3件に増える）
-- select path, scope, group_id, bytes, retention, deleted_at
--   from public.backup_objects
--  order by taken_at desc, path
--  limit 10;
-- ============================================================
