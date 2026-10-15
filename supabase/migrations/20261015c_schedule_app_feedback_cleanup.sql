-- 想定クエリ名：アプリ内フィードバックの保持期間の処理（pg_cron）登録
-- ============================================================
-- v3.157 / 2026-10-15
--
-- 正本：CLAUDE.md Section 82
--
-- 【登録するジョブ】
--   cleanup-app-feedback …… 毎日 UTC 03:20（JST 12:20）。cleanup_app_feedback() を呼ぶ：
--     ・受信から90日を過ぎたご意見のスナップショットを NULL にする（本文・状態・メモは残す）
--     ・状態が「対応済み」「見送り」のものを、状態を変えてから180日で削除する
--       （「なぜ見送ったか」を残すため、一般のログより長くする。新規・対応中は消さない）
--
-- 【前提】20261015b_app_feedback.sql を適用済み（cleanup_app_feedback() が存在すること）
-- 【置き換えるもの】なし（シークレット・プレースホルダーを含まない。このまま SQL Editor で実行してよい）
-- 【適用先】本番（fyturlzvbtlnxpjhxyjz）。dev は任意
-- 【止め方】select cron.unschedule('cleanup-app-feedback');
-- ============================================================

create extension if not exists pg_cron;

select cron.unschedule('cleanup-app-feedback')
  where exists (select 1 from cron.job where jobname = 'cleanup-app-feedback');

select cron.schedule(
  'cleanup-app-feedback',
  '20 3 * * *',
  $cron_cleanup_app_feedback$
  select public.cleanup_app_feedback();
  $cron_cleanup_app_feedback$
);

-- 確認：1行出れば登録済み
select jobname, schedule, active from cron.job where jobname = 'cleanup-app-feedback';
