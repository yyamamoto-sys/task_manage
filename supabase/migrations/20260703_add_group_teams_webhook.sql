-- 部署ごとにTeams Webhook URLを設定できるようにする
-- 適用方法: Supabase SQL Editor に全文貼って実行
--
-- 【背景】notify-deadlines（週次期限通知）は全社共通の1つのTEAMS_WEBHOOK_URLに
-- 全部署のタスクをまとめて投稿していた。部署ごとにデータが分離された今、
-- 通知も部署ごとに別チャンネルへ送れるようにする。

ALTER TABLE groups ADD COLUMN IF NOT EXISTS teams_webhook_url text;

COMMENT ON COLUMN groups.teams_webhook_url IS
  'この部署専用のTeams Webhook URL（週次期限通知の投稿先）。NULLなら全社共通のTEAMS_WEBHOOK_URLにフォールバック';
