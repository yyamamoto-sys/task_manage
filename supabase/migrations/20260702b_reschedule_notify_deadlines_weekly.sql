-- 20260702b_reschedule_notify_deadlines_weekly.sql
--
-- notify-deadlines の仕様変更に伴うスケジュール更新：
-- 「毎日・Teams希望者だけ」→「毎週月曜 JST 8:30・全員向け週次レポート（PJごとに
-- 期限超過／今週中の2カテゴリ、担当者名つき）」に変更（2026-07-02）。
--
-- 【注意】このファイルは構成の記録用。<NOTIFY_CRON_SECRET> は実際の値に置き換えてから
-- Supabase SQL Editor で実行すること。git 履歴に本物のシークレットを残さないため
-- プレースホルダーのままにしている。

-- 旧・毎日ジョブを解除（未登録でもエラーにならない）
select cron.unschedule('notify-deadlines-daily')
where exists (select 1 from cron.job where jobname = 'notify-deadlines-daily');

-- 毎週月曜 JST 8:30（= 毎週日曜 UTC 23:30）に notify-deadlines を起動
select cron.schedule(
  'notify-deadlines-weekly-monday',
  '30 23 * * 0',  -- 曜日欄の 0 = 日曜（UTC）。JSTでは翌月曜 8:30
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
