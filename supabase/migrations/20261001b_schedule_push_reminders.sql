-- ============================================================
-- 想定クエリ名：期限リマインドの定期実行（pg_cron）登録
-- 期限リマインド新方式 v3.128 の pg_cron 登録（本番のみ・最後に手で流す）
-- 2026-10-01
--
-- 正本：docs/dev/web-push-reminder-design.md §6・§7.1
--
-- 【登録するジョブ】
--   1. push-reminders-am …… '0,30 22,23 * * 0-4'（UTC 日〜木 22:00〜23:30 ＝ JST 月〜金 7:00〜8:30）
--   2. push-reminders-pm …… '0,30 0-10 * * 1-5'（UTC 月〜金 0:00〜10:30 ＝ JST 月〜金 9:00〜19:30）
--      → 平日26回/日。どちらも同じ Edge Function push-reminders を呼ぶ
--   3. cleanup-push-reminders … 毎日 UTC 03:00。reminder_runs / reminder_send_log /
--      in_app_notifications の90日より古い行を削除する
--
-- 【前提（この順で済んでいること）】
--   - 20261001_web_push_reminders.sql を適用済み
--   - Edge Function push-reminders を --no-verify-jwt でデプロイ済み
--     （付け忘れると cron は Authorization を送らないため毎回401になる）
--   - secrets に REMINDER_CRON_SECRET / VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT を設定済み
--
-- 🔴【実行前に必ず置き換えること】
--   下の <REMINDER_CRON_SECRET>（2か所）を、`supabase secrets set` で設定した実際の値に
--   置き換えてから SQL Editor で実行する。置き換えたSQLは実行後に破棄し、このファイルには
--   書き戻さない（git履歴に本物のシークレットを残さないため。20260917_schedule_backup_daily.sql と同じ運用）。
--
-- 【適用先】本番（fyturlzvbtlnxpjhxyjz）のみ。dev は cron を動かさず、手動起動で確認する。
-- 【止め方（ロールバック）】
--   select cron.unschedule('push-reminders-am');
--   select cron.unschedule('push-reminders-pm');
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('push-reminders-am')
  where exists (select 1 from cron.job where jobname = 'push-reminders-am');

select cron.schedule(
  'push-reminders-am',
  '0,30 22,23 * * 0-4',
  $cron_push_reminders_am$
  select net.http_post(
    url := 'https://fyturlzvbtlnxpjhxyjz.supabase.co/functions/v1/push-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '<REMINDER_CRON_SECRET>'
    ),
    body := '{}'::jsonb
  );
  $cron_push_reminders_am$
);

select cron.unschedule('push-reminders-pm')
  where exists (select 1 from cron.job where jobname = 'push-reminders-pm');

select cron.schedule(
  'push-reminders-pm',
  '0,30 0-10 * * 1-5',
  $cron_push_reminders_pm$
  select net.http_post(
    url := 'https://fyturlzvbtlnxpjhxyjz.supabase.co/functions/v1/push-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '<REMINDER_CRON_SECRET>'
    ),
    body := '{}'::jsonb
  );
  $cron_push_reminders_pm$
);

select cron.unschedule('cleanup-push-reminders')
  where exists (select 1 from cron.job where jobname = 'cleanup-push-reminders');

select cron.schedule(
  'cleanup-push-reminders',
  '0 3 * * *',
  $cron_cleanup_push_reminders$
  delete from public.in_app_notifications where created_at < now() - interval '90 days';
  delete from public.reminder_send_log    where created_at < now() - interval '90 days';
  delete from public.reminder_runs        where started_at < now() - interval '90 days';
  $cron_cleanup_push_reminders$
);

-- ============================================================
-- 確認（続けて実行する）
-- ============================================================

-- 1) 3本登録されているか・🔴 シークレットが置き換え済みか
select jobname, schedule, active,
       case when command like '%<REMINDER_CRON_SECRET>%'
            then '🔴 プレースホルダーのまま。置き換えて登録し直すこと'
            else '✅ 置き換え済み' end as secret_check
  from cron.job
 where jobname in ('push-reminders-am', 'push-reminders-pm', 'cleanup-push-reminders')
 order by jobname;

-- 2) 次の平日の起動後に、実行記録が30分ごとに積まれているか
-- select id, started_at, trigger, slot_time, status, target_members, push_attempted, push_failed, error_summary
--   from public.reminder_runs order by id desc limit 10;

-- 3) pg_cron 側の実行結果（401 が出ていれば --no-verify-jwt かシークレットの不一致）
-- select jobname, status, return_message, start_time
--   from cron.job_run_details
--  where jobname in ('push-reminders-am', 'push-reminders-pm')
--  order by start_time desc limit 10;
