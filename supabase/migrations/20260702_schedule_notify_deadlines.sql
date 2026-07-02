-- 20260702_schedule_notify_deadlines.sql
--
-- 毎朝 JST 8:30（UTC 23:30）に notify-deadlines Edge Function を pg_cron から起動する。
-- notify-deadlines は notify_pref='teams' のメンバーの期限切れ／本日期限タスクを
-- まとめて Teams チャンネルへ投稿する（supabase/functions/notify-deadlines/index.ts 参照）。
--
-- 【注意】このファイルは構成の記録用。<NOTIFY_CRON_SECRET> は実際の値に置き換えてから
-- Supabase SQL Editor で実行すること（実値は `supabase secrets set` で設定済みの値と一致させる）。
-- git 履歴に本物のシークレットを残さないため、ここではプレースホルダーのままにしている。

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'notify-deadlines-daily',
  '30 23 * * *',  -- UTC 23:30 = JST 翌8:30
  $$
  select net.http_post(
    url := 'https://fyturlzvbtlnxpjhxyjz.supabase.co/functions/v1/notify-deadlines',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '<NOTIFY_CRON_SECRET>'
    ),
    body := '{}'::jsonb
  );
  $$
);
