-- ============================================================
-- B3：部署の Teams Webhook URL を管理者専用テーブル group_notification_settings へ移す（その1）
-- 2026-09-28（冪等。20260928b_restrict_groups_tips_usage_insert.sql の後に適用する）
--
-- 【なぜ】groups は部署名の表示に全部署分が要るため、groups_select を行単位で絞れない
--   （登録済みメンバーなら他部署の teams_webhook_url も読める）。URL の列だけを別テーブルに
--   分け、そこを「今 URL を編集できる人」＝super_admin または自部署の admin に絞る
--   （判定は groups_update_admin と同じ）。docs/dev/rls-phase2-investigation.md §8
--
-- 【このマイグレでやること】
--   1. group_notification_settings を作成し、RLS を有効化（1テーブル1ポリシー・FOR ALL）
--   2. groups.teams_webhook_url の値を複写する（groups 側の列はまだ残す）
--
-- 🔴 groups.teams_webhook_url 列の削除は 20260928d_drop_groups_teams_webhook_url.sql で行う。
--   そちらはフロントのデプロイ後にのみ適用する（先に流すと旧フロントの部署保存が失敗する）。
--
-- 【読む側】
--   - フロント（管理画面の部署設定）：authenticated。本ポリシーで自部署分（super_admin は全部署）のみ
--   - notify-deadlines（Edge Function）：service_role のため RLS の対象外
--
-- 【適用方法】Supabase SQL Editor に全文を貼って実行する（dev → prod の順）。
-- 【適用順】このマイグレ → notify-deadlines のデプロイ → フロントのデプロイ → 20260928d
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.group_notification_settings (
  group_id          text PRIMARY KEY REFERENCES public.groups(id),
  teams_webhook_url text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        text NOT NULL DEFAULT ''
);

ALTER TABLE public.group_notification_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "group_notification_settings_admin" ON public.group_notification_settings;
CREATE POLICY "group_notification_settings_admin" ON public.group_notification_settings
  FOR ALL TO authenticated
  USING (
    (SELECT public.current_member_is_super_admin())
    OR ((SELECT public.current_member_is_admin()) AND group_id = (SELECT public.current_member_group_id()))
  )
  WITH CHECK (
    (SELECT public.current_member_is_super_admin())
    OR ((SELECT public.current_member_is_admin()) AND group_id = (SELECT public.current_member_group_id()))
  );

INSERT INTO public.group_notification_settings (group_id, teams_webhook_url, updated_by)
SELECT id, teams_webhook_url, 'migration'
  FROM public.groups
 WHERE teams_webhook_url IS NOT NULL
ON CONFLICT (group_id) DO NOTHING;

COMMIT;

-- 確認：複写件数が一致すること（groups_with_url = settings_with_url）、ポリシーが1本であること
SELECT
  (SELECT count(*) FROM public.groups WHERE teams_webhook_url IS NOT NULL) AS groups_with_url,
  (SELECT count(*) FROM public.group_notification_settings WHERE teams_webhook_url IS NOT NULL) AS settings_with_url,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'group_notification_settings') AS policy_count,
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.group_notification_settings'::regclass) AS rls_enabled;
