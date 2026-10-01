-- ============================================================
-- 想定クエリ名：管理者からのお知らせ配信（v3.131）
-- 2026-10-01（冪等。何度流しても同じ状態になる）
--
-- 正本：CLAUDE.md Section 68／純粋関数 supabase/functions/_shared/adminMessageLogic.ts
-- 前提：20261001_web_push_reminders.sql（v3.128）・20261001c_notify_v2_client_errors.sql（v3.129）を適用済み
--
-- 【このマイグレでやること】
--   1. admin_messages（1通のお知らせ）／admin_message_recipients（宛先ごとの既読・確認・再通知）
--   2. in_app_notifications に message_id（お知らせへの参照）と kind 'admin_message'／'admin_message_ack' を追加。
--      送信者へのまとめ通知（admin_message_ack）は「送信者×お知らせ」で1行だけ（部分一意インデックス）
--   3. RPC
--      send_admin_message           … 送信（権限と宛先範囲を DB で検査し、メッセージ・宛先・アプリ内通知を1トランザクションで作る）
--      admin_message_candidates     … 送信画面で選べる宛先（send_admin_message と同じ範囲）
--      mark_admin_message_read      … 受信者が開いた（本人の行だけ）
--      acknowledge_admin_message    … 受信者が「確認しました」（本人の行だけ）＋送信者へのまとめ通知を差し替え
--      list_sent_admin_messages     … 送信履歴（本人が送ったもの。super_admin は全件）
--      admin_message_status         … 宛先ごとの既読・確認（送信者と super_admin だけ）
--      claim_admin_message_reminders… 期限前日の再通知の対象を確定（service_role のみ。push-reminders が呼ぶ）
--
-- 【宛先の範囲（🔴 UI ではなくここで強制する）】
--   - super_admin：全員／部署を指定／個人を選択
--   - 部署の管理者（members.is_admin）：自分のホーム部署（members.group_id）のメンバーだけ（全員または選択）。
--     current_member_is_admin() は部署を区別しない（兼務先でも true）ため使わず、本人の行の is_admin と
--     group_id を直接読む。「部署のメンバー」＝ group_id がその部署、または group_ids にその部署を含む人
--   - 一般メンバー：送れない
--   - 送信者本人・削除済みメンバーは宛先に含めない
--
-- 【乱用対策】
--   - 件名 100字・本文 2000字まで（CHECK 制約と RPC の両方）。本文はプレーンテキストとして保存する（画面は HTML を解釈しない）
--   - 1人あたり 1時間に10通・24時間に30通まで
--   - 個人を選ぶ場合は1通100人まで（全員宛て・部署宛ては上限なし）
--
-- 【適用方法】Supabase SQL Editor に全文を貼って実行する（dev → prod の順）。末尾の確認クエリで結果を見る。
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) お知らせ本体と宛先
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_messages (
  id                 bigserial PRIMARY KEY,
  sender_id          text NOT NULL REFERENCES public.members(id),
  sender_name        text NOT NULL,
  subject            text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 100),
  body               text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  target_kind        text NOT NULL CHECK (target_kind IN ('all', 'group', 'members')),
  target_group_id    text REFERENCES public.groups(id),
  requires_ack       boolean NOT NULL DEFAULT false,
  due_date           date,
  recipient_count    integer NOT NULL DEFAULT 0,
  push_dispatched_at timestamptz,
  push_succeeded     integer,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_messages_due_needs_ack CHECK (due_date IS NULL OR requires_ack)
);
CREATE INDEX IF NOT EXISTS idx_admin_messages_sender_created ON public.admin_messages (sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_messages_created ON public.admin_messages (created_at DESC);

CREATE TABLE IF NOT EXISTS public.admin_message_recipients (
  message_id      bigint NOT NULL REFERENCES public.admin_messages(id) ON DELETE CASCADE,
  member_id       text NOT NULL REFERENCES public.members(id),
  delivered_at    timestamptz NOT NULL DEFAULT now(),
  read_at         timestamptz,
  acknowledged_at timestamptz,
  reminded_at     timestamptz,
  PRIMARY KEY (message_id, member_id)
);
CREATE INDEX IF NOT EXISTS idx_admin_message_recipients_member ON public.admin_message_recipients (member_id, message_id DESC);

-- 書き込みは RPC（SECURITY DEFINER）のみ。INSERT/UPDATE/DELETE のポリシーは作らない。
-- 🔴 宛先の表のポリシーは admin_messages を参照しない（admin_messages のポリシーが宛先の表を参照するため、
--    相互に参照すると無限再帰になる）。送信者が宛先の状況を読むのは RPC admin_message_status 経由。
ALTER TABLE public.admin_message_recipients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin_message_recipients_select" ON public.admin_message_recipients;
CREATE POLICY "admin_message_recipients_select" ON public.admin_message_recipients
  FOR SELECT TO authenticated
  USING (
    ((SELECT public.current_member_id()) IS NOT NULL AND member_id = (SELECT public.current_member_id()))
    OR COALESCE((SELECT public.current_member_is_super_admin()), false)
  );

ALTER TABLE public.admin_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin_messages_select" ON public.admin_messages;
CREATE POLICY "admin_messages_select" ON public.admin_messages
  FOR SELECT TO authenticated
  USING (
    ((SELECT public.current_member_id()) IS NOT NULL AND sender_id = (SELECT public.current_member_id()))
    OR COALESCE((SELECT public.current_member_is_super_admin()), false)
    OR EXISTS (
      SELECT 1 FROM public.admin_message_recipients r
       WHERE r.message_id = admin_messages.id
         AND r.member_id = (SELECT public.current_member_id())
    )
  );

-- ------------------------------------------------------------
-- 2) アプリ内通知：お知らせへの参照と種類
-- ------------------------------------------------------------
ALTER TABLE public.in_app_notifications
  ADD COLUMN IF NOT EXISTS message_id bigint REFERENCES public.admin_messages(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_in_app_notifications_message
  ON public.in_app_notifications (message_id) WHERE message_id IS NOT NULL;
-- 送信者へのまとめ通知は「送信者×お知らせ」で1行（確認が増えるたびに同じ行を差し替える＝積み上がらない）
CREATE UNIQUE INDEX IF NOT EXISTS uq_in_app_notifications_ack_summary
  ON public.in_app_notifications (member_id, message_id) WHERE kind = 'admin_message_ack';

ALTER TABLE public.in_app_notifications DROP CONSTRAINT IF EXISTS in_app_notifications_kind_check;
ALTER TABLE public.in_app_notifications ADD CONSTRAINT in_app_notifications_kind_check
  CHECK (kind IN ('deadline_digest', 'backup_failure', 'backup_weekly_summary', 'client_error', 'admin_message', 'admin_message_ack'));

-- ------------------------------------------------------------
-- 3) RPC：送信
--    p_target：'all'（super_admin のみ）／'group'（p_group_id。部署の管理者は自分のホーム部署のみ）／
--             'members'（p_member_ids。部署の管理者は自分のホーム部署のメンバーのみ）
--    戻り値：作ったお知らせの id と宛先の人数
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.send_admin_message(
  p_subject text, p_body text, p_target text, p_group_id text, p_member_ids text[],
  p_requires_ack boolean, p_due_date date
)
RETURNS TABLE (message_id bigint, recipient_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_send_admin_message$
DECLARE
  v_member     text := public.current_member_id();
  v_me         public.members%ROWTYPE;
  v_is_super   boolean;
  v_is_admin   boolean;
  v_home_group text;
  v_subject    text := btrim(coalesce(p_subject, ''));
  v_body       text := btrim(coalesce(p_body, ''));
  v_ids        text[];
  v_bad        integer;
  v_hour       integer;
  v_day        integer;
  v_msg_id     bigint;
  v_count      integer;
  v_today      date := (now() AT TIME ZONE 'Asia/Tokyo')::date;
BEGIN
  IF v_member IS NULL THEN
    RAISE EXCEPTION 'メンバーとして登録されていないため、お知らせを送れません';
  END IF;
  SELECT * INTO v_me FROM public.members WHERE id = v_member;
  v_is_super   := coalesce(v_me.is_super_admin, false);
  v_is_admin   := coalesce(v_me.is_admin, false);
  v_home_group := v_me.group_id;

  -- 🔴 一般メンバーは送れない
  IF NOT v_is_super AND NOT v_is_admin THEN
    RAISE EXCEPTION 'お知らせを送れるのは部署の管理者と全社スーパー管理者だけです';
  END IF;

  IF char_length(v_subject) < 1 OR char_length(v_subject) > 100 THEN
    RAISE EXCEPTION '件名は1〜100文字で入力してください';
  END IF;
  IF char_length(v_body) < 1 OR char_length(v_body) > 2000 THEN
    RAISE EXCEPTION '本文は1〜2000文字で入力してください';
  END IF;
  IF p_due_date IS NOT NULL AND NOT coalesce(p_requires_ack, false) THEN
    RAISE EXCEPTION '期限は「確認しました」ボタンを付けたときだけ設定できます';
  END IF;
  IF p_due_date IS NOT NULL AND (p_due_date < v_today OR p_due_date > v_today + 365) THEN
    RAISE EXCEPTION '期限は今日から1年以内の日付にしてください';
  END IF;

  -- 乱用対策：送信頻度
  SELECT count(*) FILTER (WHERE created_at > now() - interval '1 hour'),
         count(*)
    INTO v_hour, v_day
    FROM public.admin_messages
   WHERE sender_id = v_member AND created_at > now() - interval '24 hours';
  IF v_hour >= 10 OR v_day >= 30 THEN
    RAISE EXCEPTION '短時間に多くのお知らせを送っています。しばらく時間をおいてから送ってください（1時間に10通・1日30通まで）';
  END IF;

  -- 🔴 宛先の範囲（UI の絞り込みに頼らない）
  IF p_target = 'all' THEN
    IF NOT v_is_super THEN
      RAISE EXCEPTION '全員宛てに送れるのは全社スーパー管理者だけです';
    END IF;
    SELECT coalesce(array_agg(m.id), '{}') INTO v_ids
      FROM public.members m
     WHERE m.is_deleted = false AND m.id <> v_member;
  ELSIF p_target = 'group' THEN
    IF p_group_id IS NULL THEN
      RAISE EXCEPTION '部署を指定してください';
    END IF;
    IF NOT v_is_super AND (v_home_group IS NULL OR p_group_id <> v_home_group) THEN
      RAISE EXCEPTION '部署の管理者が送れるのは自分の部署（ホーム部署）だけです';
    END IF;
    SELECT coalesce(array_agg(m.id), '{}') INTO v_ids
      FROM public.members m
     WHERE m.is_deleted = false AND m.id <> v_member
       AND (m.group_id = p_group_id OR p_group_id = ANY(m.group_ids));
  ELSIF p_target = 'members' THEN
    SELECT coalesce(array_agg(DISTINCT x), '{}') INTO v_ids
      FROM unnest(coalesce(p_member_ids, '{}')) AS x
     WHERE x IS NOT NULL AND x <> v_member;
    IF cardinality(v_ids) > 100 THEN
      RAISE EXCEPTION '個人を選んで送れるのは1通100人までです';
    END IF;
    -- 存在しない・削除済み・（部署の管理者の場合）ホーム部署の外の人が1人でも含まれていたら送らない
    SELECT count(*) INTO v_bad
      FROM unnest(v_ids) AS x
     WHERE NOT EXISTS (
       SELECT 1 FROM public.members m
        WHERE m.id = x AND m.is_deleted = false
          AND (v_is_super
               OR (v_home_group IS NOT NULL AND (m.group_id = v_home_group OR v_home_group = ANY(m.group_ids))))
     );
    IF v_bad > 0 THEN
      RAISE EXCEPTION '宛先に送れない人が含まれています（部署の管理者は自分の部署のメンバーにだけ送れます）';
    END IF;
  ELSE
    RAISE EXCEPTION '宛先の指定が不正です';
  END IF;

  v_count := cardinality(v_ids);
  IF v_count = 0 THEN
    RAISE EXCEPTION '宛先がいません';
  END IF;

  INSERT INTO public.admin_messages
    (sender_id, sender_name, subject, body, target_kind, target_group_id, requires_ack, due_date, recipient_count)
  VALUES
    (v_member, v_me.display_name, v_subject, v_body, p_target,
     CASE WHEN p_target = 'group' THEN p_group_id ELSE NULL END,
     coalesce(p_requires_ack, false), p_due_date, v_count)
  RETURNING id INTO v_msg_id;

  INSERT INTO public.admin_message_recipients (message_id, member_id)
  SELECT v_msg_id, x FROM unnest(v_ids) AS x;

  -- アプリ内通知は本人の設定に関わらず必ず届ける（オフにできない種類）
  INSERT INTO public.in_app_notifications (member_id, kind, title, body, url, message_id)
  SELECT x, 'admin_message', v_subject,
         CASE WHEN char_length(v_body) > 200 THEN left(v_body, 200) || '…' ELSE v_body END,
         '/?open=admin-message&mid=' || v_msg_id, v_msg_id
    FROM unnest(v_ids) AS x;

  RETURN QUERY SELECT v_msg_id, v_count;
END;
$fn_send_admin_message$;

REVOKE ALL ON FUNCTION public.send_admin_message(text, text, text, text, text[], boolean, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.send_admin_message(text, text, text, text, text[], boolean, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.send_admin_message(text, text, text, text, text[], boolean, date) TO authenticated;

-- ------------------------------------------------------------
-- 4) RPC：送信画面で選べる宛先（send_admin_message と同じ範囲。送れない人には0行）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_message_candidates()
RETURNS TABLE (member_id text, display_name text, group_id text, group_ids text[], group_name text, in_home_group boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn_admin_message_candidates$
DECLARE
  v_member text := public.current_member_id();
  v_me     public.members%ROWTYPE;
BEGIN
  IF v_member IS NULL THEN
    RETURN;
  END IF;
  SELECT * INTO v_me FROM public.members WHERE id = v_member;
  IF NOT coalesce(v_me.is_super_admin, false) AND NOT coalesce(v_me.is_admin, false) THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT m.id, m.display_name, m.group_id, m.group_ids, g.name,
           (v_me.group_id IS NOT NULL AND (m.group_id = v_me.group_id OR v_me.group_id = ANY(m.group_ids)))
      FROM public.members m
      LEFT JOIN public.groups g ON g.id = m.group_id
     WHERE m.is_deleted = false
       AND m.id <> v_member
       AND (coalesce(v_me.is_super_admin, false)
            OR (v_me.group_id IS NOT NULL AND (m.group_id = v_me.group_id OR v_me.group_id = ANY(m.group_ids))))
     ORDER BY g.name NULLS LAST, m.display_name;
END;
$fn_admin_message_candidates$;

REVOKE ALL ON FUNCTION public.admin_message_candidates() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_message_candidates() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_message_candidates() TO authenticated;

-- ------------------------------------------------------------
-- 5) RPC：受信者が開いた（本人の行だけ。そのお知らせのアプリ内通知も既読にする）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_admin_message_read(p_message_id bigint)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_mark_admin_message_read$
DECLARE
  v_member text := public.current_member_id();
  v_count  integer;
BEGIN
  IF v_member IS NULL THEN
    RETURN 0;
  END IF;
  UPDATE public.admin_message_recipients
     SET read_at = now()
   WHERE message_id = p_message_id AND member_id = v_member AND read_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  UPDATE public.in_app_notifications
     SET read_at = now()
   WHERE member_id = v_member AND message_id = p_message_id AND kind = 'admin_message' AND read_at IS NULL;
  RETURN v_count;
END;
$fn_mark_admin_message_read$;

REVOKE ALL ON FUNCTION public.mark_admin_message_read(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_admin_message_read(bigint) FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_admin_message_read(bigint) TO authenticated;

-- ------------------------------------------------------------
-- 6) RPC：受信者が「確認しました」（本人の行だけ）
--    送信者へのまとめ通知（kind='admin_message_ack'）を「送信者×お知らせ」の1行に差し替える。
--    文面は adminMessageLogic.ts の buildAckSummary と同じ。未読へ戻す（＝ベルに再び出す）のは
--    「まだ未読のまま」「全員が確認した」「前回ベルに出してから1時間以上たった」のどれかのときだけ
--    （adminMessageLogic.ts の shouldResurfaceAckNotice と同じ。確認のたびに未読バッジが点かないように）。
--    戻り値：確認した日時（すでに確認済みなら最初に確認した日時。2回目は送信者へ通知しない）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.acknowledge_admin_message(p_message_id bigint)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_acknowledge_admin_message$
DECLARE
  v_member  text := public.current_member_id();
  v_msg     public.admin_messages%ROWTYPE;
  v_ack     timestamptz;
  v_acked   integer;
  v_total   integer;
  v_all     boolean;
  v_title   text;
  v_body    text;
BEGIN
  IF v_member IS NULL THEN
    RAISE EXCEPTION 'メンバーとして登録されていないため、確認できません';
  END IF;
  -- 同じお知らせへの確認を直列にする（まとめ通知の人数を正しく数えるため）
  SELECT * INTO v_msg FROM public.admin_messages WHERE id = p_message_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'お知らせが見つかりません';
  END IF;
  IF NOT v_msg.requires_ack THEN
    RAISE EXCEPTION 'このお知らせには「確認しました」ボタンがありません';
  END IF;

  UPDATE public.admin_message_recipients
     SET acknowledged_at = now(), read_at = coalesce(read_at, now())
   WHERE message_id = p_message_id AND member_id = v_member AND acknowledged_at IS NULL
  RETURNING acknowledged_at INTO v_ack;
  IF v_ack IS NULL THEN
    SELECT acknowledged_at INTO v_ack FROM public.admin_message_recipients
     WHERE message_id = p_message_id AND member_id = v_member;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'このお知らせの宛先ではありません';
    END IF;
    RETURN v_ack;
  END IF;

  UPDATE public.in_app_notifications
     SET read_at = now()
   WHERE member_id = v_member AND message_id = p_message_id AND kind = 'admin_message' AND read_at IS NULL;

  SELECT count(*) FILTER (WHERE acknowledged_at IS NOT NULL), count(*)
    INTO v_acked, v_total
    FROM public.admin_message_recipients WHERE message_id = p_message_id;
  v_all   := v_acked >= v_total;
  v_title := '「' || left(v_msg.subject, 30) || CASE WHEN char_length(v_msg.subject) > 30 THEN '…' ELSE '' END
             || '」を' || v_acked || '人が確認しました';
  v_body  := CASE WHEN v_all THEN '全員（' || v_total || '人）が確認しました'
                  ELSE '残り' || (v_total - v_acked) || '人（宛先' || v_total || '人）' END;

  IF EXISTS (SELECT 1 FROM public.members WHERE id = v_msg.sender_id AND is_deleted = false) THEN
    INSERT INTO public.in_app_notifications AS n (member_id, kind, title, body, url, message_id)
    VALUES (v_msg.sender_id, 'admin_message_ack', v_title, v_body, '/?open=admin-sent&mid=' || p_message_id, p_message_id)
    ON CONFLICT (member_id, message_id) WHERE kind = 'admin_message_ack'
    DO UPDATE SET
      title      = EXCLUDED.title,
      body       = EXCLUDED.body,
      created_at = CASE WHEN n.read_at IS NULL OR v_all OR n.created_at < now() - interval '1 hour'
                        THEN now() ELSE n.created_at END,
      read_at    = CASE WHEN n.read_at IS NULL OR v_all OR n.created_at < now() - interval '1 hour'
                        THEN NULL ELSE n.read_at END;
  END IF;

  RETURN v_ack;
END;
$fn_acknowledge_admin_message$;

REVOKE ALL ON FUNCTION public.acknowledge_admin_message(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.acknowledge_admin_message(bigint) FROM anon;
GRANT EXECUTE ON FUNCTION public.acknowledge_admin_message(bigint) TO authenticated;

-- ------------------------------------------------------------
-- 7) RPC：送信履歴（本人が送ったもの。super_admin は全件）。直近 p_limit 件（最大200）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_sent_admin_messages(p_limit integer)
RETURNS TABLE (
  id bigint, sender_id text, sender_name text, subject text, body text, target_kind text, target_group_id text,
  requires_ack boolean, due_date date, created_at timestamptz, recipient_count integer,
  read_count integer, ack_count integer, push_succeeded integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn_list_sent_admin_messages$
DECLARE
  v_member   text := public.current_member_id();
  v_is_super boolean := coalesce(public.current_member_is_super_admin(), false);
BEGIN
  IF v_member IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT m.id, m.sender_id, m.sender_name, m.subject, m.body, m.target_kind, m.target_group_id,
           m.requires_ack, m.due_date, m.created_at, m.recipient_count,
           (SELECT count(*)::integer FROM public.admin_message_recipients r WHERE r.message_id = m.id AND r.read_at IS NOT NULL),
           (SELECT count(*)::integer FROM public.admin_message_recipients r WHERE r.message_id = m.id AND r.acknowledged_at IS NOT NULL),
           m.push_succeeded
      FROM public.admin_messages m
     WHERE v_is_super OR m.sender_id = v_member
     ORDER BY m.created_at DESC
     LIMIT least(greatest(coalesce(p_limit, 50), 1), 200);
END;
$fn_list_sent_admin_messages$;

REVOKE ALL ON FUNCTION public.list_sent_admin_messages(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_sent_admin_messages(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_sent_admin_messages(integer) TO authenticated;

-- ------------------------------------------------------------
-- 8) RPC：宛先ごとの既読・確認（送信者と super_admin だけ。それ以外は0行）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_message_status(p_message_id bigint)
RETURNS TABLE (
  member_id text, display_name text, group_name text,
  delivered_at timestamptz, read_at timestamptz, acknowledged_at timestamptz, reminded_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn_admin_message_status$
DECLARE
  v_member text := public.current_member_id();
BEGIN
  IF v_member IS NULL THEN
    RETURN;
  END IF;
  IF NOT coalesce(public.current_member_is_super_admin(), false)
     AND NOT EXISTS (SELECT 1 FROM public.admin_messages m WHERE m.id = p_message_id AND m.sender_id = v_member) THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT r.member_id, mb.display_name, g.name, r.delivered_at, r.read_at, r.acknowledged_at, r.reminded_at
      FROM public.admin_message_recipients r
      JOIN public.members mb ON mb.id = r.member_id
      LEFT JOIN public.groups g ON g.id = mb.group_id
     WHERE r.message_id = p_message_id
     ORDER BY (r.acknowledged_at IS NOT NULL), (r.read_at IS NOT NULL), mb.display_name;
END;
$fn_admin_message_status$;

REVOKE ALL ON FUNCTION public.admin_message_status(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_message_status(bigint) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_message_status(bigint) TO authenticated;

-- ------------------------------------------------------------
-- 9) RPC：期限前日の再通知（service_role のみ。push-reminders の cron が、今日が再通知日だと判定した
--    お知らせの id を渡す。判定（直前の平日・祝日・JST）は adminMessageLogic.ts の shouldRemindToday）。
--    未確認・未再通知の宛先だけを reminded_at で確定し（1人1回）、アプリ内通知を作って返す。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_admin_message_reminders(p_message_ids bigint[])
RETURNS TABLE (message_id bigint, member_id text, subject text, due_date date)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $fn_claim_admin_message_reminders$
  WITH claimed AS (
    UPDATE public.admin_message_recipients r
       SET reminded_at = now()
      FROM public.admin_messages m, public.members mb
     WHERE r.message_id = m.id
       AND mb.id = r.member_id
       AND mb.is_deleted = false
       AND m.id = ANY(p_message_ids)
       AND m.requires_ack
       AND m.due_date IS NOT NULL
       AND r.acknowledged_at IS NULL
       AND r.reminded_at IS NULL
    RETURNING r.message_id, r.member_id, m.subject, m.due_date
  ), notified AS (
    INSERT INTO public.in_app_notifications (member_id, kind, title, body, url, message_id)
    SELECT c.member_id, 'admin_message',
           '【期限 ' || to_char(c.due_date, 'FMMM/FMDD') || '】' || c.subject,
           '「確認しました」がまだです。内容を確認してボタンを押してください。',
           '/?open=admin-message&mid=' || c.message_id, c.message_id
      FROM claimed c
    RETURNING 1
  )
  SELECT c.message_id, c.member_id, c.subject, c.due_date FROM claimed c
$fn_claim_admin_message_reminders$;

REVOKE ALL ON FUNCTION public.claim_admin_message_reminders(bigint[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_admin_message_reminders(bigint[]) FROM anon;
REVOKE ALL ON FUNCTION public.claim_admin_message_reminders(bigint[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_admin_message_reminders(bigint[]) TO service_role;

COMMIT;

-- ============================================================
-- 確認（このマイグレの一部ではないが、続けて実行して結果を見る）
-- 期待：rls_enabled がすべて true、policy_count が admin_messages=1 / admin_message_recipients=1、
--   in_app_notifications.message_id が bigint で存在、CHECK に admin_message と admin_message_ack を含む、
--   claim_admin_message_reminders を authenticated・anon が実行できない（0件）
-- ============================================================
SELECT c.relname AS table_name,
       c.relrowsecurity AS rls_enabled,
       (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policy_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relname IN ('admin_messages', 'admin_message_recipients')
 ORDER BY c.relname;

SELECT table_name, column_name, data_type
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'in_app_notifications' AND column_name = 'message_id';

SELECT pg_get_constraintdef(oid) AS kind_check
  FROM pg_constraint WHERE conname = 'in_app_notifications_kind_check';

SELECT grantee, privilege_type
  FROM information_schema.routine_privileges
 WHERE routine_name = 'claim_admin_message_reminders' AND grantee IN ('anon', 'authenticated', 'PUBLIC');

-- 宛先範囲の模擬（dev で、部署の管理者のメールアドレスに置き換えて実行。rollback するので何も残らない）
-- begin;
-- set local role authenticated;
-- set local request.jwt.claims = '{"role":"authenticated","email":"<部署の管理者のメール>"}';
-- select * from public.send_admin_message('t','b','all',null,null,false,null);                -- 例外：全員宛ては super_admin のみ
-- select * from public.send_admin_message('t','b','group','<他部署のid>',null,false,null);    -- 例外：自分の部署だけ
-- select * from public.send_admin_message('t','b','members',null,array['<他部署の人のid>'],false,null); -- 例外：送れない人が含まれる
-- rollback;
