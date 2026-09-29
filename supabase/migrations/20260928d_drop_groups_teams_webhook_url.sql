-- ============================================================
-- B3：groups.teams_webhook_url 列を削除する（その2）
-- 2026-09-28（冪等）
--
-- 🔴🔴 フロントのデプロイ後にのみ適用すること 🔴🔴
--   旧フロントの部署保存（saveGroup）は groups 行に teams_webhook_url を含めて送る。
--   フロント（v3.118以降）が本番に出る前にこの列を消すと、部署の保存が全経路で失敗する。
--   notify-deadlines も新テーブルを読む版（2026-09-28以降）をデプロイ済みであること。
--
-- 【前提】20260928c_group_notification_settings.sql が適用済みで、URL が複写されていること。
--   下の事前確認で missing_in_settings が 0 でなければ、適用を止めて原因を確認する。
-- ============================================================

-- 事前確認（0 であること。0 でなければ以降を流さない）
SELECT count(*) AS missing_in_settings
  FROM public.groups g
 WHERE g.teams_webhook_url IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.group_notification_settings s
      WHERE s.group_id = g.id AND s.teams_webhook_url IS NOT DISTINCT FROM g.teams_webhook_url
   );

BEGIN;

DO $null_webhook$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'groups' AND column_name = 'teams_webhook_url'
  ) THEN
    EXECUTE 'UPDATE public.groups SET teams_webhook_url = NULL WHERE teams_webhook_url IS NOT NULL';
  END IF;
END
$null_webhook$;

ALTER TABLE public.groups DROP COLUMN IF EXISTS teams_webhook_url;

COMMIT;

-- 確認：0 行であること
SELECT column_name FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'groups' AND column_name = 'teams_webhook_url';
