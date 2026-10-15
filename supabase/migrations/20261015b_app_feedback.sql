-- 想定クエリ名：アプリ内フィードバック（app_feedback）段階1（v3.157）
-- ============================================================
-- 2026-10-15（v3.157）。冪等（何度流しても同じ状態になる）
--
-- 正本：docs/dev/企画提案_アプリ内フィードバック_20261015.md ／ CLAUDE.md Section 82
-- 前提：20261001c_notify_v2_client_errors.sql（redact_client_error_text・client_error の通知の流儀）を適用済み
--
-- 【何をするか】
--   1. in_app_notifications.kind に 'feedback' を許可する（super_admin へのベル通知）
--   2. app_feedback 表（利用者の一言と、画面の状況のスナップショット）。
--      読めるのは super_admin だけ（RLS は SELECT のみ。書き込みはすべて RPC）。
--      送信者本人が自分の分を読むのは RPC list_my_feedback（admin_memo を本人に見せないため。表は読ませない）
--   3. RPC
--        submit_feedback        … 送信（本人は current_member_id() で決める・頻度上限・同一本文の重複まとめ・
--                                  伏せ字・スナップショットの検証と16KB上限・super_admin へのアプリ内通知）
--        update_feedback_status … 状態を変える（super_admin のみ。それ以外は例外）
--        update_feedback_memo   … 管理者メモを保存する（super_admin のみ）
--        list_my_feedback       … 自分が送った分（本文・日時・状態だけ。admin_memo は返さない）
--   4. cleanup_app_feedback() … 保持期間の処理（スナップショットは90日で NULL・対応済み／見送りは状態変更から180日で削除）。
--      pg_cron への登録は 20261015c_schedule_app_feedback_cleanup.sql に分けた（山本さんが手で登録）
--
-- 【乱用対策（submit_feedback の中）】
--   - 本人は current_member_id() で決める（引数で他人を名乗れない）。匿名（ゲスト）・未登録は例外で拒否
--   - 同じ人のアドバイザリロックを取ってから件数を数える（同時送信で上限を超えない。Section 68 の教訓）
--   - 同一本文の1分以内の再送は 'throttled'（黙って1件にまとめる。画面は成功として扱う）
--   - 1時間3件・24時間10件を超えたら 'limited_hour' / 'limited_day'
--   - 本文は2000字まで。スナップショットは生のサイズが64KBを超えたら捨て、整形後も16KBを超えたら保存しない
--     （本文は必ず残す）。伏せ字（正規表現）は会員確認・長さの確認の後で計算する
--   - スナップショットの構造は RPC が検証する：最上位の既知のキーだけ残し、深さ・件数・文字数を絞り、
--     文字列は redact_client_error_text を通す（画面側 src/lib/feedback/snapshot.ts の許可リスト方式との二重）
--
-- 【MIN_CLIENT_VERSION は上げない】新しい表と RPC の追加だけ。旧画面には入口が出ないだけで壊れない。
-- 【適用方法】Supabase SQL Editor に全文を貼って実行する（dev → prod の順）。適用してから push する
--   （未適用の間は管理ページに「適用がまだです」を出す。ベルの「💬 ご意見を送る」は押すと送信時に失敗する）。
--   末尾の確認は DO ブロック1本（SQL Editor は文ごとに接続が変わるため）。全行が OK ならよい。
--   NG があれば例外メッセージにその行が出る。
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) アプリ内通知の種類に feedback を足す
-- ------------------------------------------------------------
ALTER TABLE public.in_app_notifications DROP CONSTRAINT IF EXISTS in_app_notifications_kind_check;
ALTER TABLE public.in_app_notifications ADD CONSTRAINT in_app_notifications_kind_check
  CHECK (kind IN ('deadline_digest', 'backup_failure', 'backup_weekly_summary', 'client_error', 'admin_message', 'admin_message_ack', 'feedback'));

-- ------------------------------------------------------------
-- 2) app_feedback
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_feedback (
  id                 bigserial PRIMARY KEY,
  member_id          text NOT NULL REFERENCES public.members(id),
  group_id           text REFERENCES public.groups(id) ON DELETE SET NULL,
  kind               text NOT NULL DEFAULT 'unspecified' CHECK (kind IN ('request', 'bug', 'other', 'unspecified')),
  comment            text NOT NULL CHECK (char_length(comment) BETWEEN 1 AND 2000),
  screen             text,
  route              text,
  app_version        text,
  snapshot           jsonb,
  snapshot_version   integer,
  -- attached＝付けて送った／off＝本人がオフにした／too_large＝16KB超で保存しなかった／purged＝90日で消した
  snapshot_state     text NOT NULL DEFAULT 'off' CHECK (snapshot_state IN ('attached', 'off', 'too_large', 'purged')),
  status             text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'done', 'wontfix')),
  admin_memo         text CHECK (admin_memo IS NULL OR char_length(admin_memo) <= 2000),
  status_changed_at  timestamptz,
  status_changed_by  text REFERENCES public.members(id),
  reply_text         text CHECK (reply_text IS NULL OR char_length(reply_text) <= 200),  -- 段階3で使う（段階1では常に NULL）
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_feedback_created ON public.app_feedback (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_feedback_status_created ON public.app_feedback (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_feedback_member_created ON public.app_feedback (member_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_app_feedback_updated_at ON public.app_feedback;
CREATE TRIGGER trg_app_feedback_updated_at
  BEFORE UPDATE ON public.app_feedback
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 書き込みは RPC（SECURITY DEFINER）のみ。INSERT/UPDATE/DELETE のポリシーは作らない。
-- 🔴 本人に表を直接読ませない（行の RLS だけでは admin_memo を送信者から隠せないため。本人は list_my_feedback）。
-- 🔴 Section 39：SECURITY DEFINER 関数は (SELECT …) で包む
ALTER TABLE public.app_feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "app_feedback_read_super_admin" ON public.app_feedback;
CREATE POLICY "app_feedback_read_super_admin" ON public.app_feedback
  FOR SELECT TO authenticated
  USING (COALESCE((SELECT public.current_member_is_super_admin()), false));

-- ------------------------------------------------------------
-- 3) スナップショットの整形（再帰）。深さ・件数・文字数を絞り、文字列は伏せ字を通す。
--    キーは英数字と _ だけ（先頭は英字・32字まで）。オブジェクトは40キー・配列は10要素まで。
--    呼べるのは SECURITY DEFINER の submit_feedback の中だけ（直下の REVOKE）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sanitize_feedback_json(p_val jsonb, p_depth integer)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $fn_sanitize_feedback_json$
DECLARE
  v_type text := jsonb_typeof(p_val);
  v_out  jsonb;
  v_key  text;
  v_item jsonb;
  v_n    integer := 0;
BEGIN
  IF p_val IS NULL OR v_type = 'null' THEN
    RETURN 'null'::jsonb;
  END IF;
  IF v_type IN ('number', 'boolean') THEN
    RETURN p_val;
  END IF;
  IF v_type = 'string' THEN
    RETURN to_jsonb(public.redact_client_error_text(left(p_val #>> '{}', 200), 120));
  END IF;
  IF p_depth <= 0 THEN
    RETURN 'null'::jsonb;
  END IF;
  IF v_type = 'array' THEN
    SELECT coalesce(jsonb_agg(public.sanitize_feedback_json(e.value, p_depth - 1) ORDER BY e.ord), '[]'::jsonb)
      INTO v_out
      FROM (SELECT t.value, t.ord FROM jsonb_array_elements(p_val) WITH ORDINALITY AS t(value, ord) ORDER BY t.ord LIMIT 10) e;
    RETURN v_out;
  END IF;
  v_out := '{}'::jsonb;
  FOR v_key, v_item IN SELECT j.key, j.value FROM jsonb_each(p_val) AS j LOOP
    CONTINUE WHEN v_key !~ '^[A-Za-z][A-Za-z0-9_]{0,31}$';
    v_n := v_n + 1;
    EXIT WHEN v_n > 40;
    v_out := v_out || jsonb_build_object(v_key, public.sanitize_feedback_json(v_item, p_depth - 1));
  END LOOP;
  RETURN v_out;
END;
$fn_sanitize_feedback_json$;

REVOKE ALL ON FUNCTION public.sanitize_feedback_json(jsonb, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sanitize_feedback_json(jsonb, integer) FROM anon;
REVOKE ALL ON FUNCTION public.sanitize_feedback_json(jsonb, integer) FROM authenticated;

-- ------------------------------------------------------------
-- 4) RPC：送信
--    戻り値：'ok'／'throttled'（同一本文の1分以内の再送）／'limited_hour'（1時間3件）／'limited_day'（24時間10件）
--    p_snapshot_state：画面側が付けた状態（'attached'／'off'／'too_large'）。'attached' でも検証に通らなければ保存しない
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_feedback(
  p_kind text, p_comment text, p_screen text, p_route text, p_app_version text, p_group_id text,
  p_snapshot jsonb, p_snapshot_state text, p_snapshot_version integer
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_submit_feedback$
DECLARE
  v_member     text := public.current_member_id();
  v_kind       text := CASE WHEN p_kind IN ('request', 'bug', 'other') THEN p_kind ELSE 'unspecified' END;
  v_comment    text;
  v_screen     text;
  v_route      text;
  v_version    text;
  v_group      text;
  v_in_snap    jsonb := p_snapshot;
  v_snap       jsonb := NULL;
  v_state      text := 'off';
  v_hour       integer;
  v_day        integer;
  v_kind_label text;
BEGIN
  IF v_member IS NULL THEN
    RAISE EXCEPTION 'メンバーとして登録されていないため、ご意見を送れません';
  END IF;

  v_comment := btrim(coalesce(p_comment, ''));
  IF char_length(v_comment) = 0 THEN
    RAISE EXCEPTION 'コメントを入力してください';
  END IF;
  IF char_length(v_comment) > 2000 THEN
    RAISE EXCEPTION 'コメントは2000字までです';
  END IF;
  -- 正規表現（伏せ字）の前に、素のサイズで弾く
  IF octet_length(coalesce(p_screen, '')) + octet_length(coalesce(p_route, '')) + octet_length(coalesce(p_app_version, '')) > 4096 THEN
    RAISE EXCEPTION 'ご意見のデータが大きすぎます';
  END IF;
  IF v_in_snap IS NOT NULL AND octet_length(v_in_snap::text) > 65536 THEN
    v_in_snap := NULL;
    v_state := 'too_large';
  END IF;

  -- 同じ人の同時送信を直列化してから件数を数える（上限を超えない）
  PERFORM pg_advisory_xact_lock(hashtext('app_feedback:' || v_member));

  v_comment := public.redact_client_error_text(v_comment, 2000);

  -- 同一本文の1分以内の再送は黙って1件にまとめる（二重クリック・再送対策）
  IF EXISTS (
    SELECT 1 FROM public.app_feedback f
     WHERE f.member_id = v_member AND f.created_at > now() - interval '1 minute' AND f.comment = v_comment
  ) THEN
    RETURN 'throttled';
  END IF;

  SELECT count(*) FILTER (WHERE f.created_at > now() - interval '1 hour'), count(*)
    INTO v_hour, v_day
    FROM public.app_feedback f
   WHERE f.member_id = v_member AND f.created_at > now() - interval '24 hours';
  IF v_hour >= 3 THEN
    RETURN 'limited_hour';
  END IF;
  IF v_day >= 10 THEN
    RETURN 'limited_day';
  END IF;

  v_screen  := nullif(public.redact_client_error_text(left(coalesce(p_screen, ''), 120), 60), '');
  v_route   := nullif(public.redact_client_error_text(left(coalesce(p_route, ''), 400), 200), '');
  v_version := nullif(left(coalesce(p_app_version, ''), 20), '');

  -- 送信時の表示部署：本人がアクセスできる部署だけ採る（それ以外は本人のホーム部署）
  v_group := nullif(btrim(coalesce(p_group_id, '')), '');
  IF v_group IS NOT NULL
     AND NOT (v_group = ANY (public.current_member_group_ids()) OR COALESCE(public.current_member_is_super_admin(), false)) THEN
    v_group := NULL;
  END IF;
  IF v_group IS NULL THEN
    SELECT m.group_id INTO v_group FROM public.members m WHERE m.id = v_member;
  END IF;
  IF v_group IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.groups g WHERE g.id = v_group) THEN
    v_group := NULL;
  END IF;

  -- スナップショット：許可した最上位のキーだけ残し、再帰で整形する。整形後に16KBを超えたら保存しない
  IF p_snapshot_state = 'attached' AND v_in_snap IS NOT NULL AND jsonb_typeof(v_in_snap) = 'object' THEN
    v_snap := public.sanitize_feedback_json(
      (SELECT coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
         FROM jsonb_each(v_in_snap) AS e
        WHERE e.key = ANY (ARRAY['v', 'takenAt', 'mode', 'view', 'overlay', 'settingsPage', 'route', 'screen', 'app', 'env',
                                 'department', 'selection', 'listSettings', 'ganttSettings', 'kanbanSettings', 'clicks'])),
      5);
    IF octet_length(v_snap::text) > 16384 THEN
      v_snap := NULL;
      v_state := 'too_large';
    ELSE
      v_state := 'attached';
    END IF;
  ELSIF p_snapshot_state = 'too_large' THEN
    v_state := 'too_large';
  END IF;

  INSERT INTO public.app_feedback
    (member_id, group_id, kind, comment, screen, route, app_version, snapshot, snapshot_version, snapshot_state)
  VALUES
    (v_member, v_group, v_kind, v_comment, v_screen, v_route, v_version, v_snap,
     CASE WHEN v_snap IS NOT NULL THEN coalesce(p_snapshot_version, 1) ELSE NULL END, v_state);

  -- super_admin 全員のうち、種類 feedback のアプリ内がオンの人へベル通知（同じトランザクション）。1人につき1時間30件まで。
  -- 既定値は notificationKinds.ts の feedback（inapp=true）・行が無い人の inapp_enabled=true と同じ。
  -- 🔴 ::boolean キャストは壊れた値で例外になりうるため使わない（Section 67）。jsonb のまま 'false'::jsonb と比べる
  v_kind_label := CASE v_kind WHEN 'request' THEN '要望' WHEN 'bug' THEN '不具合' WHEN 'other' THEN 'その他' ELSE '種類なし' END;
  INSERT INTO public.in_app_notifications (member_id, kind, title, body, url)
  SELECT m.id,
         'feedback',
         'ご意見が届きました（' || v_kind_label || '）',
         left(regexp_replace(v_comment, '\s+', ' ', 'g'), 80) || CASE WHEN v_screen IS NOT NULL THEN '（画面：' || v_screen || '）' ELSE '' END,
         '/?open=admin-feedback'
    FROM public.members m
    LEFT JOIN public.notification_prefs np ON np.member_id = m.id
   WHERE m.is_super_admin = true
     AND m.is_deleted = false
     AND COALESCE(np.inapp_enabled, true)
     AND COALESCE(np.kind_channels #> '{feedback,inapp}', 'true'::jsonb) <> 'false'::jsonb
     AND (SELECT count(*) FROM public.in_app_notifications n
           WHERE n.member_id = m.id AND n.kind = 'feedback'
             AND n.created_at > now() - interval '1 hour') < 30;

  RETURN 'ok';
END;
$fn_submit_feedback$;

REVOKE ALL ON FUNCTION public.submit_feedback(text, text, text, text, text, text, jsonb, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_feedback(text, text, text, text, text, text, jsonb, text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.submit_feedback(text, text, text, text, text, text, jsonb, text, integer) TO authenticated;

-- ------------------------------------------------------------
-- 5) RPC：状態・管理者メモ（super_admin のみ。それ以外は例外）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_feedback_status(p_id bigint, p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_update_feedback_status$
DECLARE
  v_member text := public.current_member_id();
BEGIN
  IF v_member IS NULL OR NOT COALESCE(public.current_member_is_super_admin(), false) THEN
    RAISE EXCEPTION 'この操作は全社スーパー管理者のみ行えます';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('new', 'in_progress', 'done', 'wontfix') THEN
    RAISE EXCEPTION '状態の値が不正です';
  END IF;
  UPDATE public.app_feedback
     SET status = p_status,
         status_changed_at = CASE WHEN status IS DISTINCT FROM p_status THEN now() ELSE status_changed_at END,
         status_changed_by = CASE WHEN status IS DISTINCT FROM p_status THEN v_member ELSE status_changed_by END
   WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ご意見が見つかりません';
  END IF;
END;
$fn_update_feedback_status$;

REVOKE ALL ON FUNCTION public.update_feedback_status(bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_feedback_status(bigint, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_feedback_status(bigint, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_feedback_memo(p_id bigint, p_memo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_update_feedback_memo$
DECLARE
  v_member text := public.current_member_id();
  v_memo   text := nullif(btrim(coalesce(p_memo, '')), '');
BEGIN
  IF v_member IS NULL OR NOT COALESCE(public.current_member_is_super_admin(), false) THEN
    RAISE EXCEPTION 'この操作は全社スーパー管理者のみ行えます';
  END IF;
  IF v_memo IS NOT NULL AND char_length(v_memo) > 2000 THEN
    RAISE EXCEPTION 'メモは2000字までです';
  END IF;
  UPDATE public.app_feedback SET admin_memo = v_memo WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ご意見が見つかりません';
  END IF;
END;
$fn_update_feedback_memo$;

REVOKE ALL ON FUNCTION public.update_feedback_memo(bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_feedback_memo(bigint, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_feedback_memo(bigint, text) TO authenticated;

-- ------------------------------------------------------------
-- 6) RPC：自分が送った分（本文・日時・種類・状態・返信のみ。admin_memo・スナップショットは返さない）
--    本人でなければ（匿名・未登録）0行
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_my_feedback()
RETURNS TABLE (
  id bigint, created_at timestamptz, kind text, comment text, status text, status_changed_at timestamptz, reply_text text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn_list_my_feedback$
  SELECT f.id, f.created_at, f.kind, f.comment, f.status, f.status_changed_at, f.reply_text
    FROM public.app_feedback f
   WHERE f.member_id = (SELECT public.current_member_id())
   ORDER BY f.created_at DESC
   LIMIT 50
$fn_list_my_feedback$;

REVOKE ALL ON FUNCTION public.list_my_feedback() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_my_feedback() FROM anon;
GRANT EXECUTE ON FUNCTION public.list_my_feedback() TO authenticated;

-- ------------------------------------------------------------
-- 7) 保持期間の処理（pg_cron から呼ぶ。登録は 20261015c_schedule_app_feedback_cleanup.sql）
--    スナップショットは受信後90日で NULL（本文は残す）。対応済み・見送りは状態変更から180日で削除
--    （「なぜ見送ったか」を残すため一般のログより長くする）。新規・対応中は消さない
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleanup_app_feedback()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_cleanup_app_feedback$
BEGIN
  UPDATE public.app_feedback
     SET snapshot = NULL, snapshot_version = NULL, snapshot_state = 'purged'
   WHERE snapshot IS NOT NULL AND created_at < now() - interval '90 days';
  DELETE FROM public.app_feedback
   WHERE status IN ('done', 'wontfix')
     AND coalesce(status_changed_at, created_at) < now() - interval '180 days';
END;
$fn_cleanup_app_feedback$;

REVOKE ALL ON FUNCTION public.cleanup_app_feedback() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cleanup_app_feedback() FROM anon;
REVOKE ALL ON FUNCTION public.cleanup_app_feedback() FROM authenticated;

COMMIT;

-- ============================================================
-- 確認（適用後に続けて実行する。DO ブロック1本＝SQL Editor は文ごとに接続が変わるため。
-- 結果は例外メッセージとして出る。全行が OK ならよい。書き込みはしない）
-- ============================================================
DO $verify_app_feedback$
DECLARE
  v_lines text[] := ARRAY[]::text[];
  v_ok    boolean;
BEGIN
  v_ok := to_regclass('public.app_feedback') IS NOT NULL;
  v_lines := v_lines || (CASE WHEN v_ok THEN 'OK ' ELSE 'NG ' END || 'table app_feedback');

  v_ok := (SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relname = 'app_feedback');
  v_lines := v_lines || (CASE WHEN coalesce(v_ok, false) THEN 'OK ' ELSE 'NG ' END || 'RLS enabled');

  v_ok := (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'app_feedback') = 1
          AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'app_feedback' AND cmd <> 'SELECT');
  v_lines := v_lines || (CASE WHEN v_ok THEN 'OK ' ELSE 'NG ' END || 'policies = SELECT only (1 policy, no write policies)');

  v_ok := (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'in_app_notifications_kind_check') LIKE '%feedback%';
  v_lines := v_lines || (CASE WHEN v_ok THEN 'OK ' ELSE 'NG ' END || 'in_app_notifications kind CHECK includes feedback');

  v_ok := to_regprocedure('public.submit_feedback(text,text,text,text,text,text,jsonb,text,integer)') IS NOT NULL
      AND to_regprocedure('public.update_feedback_status(bigint,text)') IS NOT NULL
      AND to_regprocedure('public.update_feedback_memo(bigint,text)') IS NOT NULL
      AND to_regprocedure('public.list_my_feedback()') IS NOT NULL
      AND to_regprocedure('public.cleanup_app_feedback()') IS NOT NULL
      AND to_regprocedure('public.sanitize_feedback_json(jsonb,integer)') IS NOT NULL;
  v_lines := v_lines || (CASE WHEN v_ok THEN 'OK ' ELSE 'NG ' END || 'functions exist (6)');

  v_ok := has_function_privilege('authenticated', 'public.submit_feedback(text,text,text,text,text,text,jsonb,text,integer)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.submit_feedback(text,text,text,text,text,text,jsonb,text,integer)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.list_my_feedback()', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.list_my_feedback()', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.cleanup_app_feedback()', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.sanitize_feedback_json(jsonb,integer)', 'EXECUTE');
  v_lines := v_lines || (CASE WHEN v_ok THEN 'OK ' ELSE 'NG ' END || 'EXECUTE grants (authenticated: submit/list only, anon: none, cleanup/sanitize: none)');

  v_ok := (SELECT prosecdef FROM pg_proc WHERE oid = 'public.submit_feedback(text,text,text,text,text,text,jsonb,text,integer)'::regprocedure)
      AND (SELECT proconfig::text FROM pg_proc WHERE oid = 'public.submit_feedback(text,text,text,text,text,text,jsonb,text,integer)'::regprocedure) LIKE '%search_path%';
  v_lines := v_lines || (CASE WHEN coalesce(v_ok, false) THEN 'OK ' ELSE 'NG ' END || 'submit_feedback is SECURITY DEFINER with search_path set');

  v_ok := (public.sanitize_feedback_json('{"a":"x","bad key":1,"n":2}'::jsonb, 3)) = '{"a":"x","n":2}'::jsonb;
  v_lines := v_lines || (CASE WHEN v_ok THEN 'OK ' ELSE 'NG ' END || 'sanitize_feedback_json drops unknown-shaped keys');

  RAISE EXCEPTION E'確認結果（全行が OK ならよい。この例外は結果の表示用で、何も書き込んでいない）:\n%', array_to_string(v_lines, E'\n');
END;
$verify_app_feedback$;
