-- ============================================================
-- 想定クエリ名：管理者からのお知らせ配信・宛先に送信者本人も選べるようにする（v3.132）
-- 2026-10-02（冪等。何度流しても同じ状態になる）
--
-- 正本：CLAUDE.md Section 68／純粋関数 supabase/functions/_shared/adminMessageLogic.ts
-- 前提：20261001e_admin_messages.sql（v3.131・独立レビュー反映後）を適用済み
--
-- 【背景】super_admin が自分宛てに試しに送ろうとしたが、宛先の候補に自分の名前が無かった。
--   20261001e 時点の admin_message_candidates は `m.id <> v_member` で本人を候補から除外し、
--   send_admin_message も 'all'／'group'／'members' の全ての宛先の組み立てで本人を取り除いていた。
--
-- 【このマイグレでやること（これだけ）】
--   admin_message_candidates と send_admin_message を CREATE OR REPLACE で差し替え、
--   本人を候補に含める・宛先（全員／部署／選んだメンバーのいずれでも）から本人を取り除かない。
--
-- 【🔴 変えていないこと（独立レビューの観点）】
--   - 権限・範囲の検査：部署の管理者はホーム部署のみ／全員宛ては super_admin のみ／個人選択で
--     範囲外・削除済みが1人でもいれば全体拒否／1通100人まで、は1文字も変えていない。
--   - 乱用対策：送信頻度の advisory lock（pg_advisory_xact_lock）・1時間10通・24時間30通の判定順序。
--   - 件名100字・本文2000字の検査、SECURITY DEFINER・search_path=''・REVOKE/GRANT。
--   - 削除済みメンバーは引き続き宛先に含めない（本人除外だけをやめる。削除済み除外は無変更）。
--   関数の本体は 20261001e（独立レビュー反映後）をそのままコピーし、差分は「本人を除外する3箇所
--   （'all' 分岐・'group' 分岐・'members' 分岐の v_ids 組み立て）」と「admin_message_candidates の
--   候補の WHERE 句」の計4箇所だけ。他の行は1文字も変えていない。
--
-- 【画面側の対応（このマイグレの対象外・別途コミット）】
--   AdminMessageSection.tsx の候補一覧に自分を「（自分）」付きで表示する。「全員」「部署全員」の
--   説明文に「自分も宛先に含まれます」を明記する（RPC 側がもう除外しないため）。
--
-- 【適用方法】Supabase SQL Editor に全文を貼って実行する（dev → prod の順）。末尾の確認クエリで結果を見る。
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 3) RPC：送信（20261001e と同じ本体。差分は 'all'／'group'／'members' の3箇所で
--    `m.id <> v_member` / `x <> v_member` を外し、本人を宛先から取り除かないようにしただけ）
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

  -- 乱用対策：送信頻度（🔴 独立レビュー指摘・中：件数チェックより前にトランザクション内アドバイザリロックを
  -- 取る。同じ人が同時に複数リクエストを送っても、件数の読み取りと判定が直列になり「1時間10通」を超えない）
  PERFORM pg_advisory_xact_lock(hashtext('admin_msg:' || v_member::text));
  SELECT count(*) FILTER (WHERE created_at > now() - interval '1 hour'),
         count(*)
    INTO v_hour, v_day
    FROM public.admin_messages
   WHERE sender_id = v_member AND created_at > now() - interval '24 hours';
  IF v_hour >= 10 OR v_day >= 30 THEN
    RAISE EXCEPTION '短時間に多くのお知らせを送っています。しばらく時間をおいてから送ってください（1時間に10通・1日30通まで）';
  END IF;

  -- 🔴 宛先の範囲（UI の絞り込みに頼らない）。v3.132：送信者本人も宛先に含められる（削除済みは除外のまま）
  IF p_target = 'all' THEN
    IF NOT v_is_super THEN
      RAISE EXCEPTION '全員宛てに送れるのは全社スーパー管理者だけです';
    END IF;
    SELECT coalesce(array_agg(m.id), '{}') INTO v_ids
      FROM public.members m
     WHERE m.is_deleted = false;
  ELSIF p_target = 'group' THEN
    IF p_group_id IS NULL THEN
      RAISE EXCEPTION '部署を指定してください';
    END IF;
    IF NOT v_is_super AND (v_home_group IS NULL OR p_group_id <> v_home_group) THEN
      RAISE EXCEPTION '部署の管理者が送れるのは自分の部署（ホーム部署）だけです';
    END IF;
    SELECT coalesce(array_agg(m.id), '{}') INTO v_ids
      FROM public.members m
     WHERE m.is_deleted = false
       AND (m.group_id = p_group_id OR p_group_id = ANY(m.group_ids));
  ELSIF p_target = 'members' THEN
    SELECT coalesce(array_agg(DISTINCT x), '{}') INTO v_ids
      FROM unnest(coalesce(p_member_ids, '{}')) AS x
     WHERE x IS NOT NULL;
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
-- 4) RPC：送信画面で選べる宛先（20261001e と同じ本体。差分は候補の WHERE 句から
--    `m.id <> v_member` を外し、本人も候補に含めただけ）
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
       AND (coalesce(v_me.is_super_admin, false)
            OR (v_me.group_id IS NOT NULL AND (m.group_id = v_me.group_id OR v_me.group_id = ANY(m.group_ids))))
     ORDER BY g.name NULLS LAST, m.display_name;
END;
$fn_admin_message_candidates$;

REVOKE ALL ON FUNCTION public.admin_message_candidates() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_message_candidates() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_message_candidates() TO authenticated;

COMMIT;

-- ============================================================
-- 確認（このマイグレの一部ではないが、続けて実行して結果を見る）
-- 期待：
--   1. send_admin_message の定義全文（本文含む）に、送信頻度の advisory lock・super_admin 限定の
--      全員宛てチェック・部署の管理者のホーム部署限定チェック・個人選択の範囲外チェックが
--      いずれも残っていること（has_advisory_lock〜has_members_scope_check が全て true）。
--   2. send_admin_message の定義全文に、本人を除外していた旧条件（`m.id <> v_member` /
--      `x <> v_member`）が無いこと（has_self_exclusion が false＝今回の変更が効いていること）。
--   3. admin_message_candidates の定義全文にも同様に本人除外が残っていないこと。
-- ============================================================
SELECT
  position('pg_advisory_xact_lock' IN pg_catalog.pg_get_functiondef(p.oid)) > 0 AS has_advisory_lock,
  position('全員宛てに送れるのは全社スーパー管理者だけです' IN pg_catalog.pg_get_functiondef(p.oid)) > 0 AS has_all_super_admin_check,
  position('部署の管理者が送れるのは自分の部署（ホーム部署）だけです' IN pg_catalog.pg_get_functiondef(p.oid)) > 0 AS has_group_home_check,
  position('宛先に送れない人が含まれています' IN pg_catalog.pg_get_functiondef(p.oid)) > 0 AS has_members_scope_check,
  position('m.id <> v_member' IN pg_catalog.pg_get_functiondef(p.oid)) > 0
    OR position('x <> v_member' IN pg_catalog.pg_get_functiondef(p.oid)) > 0 AS has_self_exclusion
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'send_admin_message';

SELECT
  position('m.id <> v_member' IN pg_catalog.pg_get_functiondef(p.oid)) > 0 AS has_self_exclusion
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'admin_message_candidates';
