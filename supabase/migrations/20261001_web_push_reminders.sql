-- ============================================================
-- 想定クエリ名：期限リマインド（Windows通知＋アプリ内通知）のテーブル作成
-- 期限リマインド新方式（Web Push＋アプリ内通知）v3.128
-- 2026-10-01（冪等。何度流しても同じ状態になる）
--
-- 正本：docs/dev/web-push-reminder-design.md（rev2・§4〜§8・§11）／CLAUDE.md Section 66
--
-- 【このマイグレでやること】
--   1. 5テーブル：reminder_runs / reminder_send_log / notification_prefs /
--      push_subscriptions / in_app_notifications（RLS有効・1テーブル1目的のポリシー）
--   2. RPC 4本：register_push_subscription（本人の購読登録）／
--      mark_in_app_notifications_read（本人の既読化）／push_subscription_stats（super_admin の集計）／
--      claim_reminder_sends（Edge Function 専用・1人1日1回の判定と記録を1文で行う）
--
-- 【やらないこと】
--   - pg_cron の登録（送信2本・90日削除1本）は 20261001b_schedule_push_reminders.sql に分けた。
--     そちらはシークレットの置き換えが要るため、山本さんが最後に手で流す。
--   - members.notify_pref からの初期値の移行はしない（設計書 §4.3：購読が無いと
--     Windows通知は届かないため、全員オフから始める。行が無い人は既定値として扱う）。
--
-- 【RLS の書き方】Section 39（関数呼び出しは (SELECT ...) で包む）・Section 58
--   （current_member_id() が NULL の匿名・未登録は弾く）に従う。
--
-- 【適用方法】Supabase SQL Editor に全文を貼って実行する（dev → prod の順）。
--   末尾の確認クエリの結果で、5テーブルの RLS が有効・ポリシー数が想定どおりであることを見る。
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) 実行記録（起動ごとに1行。空振りの行も正常性の証拠として残す。設計書 §6）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reminder_runs (
  id                    bigserial PRIMARY KEY,
  started_at            timestamptz NOT NULL DEFAULT now(),
  finished_at           timestamptz,
  trigger               text NOT NULL CHECK (trigger IN ('cron','manual','test')),
  triggered_by          text,
  slot_time             time,
  status                text NOT NULL CHECK (status IN ('running','success','partial','failed')),
  target_members        integer,
  inapp_written         integer,
  push_attempted        integer,
  push_succeeded        integer,
  push_failed           integer,
  subscriptions_removed integer,
  error_summary         text
);
CREATE INDEX IF NOT EXISTS idx_reminder_runs_started_at ON public.reminder_runs (started_at DESC);

ALTER TABLE public.reminder_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reminder_runs_read_super_admin" ON public.reminder_runs;
CREATE POLICY "reminder_runs_read_super_admin" ON public.reminder_runs
  FOR SELECT TO authenticated
  USING (COALESCE((SELECT public.current_member_is_super_admin()), false));

-- ------------------------------------------------------------
-- 2) 1人1日1回の印（設計書 §6.1）。主キーが排他の役割を兼ねる
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reminder_send_log (
  member_id  text NOT NULL REFERENCES public.members(id),
  send_date  date NOT NULL,
  run_id     bigint REFERENCES public.reminder_runs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, send_date)
);

ALTER TABLE public.reminder_send_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reminder_send_log_read_super_admin" ON public.reminder_send_log;
CREATE POLICY "reminder_send_log_read_super_admin" ON public.reminder_send_log
  FOR SELECT TO authenticated
  USING (COALESCE((SELECT public.current_member_is_super_admin()), false));

-- ------------------------------------------------------------
-- 3) 個人の通知設定（設計書 §4.1）。members の列にしない理由は設計書参照
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_prefs (
  member_id        text PRIMARY KEY REFERENCES public.members(id),
  inapp_enabled    boolean NOT NULL DEFAULT true,
  push_enabled     boolean NOT NULL DEFAULT false,
  notify_overdue   boolean NOT NULL DEFAULT true,
  notify_due_today boolean NOT NULL DEFAULT true,
  reminder_time    time NOT NULL DEFAULT '08:30:00',
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_prefs_reminder_time_check CHECK (
    reminder_time >= time '07:00' AND reminder_time <= time '19:00'
    AND extract(minute from reminder_time)::int % 30 = 0
    AND extract(second from reminder_time) = 0
  )
);

DROP TRIGGER IF EXISTS trg_notification_prefs_updated_at ON public.notification_prefs;
CREATE TRIGGER trg_notification_prefs_updated_at
  BEFORE UPDATE ON public.notification_prefs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.notification_prefs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notification_prefs_own" ON public.notification_prefs;
CREATE POLICY "notification_prefs_own" ON public.notification_prefs
  FOR ALL TO authenticated
  USING      ((SELECT public.current_member_id()) IS NOT NULL AND member_id = (SELECT public.current_member_id()))
  WITH CHECK ((SELECT public.current_member_id()) IS NOT NULL AND member_id = (SELECT public.current_member_id()));

-- ------------------------------------------------------------
-- 4) ブラウザごとの購読（設計書 §8.1）。INSERT/UPDATE のポリシーは作らない（RPC 経由のみ）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id              bigserial PRIMARY KEY,
  member_id       text NOT NULL REFERENCES public.members(id),
  endpoint        text NOT NULL UNIQUE,
  p256dh          text NOT NULL,
  auth            text NOT NULL,
  user_agent      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  failure_count   integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_member ON public.push_subscriptions (member_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "push_subscriptions_select_own" ON public.push_subscriptions;
CREATE POLICY "push_subscriptions_select_own" ON public.push_subscriptions
  FOR SELECT TO authenticated
  USING ((SELECT public.current_member_id()) IS NOT NULL AND member_id = (SELECT public.current_member_id()));
DROP POLICY IF EXISTS "push_subscriptions_delete_own" ON public.push_subscriptions;
CREATE POLICY "push_subscriptions_delete_own" ON public.push_subscriptions
  FOR DELETE TO authenticated
  USING ((SELECT public.current_member_id()) IS NOT NULL AND member_id = (SELECT public.current_member_id()));

-- ------------------------------------------------------------
-- 5) アプリ内通知（設計書 §5.2）。INSERT は service_role のみ（ポリシーを作らない）、
--    既読化は RPC のみ（本人が本文を書き換えられないよう UPDATE ポリシーを作らない）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.in_app_notifications (
  id         bigserial PRIMARY KEY,
  member_id  text NOT NULL REFERENCES public.members(id),
  run_id     bigint REFERENCES public.reminder_runs(id) ON DELETE SET NULL,
  kind       text NOT NULL CHECK (kind IN ('deadline_digest', 'backup_failure', 'backup_weekly_summary')),
  title      text NOT NULL,
  body       text NOT NULL,
  url        text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at    timestamptz
);
CREATE INDEX IF NOT EXISTS idx_in_app_notifications_member_created
  ON public.in_app_notifications (member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_in_app_notifications_unread
  ON public.in_app_notifications (member_id) WHERE read_at IS NULL;

ALTER TABLE public.in_app_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "in_app_notifications_select_own" ON public.in_app_notifications;
CREATE POLICY "in_app_notifications_select_own" ON public.in_app_notifications
  FOR SELECT TO authenticated
  USING ((SELECT public.current_member_id()) IS NOT NULL AND member_id = (SELECT public.current_member_id()));

-- ------------------------------------------------------------
-- 6) RPC：購読の登録（同じ endpoint は持ち主ごと付け替える。共有PCで別の人がオンにした場合、
--    upsert では他人の行を UPDATE できず失敗するため SECURITY DEFINER で行う。設計書 §8.1）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_user_agent text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_register_push_subscription$
DECLARE
  v_member text := public.current_member_id();
  v_id     bigint;
BEGIN
  IF v_member IS NULL THEN
    RAISE EXCEPTION 'メンバーとして登録されていないため、通知を登録できません';
  END IF;
  IF p_endpoint IS NULL OR p_endpoint !~ '^https://' OR length(p_endpoint) > 2048 THEN
    RAISE EXCEPTION '通知の登録先（endpoint）が不正です';
  END IF;
  IF coalesce(p_p256dh, '') = '' OR coalesce(p_auth, '') = ''
     OR length(p_p256dh) > 512 OR length(p_auth) > 512 THEN
    RAISE EXCEPTION '通知の暗号鍵が不正です';
  END IF;

  INSERT INTO public.push_subscriptions AS ps (member_id, endpoint, p256dh, auth, user_agent)
  VALUES (v_member, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 512))
  ON CONFLICT (endpoint) DO UPDATE
    SET p256dh        = EXCLUDED.p256dh,
        auth          = EXCLUDED.auth,
        user_agent    = EXCLUDED.user_agent,
        failure_count = CASE WHEN ps.member_id = EXCLUDED.member_id
                             THEN ps.failure_count ELSE 0 END,
        last_success_at = CASE WHEN ps.member_id = EXCLUDED.member_id
                               THEN ps.last_success_at ELSE NULL END,
        last_failure_at = CASE WHEN ps.member_id = EXCLUDED.member_id
                               THEN ps.last_failure_at ELSE NULL END,
        member_id     = EXCLUDED.member_id
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$fn_register_push_subscription$;

REVOKE ALL ON FUNCTION public.register_push_subscription(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_push_subscription(text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.register_push_subscription(text, text, text, text) TO authenticated;

-- ------------------------------------------------------------
-- 7) RPC：本人のアプリ内通知を既読にする。p_ids が NULL なら本人の未読をすべて既読にする
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_in_app_notifications_read(p_ids bigint[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_mark_in_app_notifications_read$
DECLARE
  v_member text := public.current_member_id();
  v_count  integer;
BEGIN
  IF v_member IS NULL THEN
    RETURN 0;
  END IF;
  UPDATE public.in_app_notifications
     SET read_at = now()
   WHERE member_id = v_member
     AND read_at IS NULL
     AND (p_ids IS NULL OR id = ANY(p_ids));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$fn_mark_in_app_notifications_read$;

REVOKE ALL ON FUNCTION public.mark_in_app_notifications_read(bigint[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_in_app_notifications_read(bigint[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_in_app_notifications_read(bigint[]) TO authenticated;

-- ------------------------------------------------------------
-- 8) RPC：購読数の集計（管理画面用）。push_subscriptions は本人の行しか読めないため、
--    件数だけを super_admin に返す。super_admin 以外には0行を返す
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.push_subscription_stats()
RETURNS TABLE (subscription_count integer, member_count integer)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $fn_push_subscription_stats$
  SELECT count(*)::integer, count(DISTINCT member_id)::integer
    FROM public.push_subscriptions
   WHERE COALESCE(public.current_member_is_super_admin(), false)
  HAVING COALESCE(public.current_member_is_super_admin(), false)
$fn_push_subscription_stats$;

REVOKE ALL ON FUNCTION public.push_subscription_stats() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.push_subscription_stats() FROM anon;
GRANT EXECUTE ON FUNCTION public.push_subscription_stats() TO authenticated;

-- ------------------------------------------------------------
-- 9) RPC：今日まだ送っていない人だけを記録して返す（設計書 §6.1）。
--    判定と記録を1文で行うため、二重起動・遅延起動でも1人1日1回を超えない。
--    Edge Function（service_role）専用
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_reminder_sends(
  p_member_ids text[], p_send_date date, p_run_id bigint
)
RETURNS SETOF text
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $fn_claim_reminder_sends$
  INSERT INTO public.reminder_send_log (member_id, send_date, run_id)
  SELECT DISTINCT m, p_send_date, p_run_id
    FROM unnest(p_member_ids) AS m
  ON CONFLICT (member_id, send_date) DO NOTHING
  RETURNING member_id
$fn_claim_reminder_sends$;

REVOKE ALL ON FUNCTION public.claim_reminder_sends(text[], date, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_reminder_sends(text[], date, bigint) FROM authenticated;
REVOKE ALL ON FUNCTION public.claim_reminder_sends(text[], date, bigint) FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_reminder_sends(text[], date, bigint) TO service_role;

COMMIT;

-- ============================================================
-- 確認（このマイグレの一部ではないが、続けて実行して結果を見る）
-- 期待：rls_enabled がすべて true、policy_count が
--   reminder_runs=1 / reminder_send_log=1 / notification_prefs=1 / push_subscriptions=2 / in_app_notifications=1
-- ============================================================
SELECT c.relname AS table_name,
       c.relrowsecurity AS rls_enabled,
       (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policy_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relname IN ('reminder_runs','reminder_send_log','notification_prefs','push_subscriptions','in_app_notifications')
 ORDER BY c.relname;

-- 匿名・未登録で読めないことの模擬（Section 58 手順3。rollback するので安全）
-- begin;
-- set local role authenticated;
-- set local request.jwt.claims = '{"role":"authenticated"}';
-- select public.current_member_id() as me,
--        (select count(*) from public.notification_prefs)   as prefs,
--        (select count(*) from public.push_subscriptions)   as subs,
--        (select count(*) from public.in_app_notifications) as inapp,
--        (select count(*) from public.reminder_runs)        as runs;   -- すべて 0（me は NULL）
-- rollback;
