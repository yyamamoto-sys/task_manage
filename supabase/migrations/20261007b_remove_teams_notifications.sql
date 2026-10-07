-- 20261007b_remove_teams_notifications.sql
--
-- Teams 通知の撤去（v3.136・docs/dev/web-push-reminder-design.md §9 フェーズ4・6）。
-- 期限の知らせは push-reminders（Web Push＋アプリ内通知）、バックアップ通知は backup-daily から
-- super_admin へのアプリ内通知＋Web Push に移った（フェーズ5.5）。並行運用5営業日（10-01〜10-07）を確認済み。
--
-- 1. pg_cron の notify-deadlines-weekly-monday を解除（未登録でも落ちない）
-- 2. group_notification_settings（部署ごとの Teams Webhook URL）を削除。付随物はポリシー1本のみ
--    （関数・トリガー・publication への登録は無いことを 2026-10-07 に本番で確認）。DROP TABLE で一緒に消える。
-- 3. Power Automate テンプレート配布（admin-templates バケット）の読み取りポリシーを削除。
--    🔴 バケットとファイル自体は SQL では消さない（Supabase ダッシュボード → Storage で削除する）。
--
-- in_app_notifications.kind の CHECK 制約は変更しない。backup_failure / backup_weekly_summary は
-- 20261001_web_push_reminders.sql の時点から許可されている（20261001e で作り直した現行の定義にも含まれる）。
--
-- ロールバック：テーブルは 20260928c_group_notification_settings.sql（URL の中身は戻らない）、
-- cron は 20260702b_reschedule_notify_deadlines_weekly.sql。ただし notify-deadlines 関数自体を削除するため、
-- 戻すなら関数の再デプロイ（git 履歴）も要る。

BEGIN;

SELECT cron.unschedule('notify-deadlines-weekly-monday')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notify-deadlines-weekly-monday');

DROP TABLE IF EXISTS public.group_notification_settings;

DROP POLICY IF EXISTS "admin_templates_read_authenticated" ON storage.objects;

COMMIT;

-- 確認（すべて 0 なら適用済み）
SELECT
  (SELECT count(*) FROM cron.job WHERE jobname = 'notify-deadlines-weekly-monday') AS cron_left,
  (SELECT count(*) FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'group_notification_settings') AS table_left,
  (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'storage' AND policyname = 'admin_templates_read_authenticated') AS storage_policy_left;
