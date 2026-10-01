-- ============================================================
-- 想定クエリ名：通知の種類ごとの設定＋利用者の画面のエラー記録（v3.129）
-- 2026-10-01（冪等。何度流しても同じ状態になる）
--
-- 正本：CLAUDE.md Section 67／レジストリ supabase/functions/_shared/notificationKinds.ts
-- 前提：20261001_web_push_reminders.sql（v3.128）を適用済み
--
-- 【このマイグレでやること】
--   1. notification_prefs に kind_channels（jsonb：種類×チャネルのオン・オフ）を追加。
--      v3.128 の notify_overdue / notify_due_today がオフの人は、その種類を両チャネルともオフで移す。
--      旧列は消さない（旧画面・旧 Edge Function がそのまま動く。判定は「旧列 AND kind_channels」）
--   2. in_app_notifications.kind に 'client_error' を許可
--   3. client_error_logs（同じエラーは fingerprint で1行にまとめて回数を数える）と
--      client_error_reporters（誰が何回。頻度上限と「発生した人の数」に使う）。読むのは super_admin のみ
--   4. RPC log_client_error（書き込みの唯一の入口・SECURITY DEFINER）／
--      resolve_client_errors（super_admin が解決済みにする・戻す）
--   5. notification_cursors（push-reminders がエラーのまとめ通知をどこまで送ったか。service_role のみ）
--   6. reminder_runs に error_digest_sent（そのcron実行でエラーのまとめ通知が届いた購読数）
--
-- 【やらないこと】
--   - 90日での削除ジョブ（pg_cron）は 20261001d_schedule_client_error_cleanup.sql に分けた（山本さんが手で登録）
--
-- 【乱用対策（log_client_error の中）】
--   - 本人は current_member_id() で決める（引数で他人を名乗れない）。匿名・未登録は例外で拒否
--   - 同じ人・同じ fingerprint は1分に1回だけ数える（それ以内は 'throttled' を返して何もしない）
--   - 1人が1時間に新しく記録できる fingerprint は50件まで（超えたら 'limited'）
--   - 文字数の上限で切り詰め、メールアドレス・トークンらしき文字列は伏せる（画面側でも同じことをする二重の対策）
--   - アプリ内通知は同じ fingerprint で1時間に1回、1人の super_admin につき1時間10件まで
--
-- 【適用方法】Supabase SQL Editor に全文を貼って実行する（dev → prod の順）。
--   末尾の確認クエリで、RLS が有効・ポリシー数が想定どおりであることを見る。
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) 種類×チャネルの個人設定
-- ------------------------------------------------------------
ALTER TABLE public.notification_prefs
  ADD COLUMN IF NOT EXISTS kind_channels jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.notification_prefs DROP CONSTRAINT IF EXISTS notification_prefs_kind_channels_object;
ALTER TABLE public.notification_prefs ADD CONSTRAINT notification_prefs_kind_channels_object
  CHECK (jsonb_typeof(kind_channels) = 'object');

-- v3.128 で「期限超過」「今日期限」を外していた人は、その種類を両チャネルともオフで移す
-- （すでに kind_channels に値がある人は触らない＝何度流しても同じ）
UPDATE public.notification_prefs
   SET kind_channels = kind_channels || jsonb_build_object('deadline_overdue', jsonb_build_object('inapp', false, 'push', false))
 WHERE notify_overdue = false AND NOT (kind_channels ? 'deadline_overdue');
UPDATE public.notification_prefs
   SET kind_channels = kind_channels || jsonb_build_object('deadline_due_today', jsonb_build_object('inapp', false, 'push', false))
 WHERE notify_due_today = false AND NOT (kind_channels ? 'deadline_due_today');

-- ------------------------------------------------------------
-- 2) アプリ内通知の種類に client_error を足す
-- ------------------------------------------------------------
ALTER TABLE public.in_app_notifications DROP CONSTRAINT IF EXISTS in_app_notifications_kind_check;
ALTER TABLE public.in_app_notifications ADD CONSTRAINT in_app_notifications_kind_check
  CHECK (kind IN ('deadline_digest', 'backup_failure', 'backup_weekly_summary', 'client_error'));

-- ------------------------------------------------------------
-- 3) エラーの記録
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_error_logs (
  id               bigserial PRIMARY KEY,
  fingerprint      text NOT NULL UNIQUE CHECK (fingerprint ~ '^[0-9a-f]{16}$'),
  source           text NOT NULL CHECK (source IN ('report', 'boundary', 'window', 'promise')),
  message          text NOT NULL,
  code             text,
  context          text,
  stack            text,
  route            text,
  screen           text,
  app_version      text,
  user_agent       text,
  member_id        text REFERENCES public.members(id),
  first_seen       timestamptz NOT NULL DEFAULT now(),
  last_seen        timestamptz NOT NULL DEFAULT now(),
  count            integer NOT NULL DEFAULT 1,
  reporter_count   integer NOT NULL DEFAULT 1,
  resolved_at      timestamptz,
  resolved_by      text REFERENCES public.members(id),
  last_notified_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_client_error_logs_last_seen ON public.client_error_logs (last_seen DESC);

CREATE TABLE IF NOT EXISTS public.client_error_reporters (
  error_id   bigint NOT NULL REFERENCES public.client_error_logs(id) ON DELETE CASCADE,
  member_id  text NOT NULL REFERENCES public.members(id),
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen  timestamptz NOT NULL DEFAULT now(),
  count      integer NOT NULL DEFAULT 1,
  PRIMARY KEY (error_id, member_id)
);
CREATE INDEX IF NOT EXISTS idx_client_error_reporters_member_first
  ON public.client_error_reporters (member_id, first_seen DESC);

-- 書き込みは log_client_error / resolve_client_errors（SECURITY DEFINER）のみ。INSERT/UPDATE/DELETE のポリシーは作らない
ALTER TABLE public.client_error_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "client_error_logs_read_super_admin" ON public.client_error_logs;
CREATE POLICY "client_error_logs_read_super_admin" ON public.client_error_logs
  FOR SELECT TO authenticated
  USING (COALESCE((SELECT public.current_member_is_super_admin()), false));

ALTER TABLE public.client_error_reporters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "client_error_reporters_read_super_admin" ON public.client_error_reporters;
CREATE POLICY "client_error_reporters_read_super_admin" ON public.client_error_reporters
  FOR SELECT TO authenticated
  USING (COALESCE((SELECT public.current_member_is_super_admin()), false));

-- ------------------------------------------------------------
-- 4) push-reminders の送信位置（service_role のみ。ポリシーを作らない＝authenticated からは見えない）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_cursors (
  name      text PRIMARY KEY,
  cursor_at timestamptz NOT NULL
);
ALTER TABLE public.notification_cursors ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.reminder_runs ADD COLUMN IF NOT EXISTS error_digest_sent integer;

-- ------------------------------------------------------------
-- 5) 伏せ字＋切り詰め（画面側 src/lib/errors/clientErrorLog.ts の redactSensitive と同じ規則）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.redact_client_error_text(p_text text, p_max integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $fn_redact_client_error_text$
  SELECT left(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(coalesce(p_text, ''),
            '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[email]', 'g'),
          'eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*', '[token]', 'g'),
        '([Bb]earer)\s+[A-Za-z0-9._~+/=-]+', '\1 [token]', 'g'),
      '[A-Za-z0-9+/_-]{40,}', '[redacted]', 'g'),
    p_max)
$fn_redact_client_error_text$;

-- ------------------------------------------------------------
-- 6) RPC：エラーを記録する（画面から呼ぶ唯一の入口）
--    戻り値：'new'（初めての fingerprint）／'recorded'（回数を数えた）／'throttled'（1分以内の重複）／'limited'（1時間の上限）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_client_error(
  p_fingerprint text, p_source text, p_message text, p_code text, p_context text, p_stack text,
  p_route text, p_screen text, p_app_version text, p_user_agent text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_log_client_error$
DECLARE
  v_member     text := public.current_member_id();
  v_source     text := CASE WHEN p_source IN ('report', 'boundary', 'window', 'promise') THEN p_source ELSE 'report' END;
  v_message    text := public.redact_client_error_text(p_message, 500);
  v_code       text := nullif(public.redact_client_error_text(p_code, 60), '');
  v_context    text := nullif(public.redact_client_error_text(p_context, 200), '');
  v_stack      text := nullif(public.redact_client_error_text(p_stack, 2000), '');
  v_route      text := nullif(public.redact_client_error_text(p_route, 200), '');
  v_screen     text := nullif(public.redact_client_error_text(p_screen, 60), '');
  v_version    text := nullif(left(coalesce(p_app_version, ''), 20), '');
  v_ua         text := nullif(left(coalesce(p_user_agent, ''), 300), '');
  v_log        public.client_error_logs%ROWTYPE;
  v_rep_last   timestamptz;
  v_rep_found  boolean;
  v_new_hour   integer;
  v_status     text;
  v_notify     boolean := false;
  v_reopened   boolean := false;
BEGIN
  IF v_member IS NULL THEN
    RAISE EXCEPTION 'メンバーとして登録されていないため、エラーを記録できません';
  END IF;
  IF p_fingerprint IS NULL OR p_fingerprint !~ '^[0-9a-f]{16}$' THEN
    RAISE EXCEPTION 'fingerprint が不正です';
  END IF;
  IF v_message = '' THEN
    v_message := '（メッセージなし）';
  END IF;

  SELECT * INTO v_log FROM public.client_error_logs WHERE fingerprint = p_fingerprint FOR UPDATE;

  IF NOT FOUND THEN
    SELECT count(*) INTO v_new_hour FROM public.client_error_reporters
     WHERE member_id = v_member AND first_seen > now() - interval '1 hour';
    IF v_new_hour >= 50 THEN
      RETURN 'limited';
    END IF;
    INSERT INTO public.client_error_logs
      (fingerprint, source, message, code, context, stack, route, screen, app_version, user_agent, member_id)
    VALUES
      (p_fingerprint, v_source, v_message, v_code, v_context, v_stack, v_route, v_screen, v_version, v_ua, v_member)
    ON CONFLICT (fingerprint) DO NOTHING
    RETURNING * INTO v_log;
    IF v_log.id IS NULL THEN
      -- 同時に同じ fingerprint が初めて記録された：相手の行に回数を足す側へ回る
      SELECT * INTO v_log FROM public.client_error_logs WHERE fingerprint = p_fingerprint FOR UPDATE;
    ELSE
      INSERT INTO public.client_error_reporters (error_id, member_id) VALUES (v_log.id, v_member);
      v_status := 'new';
      v_notify := true;
    END IF;
  END IF;

  IF v_status IS NULL THEN
    SELECT last_seen, true INTO v_rep_last, v_rep_found FROM public.client_error_reporters
     WHERE error_id = v_log.id AND member_id = v_member FOR UPDATE;
    IF coalesce(v_rep_found, false) THEN
      IF v_rep_last > now() - interval '1 minute' THEN
        RETURN 'throttled';
      END IF;
      UPDATE public.client_error_reporters
         SET last_seen = now(), count = count + 1
       WHERE error_id = v_log.id AND member_id = v_member;
    ELSE
      SELECT count(*) INTO v_new_hour FROM public.client_error_reporters
       WHERE member_id = v_member AND first_seen > now() - interval '1 hour';
      IF v_new_hour >= 50 THEN
        RETURN 'limited';
      END IF;
      INSERT INTO public.client_error_reporters (error_id, member_id) VALUES (v_log.id, v_member);
    END IF;

    v_reopened := v_log.resolved_at IS NOT NULL;
    UPDATE public.client_error_logs
       SET count          = count + 1,
           last_seen      = now(),
           reporter_count = reporter_count + CASE WHEN coalesce(v_rep_found, false) THEN 0 ELSE 1 END,
           member_id      = v_member,
           route          = coalesce(v_route, route),
           screen         = coalesce(v_screen, screen),
           app_version    = coalesce(v_version, app_version),
           user_agent     = coalesce(v_ua, user_agent),
           resolved_at    = NULL,
           resolved_by    = NULL
     WHERE id = v_log.id;
    v_status := 'recorded';
    v_notify := v_reopened;
  END IF;

  -- アプリ内通知（super_admin 全員のうち、エラー種類のアプリ内がオンの人）。同じ fingerprint は1時間に1回まで
  IF v_notify AND (v_log.last_notified_at IS NULL OR v_log.last_notified_at < now() - interval '1 hour') THEN
    INSERT INTO public.in_app_notifications (member_id, kind, title, body, url)
    SELECT m.id,
           'client_error',
           CASE WHEN v_reopened THEN '利用者の画面でエラー（解決済みが再発）' ELSE '利用者の画面でエラー（新規）' END,
           left(v_message, 80) || CASE WHEN v_screen IS NOT NULL THEN '（画面：' || v_screen || '）' ELSE '' END,
           '/?open=admin-errors'
      FROM public.members m
      LEFT JOIN public.notification_prefs np ON np.member_id = m.id
     WHERE m.is_super_admin = true
       AND m.is_deleted = false
       -- 既定値は notificationKinds.ts の client_error（inapp=true）・行が無い人の inapp_enabled=true と同じ
       AND COALESCE(np.inapp_enabled, true)
       AND COALESCE((np.kind_channels -> 'client_error' ->> 'inapp')::boolean, true)
       AND (SELECT count(*) FROM public.in_app_notifications n
             WHERE n.member_id = m.id AND n.kind = 'client_error'
               AND n.created_at > now() - interval '1 hour') < 10;
    UPDATE public.client_error_logs SET last_notified_at = now() WHERE id = v_log.id;
  END IF;

  RETURN v_status;
END;
$fn_log_client_error$;

REVOKE ALL ON FUNCTION public.log_client_error(text, text, text, text, text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_client_error(text, text, text, text, text, text, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.log_client_error(text, text, text, text, text, text, text, text, text, text) TO authenticated;

-- ------------------------------------------------------------
-- 7) RPC：解決済みにする（p_resolved=false で未解決に戻す）。super_admin 以外は 0 を返す
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_client_errors(p_ids bigint[], p_resolved boolean)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_resolve_client_errors$
DECLARE
  v_member text := public.current_member_id();
  v_count  integer;
BEGIN
  IF v_member IS NULL OR NOT COALESCE(public.current_member_is_super_admin(), false) THEN
    RETURN 0;
  END IF;
  UPDATE public.client_error_logs
     SET resolved_at = CASE WHEN p_resolved THEN now() ELSE NULL END,
         resolved_by = CASE WHEN p_resolved THEN v_member ELSE NULL END
   WHERE id = ANY(p_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$fn_resolve_client_errors$;

REVOKE ALL ON FUNCTION public.resolve_client_errors(bigint[], boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_client_errors(bigint[], boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.resolve_client_errors(bigint[], boolean) TO authenticated;

COMMIT;

-- ============================================================
-- 確認（このマイグレの一部ではないが、続けて実行して結果を見る）
-- 期待：rls_enabled がすべて true、policy_count が
--   client_error_logs=1 / client_error_reporters=1 / notification_cursors=0、
--   kind_channels 列が jsonb で存在、in_app_notifications の CHECK に client_error を含む
-- ============================================================
SELECT c.relname AS table_name,
       c.relrowsecurity AS rls_enabled,
       (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policy_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relname IN ('client_error_logs', 'client_error_reporters', 'notification_cursors')
 ORDER BY c.relname;

SELECT table_name, column_name, data_type
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND ((table_name = 'notification_prefs' AND column_name = 'kind_channels')
     OR (table_name = 'reminder_runs' AND column_name = 'error_digest_sent'));

SELECT pg_get_constraintdef(oid) AS kind_check
  FROM pg_constraint WHERE conname = 'in_app_notifications_kind_check';

-- 伏せ字の確認（期待：'[email] で失敗 Bearer [token]'）
SELECT public.redact_client_error_text('taro@example.co.jp で失敗 Bearer abc.def', 500) AS redacted;

-- 匿名・未登録で記録できないことの模擬（Section 58 手順3。rollback するので安全）
-- begin;
-- set local role authenticated;
-- set local request.jwt.claims = '{"role":"authenticated"}';
-- select public.log_client_error('0123456789abcdef','report','x',null,null,null,null,null,null,null);  -- 例外になる
-- rollback;
