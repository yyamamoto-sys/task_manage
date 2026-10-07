-- ============================================================
-- 想定クエリ名：members 書き込み権限の締め付け（20261007c）ペルソナ別検証
-- 2026-10-07 ／ 読み取り専用ではないが、最後に必ず ROLLBACK する（何も残らない）
--
-- 使い方：Supabase SQL Editor に全文を貼って実行する。最後の SELECT の結果を見る。
--   - 適用「後」に流す：judge_after 列がすべて OK（または SKIP）であること。
--   - 適用「前」に流す：judge_before 列がすべて OK であること（＝この検証が穴を検出できることの確認）。
-- 個人を特定する値（メール・名前・id）は結果に出さない。結果は件数と真偽だけ。
--
-- 仕組み：
--   - 更新・削除の対象は、この検証の中で作る試験用の行（display_name='rls-test'・email なし）だけ。
--     本人の行の更新を試す項目（*_self_*）だけは実在の行に触るが、各試行は副トランザクションで
--     取り消すので、次の試行にも残らない。全体も最後に ROLLBACK する。
--   - 1回の試行＝ pg_temp.probe(結果キー, 実行者のid, 試すSQL, 読み戻しSQL)。
--     実行者のメールを request.jwt.claims に入れ、SET LOCAL ROLE authenticated で RLS を効かせて試し、
--     影響行数（RLS違反なら denied）と、ロールを戻してからの読み戻し値（トリガーが差し戻したか）を記録する。
--   - 兼務管理者（super_admin でない）は本番に居ないため、自部署管理者の1人に兼務先を1つ足して作る
--     （super_admin の権限でトランザクション内だけ足す。ROLLBACK で消える）。
--
-- 結果の値の読み方：'1'＝1行変わった ／ '0'＝RLS で対象外（エラーにならず0行）／ 'denied'＝RLS違反のエラー
--   ／ '1/true' 等＝変わった行数／読み戻し ／ 'no-persona'＝該当者がいない（SKIP）
-- ============================================================

BEGIN;

SELECT set_config('request.jwt.claims', '{}', true);

CREATE FUNCTION pg_temp.probe(p_key text, p_actor_id text, p_sql text, p_check text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $fn_probe$
DECLARE
  v_email text;
  n int;
  v text;
  r text;
BEGIN
  SELECT email INTO v_email FROM public.members WHERE id = p_actor_id;
  IF coalesce(p_actor_id, '') = '' OR v_email IS NULL THEN
    PERFORM set_config('rlst.' || p_key, 'no-persona', true);
    RETURN;
  END IF;
  BEGIN
    PERFORM set_config('request.jwt.claims',
      json_build_object('role', 'authenticated', 'email', v_email)::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    EXECUTE p_sql;
    GET DIAGNOSTICS n = ROW_COUNT;
    EXECUTE 'RESET ROLE';
    r := n::text;
    IF p_check IS NOT NULL THEN
      EXECUTE p_check INTO v;
      r := r || '/' || coalesce(v, 'null');
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = '__undo__';
  EXCEPTION
    WHEN insufficient_privilege THEN r := 'denied';
    WHEN OTHERS THEN
      IF SQLERRM <> '__undo__' THEN r := 'error ' || SQLSTATE; END IF;
  END;
  PERFORM set_config('rlst.' || p_key, coalesce(r, ''), true);
END
$fn_probe$;

-- 試験用の行を作る（super_admin の権限で作る＝group_ids をそのまま入れられる）
CREATE FUNCTION pg_temp.scratch(p_key text, p_group text, p_extra_group text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $fn_scratch$
DECLARE
  v_id text := 'rls-test-' || replace(gen_random_uuid()::text, '-', '');
BEGIN
  IF coalesce(p_group, '') = '' THEN
    PERFORM set_config('rlst.' || p_key, '', true);
    RETURN;
  END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('email',
    (SELECT email FROM public.members WHERE is_super_admin AND NOT is_deleted ORDER BY id LIMIT 1))::text, true);
  INSERT INTO public.members (id, display_name, short_name, initials, color_bg, color_text, group_id, group_ids)
  VALUES (v_id, 'rls-test', 'rls', 'RT', 'x', 'x', p_group,
          CASE WHEN p_extra_group IS NULL THEN ARRAY[p_group] ELSE ARRAY[p_group, p_extra_group] END);
  PERFORM set_config('request.jwt.claims', '{}', true);
  PERFORM set_config('rlst.' || p_key, v_id, true);
END
$fn_scratch$;

-- ------------------------------------------------------------
-- ペルソナを選ぶ（id は結果に出さない）
-- ------------------------------------------------------------
-- 一般メンバー（ホーム部署が通常の部署・メールあり）
SELECT set_config('rlst.g_id', coalesce((
  SELECT m.id FROM public.members m JOIN public.groups g ON g.id = m.group_id
  WHERE NOT m.is_deleted AND NOT m.is_admin AND NOT m.is_super_admin AND m.email IS NOT NULL
    AND NOT g.is_invite_group AND NOT g.is_deleted
  ORDER BY m.id LIMIT 1), ''), true);
SELECT set_config('rlst.g_home', coalesce((SELECT group_id FROM public.members WHERE id = current_setting('rlst.g_id')), ''), true);

-- 自部署管理者（super_admin でない・部署1つ）
SELECT set_config('rlst.a_id', coalesce((
  SELECT m.id FROM public.members m JOIN public.groups g ON g.id = m.group_id
  WHERE NOT m.is_deleted AND m.is_admin AND NOT m.is_super_admin AND m.email IS NOT NULL
    AND cardinality(m.group_ids) = 1 AND NOT g.is_invite_group AND NOT g.is_deleted
  ORDER BY m.id LIMIT 1), ''), true);
SELECT set_config('rlst.a_home', coalesce((SELECT group_id FROM public.members WHERE id = current_setting('rlst.a_id')), ''), true);

-- 兼務管理者にする管理者（自部署管理者と別の人がいればその人。いなければ同じ人を後で兼務にする）
SELECT set_config('rlst.m_id', coalesce((
  SELECT m.id FROM public.members m JOIN public.groups g ON g.id = m.group_id
  WHERE NOT m.is_deleted AND m.is_admin AND NOT m.is_super_admin AND m.email IS NOT NULL
    AND cardinality(m.group_ids) = 1 AND NOT g.is_invite_group AND NOT g.is_deleted
  ORDER BY (m.id = current_setting('rlst.a_id')), m.id LIMIT 1), ''), true);
SELECT set_config('rlst.m_home', coalesce((SELECT group_id FROM public.members WHERE id = current_setting('rlst.m_id')), ''), true);

-- super_admin
SELECT set_config('rlst.s_id', coalesce((
  SELECT id FROM public.members WHERE NOT is_deleted AND is_super_admin AND email IS NOT NULL ORDER BY id LIMIT 1), ''), true);
SELECT set_config('rlst.s_home', coalesce((SELECT group_id FROM public.members WHERE id = current_setting('rlst.s_id')), ''), true);

-- 招待用部署の管理者（super_admin でない）と、その人に見えている招待用部署
SELECT set_config('rlst.i_id', coalesce((
  SELECT a.id FROM public.members a
  WHERE NOT a.is_deleted AND a.is_admin AND NOT a.is_super_admin AND a.email IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.groups g JOIN public.projects p ON g.id = ANY(p.group_ids)
                WHERE g.is_invite_group AND p.group_ids && a.group_ids)
  ORDER BY a.id LIMIT 1), ''), true);
SELECT set_config('rlst.i_home', coalesce((SELECT group_id FROM public.members WHERE id = current_setting('rlst.i_id')), ''), true);
SELECT set_config('rlst.i_invite', coalesce((
  SELECT g.id FROM public.groups g JOIN public.projects p ON g.id = ANY(p.group_ids)
  WHERE g.is_invite_group
    AND p.group_ids && (SELECT group_ids FROM public.members WHERE id = current_setting('rlst.i_id'))
  ORDER BY g.id LIMIT 1), ''), true);

-- ゲスト（ホーム部署が招待用部署・メールあり）
SELECT set_config('rlst.guest_id', coalesce((
  SELECT m.id FROM public.members m JOIN public.groups g ON g.id = m.group_id
  WHERE NOT m.is_deleted AND g.is_invite_group AND m.email IS NOT NULL
  ORDER BY m.id LIMIT 1), ''), true);
SELECT set_config('rlst.guest_home', coalesce((SELECT group_id FROM public.members WHERE id = current_setting('rlst.guest_id')), ''), true);

-- 「別の通常部署」（各ペルソナのホーム以外）
CREATE FUNCTION pg_temp.other_group(p_not text) RETURNS text LANGUAGE sql AS $fn_other$
  SELECT coalesce((SELECT id FROM public.groups
                   WHERE NOT is_deleted AND NOT is_invite_group AND id IS DISTINCT FROM nullif(p_not, '')
                   ORDER BY id LIMIT 1), '')
$fn_other$;
SELECT set_config('rlst.g_other', pg_temp.other_group(current_setting('rlst.g_home')), true);
SELECT set_config('rlst.a_other', pg_temp.other_group(current_setting('rlst.a_home')), true);
SELECT set_config('rlst.m_kenmu', pg_temp.other_group(current_setting('rlst.m_home')), true);
SELECT set_config('rlst.s_other', pg_temp.other_group(current_setting('rlst.s_home')), true);
SELECT set_config('rlst.i_other', pg_temp.other_group(current_setting('rlst.i_home')), true);

-- 試験用の行
SELECT pg_temp.scratch('t_g_home', current_setting('rlst.g_home'));
SELECT pg_temp.scratch('t_a_home', current_setting('rlst.a_home'));
SELECT pg_temp.scratch('t_a_other', current_setting('rlst.a_other'));
SELECT pg_temp.scratch('t_m_home', current_setting('rlst.m_home'));
SELECT pg_temp.scratch('t_m_kenmu', current_setting('rlst.m_kenmu'));
SELECT pg_temp.scratch('t_s_other', current_setting('rlst.s_other'));
SELECT pg_temp.scratch('t_i_guest', nullif(current_setting('rlst.i_invite'), ''));
SELECT pg_temp.scratch('t_i_other_in_invite', nullif(current_setting('rlst.i_other'), ''), nullif(current_setting('rlst.i_invite'), ''));
SELECT pg_temp.scratch('t_guest_peer', current_setting('rlst.guest_home'));

-- ------------------------------------------------------------
-- 1. 一般メンバー
-- ------------------------------------------------------------
SELECT pg_temp.probe('g_upd_self_name', current_setting('rlst.g_id'),
  $q$UPDATE public.members SET display_name = display_name WHERE id = current_setting('rlst.g_id')$q$);
SELECT pg_temp.probe('g_upd_self_is_admin', current_setting('rlst.g_id'),
  $q$UPDATE public.members SET is_admin = true WHERE id = current_setting('rlst.g_id')$q$,
  $q$SELECT is_admin::text FROM public.members WHERE id = current_setting('rlst.g_id')$q$);
SELECT pg_temp.probe('g_upd_self_email', current_setting('rlst.g_id'),
  $q$UPDATE public.members SET email = 'rls-test@example.invalid' WHERE id = current_setting('rlst.g_id')$q$);
SELECT pg_temp.probe('g_upd_self_group', current_setting('rlst.g_id'),
  $q$UPDATE public.members SET group_id = nullif(current_setting('rlst.g_other'), '') WHERE id = current_setting('rlst.g_id')$q$,
  $q$SELECT (group_id = current_setting('rlst.g_home'))::text FROM public.members WHERE id = current_setting('rlst.g_id')$q$);
SELECT pg_temp.probe('g_softdel_self', current_setting('rlst.g_id'),
  $q$UPDATE public.members SET is_deleted = true WHERE id = current_setting('rlst.g_id')$q$,
  $q$SELECT is_deleted::text FROM public.members WHERE id = current_setting('rlst.g_id')$q$);
SELECT pg_temp.probe('g_upd_other_name', current_setting('rlst.g_id'),
  $q$UPDATE public.members SET display_name = 'rls-test-2' WHERE id = current_setting('rlst.t_g_home')$q$);
SELECT pg_temp.probe('g_softdel_other', current_setting('rlst.g_id'),
  $q$UPDATE public.members SET is_deleted = true WHERE id = current_setting('rlst.t_g_home')$q$);
SELECT pg_temp.probe('g_del_other', current_setting('rlst.g_id'),
  $q$DELETE FROM public.members WHERE id = current_setting('rlst.t_g_home')$q$);
SELECT pg_temp.probe('g_ins_home', current_setting('rlst.g_id'),
  $q$INSERT INTO public.members (id, display_name, short_name, initials, color_bg, color_text, group_id)
     VALUES ('rls-test-ins-' || replace(gen_random_uuid()::text, '-', ''), 'rls-test', 'rls', 'RT', 'x', 'x', current_setting('rlst.g_home'))$q$);

-- ------------------------------------------------------------
-- 2. 自部署管理者
-- ------------------------------------------------------------
SELECT pg_temp.probe('a_upd_member_name', current_setting('rlst.a_id'),
  $q$UPDATE public.members SET display_name = 'rls-test-2' WHERE id = current_setting('rlst.t_a_home')$q$);
SELECT pg_temp.probe('a_set_member_admin', current_setting('rlst.a_id'),
  $q$UPDATE public.members SET is_admin = true WHERE id = current_setting('rlst.t_a_home')$q$,
  $q$SELECT is_admin::text FROM public.members WHERE id = current_setting('rlst.t_a_home')$q$);
SELECT pg_temp.probe('a_softdel_member', current_setting('rlst.a_id'),
  $q$UPDATE public.members SET is_deleted = true WHERE id = current_setting('rlst.t_a_home')$q$,
  $q$SELECT is_deleted::text FROM public.members WHERE id = current_setting('rlst.t_a_home')$q$);
SELECT pg_temp.probe('a_del_member', current_setting('rlst.a_id'),
  $q$DELETE FROM public.members WHERE id = current_setting('rlst.t_a_home')$q$);
SELECT pg_temp.probe('a_ins_home', current_setting('rlst.a_id'),
  $q$INSERT INTO public.members (id, display_name, short_name, initials, color_bg, color_text, group_id)
     VALUES ('rls-test-ins-' || replace(gen_random_uuid()::text, '-', ''), 'rls-test', 'rls', 'RT', 'x', 'x', current_setting('rlst.a_home'))$q$);
SELECT pg_temp.probe('a_ins_other_dept', current_setting('rlst.a_id'),
  $q$INSERT INTO public.members (id, display_name, short_name, initials, color_bg, color_text, group_id)
     VALUES ('rls-test-ins-' || replace(gen_random_uuid()::text, '-', ''), 'rls-test', 'rls', 'RT', 'x', 'x', current_setting('rlst.a_other'))$q$);
SELECT pg_temp.probe('a_move_member_out', current_setting('rlst.a_id'),
  $q$UPDATE public.members SET group_id = current_setting('rlst.a_other') WHERE id = current_setting('rlst.t_a_home')$q$,
  $q$SELECT (group_id = current_setting('rlst.a_home'))::text FROM public.members WHERE id = current_setting('rlst.t_a_home')$q$);
SELECT pg_temp.probe('a_upd_other_dept', current_setting('rlst.a_id'),
  $q$UPDATE public.members SET display_name = 'rls-test-2' WHERE id = current_setting('rlst.t_a_other')$q$);
SELECT pg_temp.probe('a_upd_self_name', current_setting('rlst.a_id'),
  $q$UPDATE public.members SET display_name = display_name WHERE id = current_setting('rlst.a_id')$q$);
SELECT pg_temp.probe('a_rename_home_group', current_setting('rlst.a_id'),
  $q$UPDATE public.groups SET name = name WHERE id = current_setting('rlst.a_home')$q$);
SELECT pg_temp.probe('a_rename_other_group', current_setting('rlst.a_id'),
  $q$UPDATE public.groups SET name = name WHERE id = current_setting('rlst.a_other')$q$);

-- ------------------------------------------------------------
-- 3. 兼務管理者（兼務先＝m_kenmu）。ここで管理者の1人に兼務先を足す（ROLLBACK で消える）
-- ------------------------------------------------------------
SELECT set_config('request.jwt.claims', json_build_object('email',
  (SELECT email FROM public.members WHERE id = current_setting('rlst.s_id')))::text, true);
UPDATE public.members
   SET group_ids = array_append(group_ids, current_setting('rlst.m_kenmu'))
 WHERE id = current_setting('rlst.m_id') AND current_setting('rlst.m_kenmu') <> ''
   AND NOT (current_setting('rlst.m_kenmu') = ANY(group_ids));
SELECT set_config('request.jwt.claims', '{}', true);
SELECT set_config('rlst.m_is_kenmu', coalesce((
  SELECT (cardinality(group_ids) = 2)::text FROM public.members WHERE id = current_setting('rlst.m_id')), 'false'), true);

SELECT pg_temp.probe('m_upd_kenmu_member', current_setting('rlst.m_id'),
  $q$UPDATE public.members SET display_name = 'rls-test-2' WHERE id = current_setting('rlst.t_m_kenmu')$q$);
SELECT pg_temp.probe('m_set_kenmu_member_admin', current_setting('rlst.m_id'),
  $q$UPDATE public.members SET is_admin = true WHERE id = current_setting('rlst.t_m_kenmu')$q$,
  $q$SELECT is_admin::text FROM public.members WHERE id = current_setting('rlst.t_m_kenmu')$q$);
SELECT pg_temp.probe('m_softdel_kenmu_member', current_setting('rlst.m_id'),
  $q$UPDATE public.members SET is_deleted = true WHERE id = current_setting('rlst.t_m_kenmu')$q$,
  $q$SELECT is_deleted::text FROM public.members WHERE id = current_setting('rlst.t_m_kenmu')$q$);
SELECT pg_temp.probe('m_del_kenmu_member', current_setting('rlst.m_id'),
  $q$DELETE FROM public.members WHERE id = current_setting('rlst.t_m_kenmu')$q$);
SELECT pg_temp.probe('m_ins_kenmu', current_setting('rlst.m_id'),
  $q$INSERT INTO public.members (id, display_name, short_name, initials, color_bg, color_text, group_id)
     VALUES ('rls-test-ins-' || replace(gen_random_uuid()::text, '-', ''), 'rls-test', 'rls', 'RT', 'x', 'x', current_setting('rlst.m_kenmu'))$q$);
SELECT pg_temp.probe('m_move_home_to_kenmu', current_setting('rlst.m_id'),
  $q$UPDATE public.members SET group_id = current_setting('rlst.m_kenmu') WHERE id = current_setting('rlst.t_m_home')$q$,
  $q$SELECT (group_id = current_setting('rlst.m_home'))::text FROM public.members WHERE id = current_setting('rlst.t_m_home')$q$);
SELECT pg_temp.probe('m_upd_home_member', current_setting('rlst.m_id'),
  $q$UPDATE public.members SET display_name = 'rls-test-2' WHERE id = current_setting('rlst.t_m_home')$q$);
SELECT pg_temp.probe('m_rename_kenmu_group', current_setting('rlst.m_id'),
  $q$UPDATE public.groups SET name = name WHERE id = current_setting('rlst.m_kenmu')$q$);

-- ------------------------------------------------------------
-- 4. super_admin
-- ------------------------------------------------------------
SELECT pg_temp.probe('s_upd_other_dept', current_setting('rlst.s_id'),
  $q$UPDATE public.members SET display_name = 'rls-test-2' WHERE id = current_setting('rlst.t_s_other')$q$);
SELECT pg_temp.probe('s_move_member', current_setting('rlst.s_id'),
  $q$UPDATE public.members SET group_id = nullif(current_setting('rlst.s_home'), '') WHERE id = current_setting('rlst.t_s_other')$q$,
  $q$SELECT (group_id IS NOT DISTINCT FROM nullif(current_setting('rlst.s_home'), ''))::text FROM public.members WHERE id = current_setting('rlst.t_s_other')$q$);
SELECT pg_temp.probe('s_del_other_dept', current_setting('rlst.s_id'),
  $q$DELETE FROM public.members WHERE id = current_setting('rlst.t_s_other')$q$);
SELECT pg_temp.probe('s_ins_other_dept', current_setting('rlst.s_id'),
  $q$INSERT INTO public.members (id, display_name, short_name, initials, color_bg, color_text, group_id)
     VALUES ('rls-test-ins-' || replace(gen_random_uuid()::text, '-', ''), 'rls-test', 'rls', 'RT', 'x', 'x', current_setting('rlst.s_other'))$q$);

-- ------------------------------------------------------------
-- 5. 招待用部署の管理者
-- ------------------------------------------------------------
SELECT pg_temp.probe('i_upd_guest', current_setting('rlst.i_id'),
  $q$UPDATE public.members SET display_name = 'rls-test-2' WHERE id = current_setting('rlst.t_i_guest')$q$);
SELECT pg_temp.probe('i_set_guest_admin', current_setting('rlst.i_id'),
  $q$UPDATE public.members SET is_admin = true WHERE id = current_setting('rlst.t_i_guest')$q$,
  $q$SELECT is_admin::text FROM public.members WHERE id = current_setting('rlst.t_i_guest')$q$);
SELECT pg_temp.probe('i_softdel_guest', current_setting('rlst.i_id'),
  $q$UPDATE public.members SET is_deleted = true WHERE id = current_setting('rlst.t_i_guest')$q$,
  $q$SELECT is_deleted::text FROM public.members WHERE id = current_setting('rlst.t_i_guest')$q$);
SELECT pg_temp.probe('i_del_guest', current_setting('rlst.i_id'),
  $q$DELETE FROM public.members WHERE id = current_setting('rlst.t_i_guest')$q$);
-- 別部署の通常メンバーで、同じ招待用部署にも兼務している人（決定1により、ホーム部署の管理者でないので触れない）
SELECT pg_temp.probe('i_upd_other_dept_in_invite', current_setting('rlst.i_id'),
  $q$UPDATE public.members SET display_name = 'rls-test-2' WHERE id = current_setting('rlst.t_i_other_in_invite')$q$);

-- ------------------------------------------------------------
-- 6. ゲスト本人（ホーム部署が招待用部署）
-- ------------------------------------------------------------
SELECT pg_temp.probe('guest_upd_self_name', current_setting('rlst.guest_id'),
  $q$UPDATE public.members SET display_name = display_name WHERE id = current_setting('rlst.guest_id')$q$);
SELECT pg_temp.probe('guest_set_self_admin', current_setting('rlst.guest_id'),
  $q$UPDATE public.members SET is_admin = true WHERE id = current_setting('rlst.guest_id')$q$,
  $q$SELECT is_admin::text FROM public.members WHERE id = current_setting('rlst.guest_id')$q$);
SELECT pg_temp.probe('guest_upd_peer_guest', current_setting('rlst.guest_id'),
  $q$UPDATE public.members SET display_name = 'rls-test-2' WHERE id = current_setting('rlst.t_guest_peer')$q$);

-- ------------------------------------------------------------
-- 結果（件数・真偽のみ）
-- ------------------------------------------------------------
SELECT x.persona, x.check_name, current_setting('rlst.' || x.check_name) AS actual,
       x.expected_after, x.expected_before,
       CASE WHEN current_setting('rlst.' || x.check_name) = 'no-persona' THEN 'SKIP'
            WHEN current_setting('rlst.' || x.check_name) = x.expected_after THEN 'OK' ELSE 'DIFF' END AS judge_after,
       CASE WHEN current_setting('rlst.' || x.check_name) = 'no-persona' THEN 'SKIP'
            WHEN current_setting('rlst.' || x.check_name) = x.expected_before THEN 'OK' ELSE 'DIFF' END AS judge_before
  FROM (VALUES
    ('0_setup',            'm_is_kenmu',                 'true',    'true'),
    ('1_general',          'g_upd_self_name',            '1',       '1'),
    ('1_general',          'g_upd_self_is_admin',        '1/false', '1/false'),
    ('1_general',          'g_upd_self_email',           'denied',  '1'),
    ('1_general',          'g_upd_self_group',           '1/true',  '1/true'),
    ('1_general',          'g_softdel_self',             '1/false', '1/false'),
    ('1_general',          'g_upd_other_name',           '0',       '1'),
    ('1_general',          'g_softdel_other',            '0',       '1'),
    ('1_general',          'g_del_other',                '0',       '1'),
    ('1_general',          'g_ins_home',                 'denied',  '1'),
    ('2_home_admin',       'a_upd_member_name',          '1',       '1'),
    ('2_home_admin',       'a_set_member_admin',         '1/true',  '1/true'),
    ('2_home_admin',       'a_softdel_member',           '1/true',  '1/true'),
    ('2_home_admin',       'a_del_member',               '1',       '1'),
    ('2_home_admin',       'a_ins_home',                 '1',       '1'),
    ('2_home_admin',       'a_ins_other_dept',           'denied',  'denied'),
    ('2_home_admin',       'a_move_member_out',          '1/true',  'denied'),
    ('2_home_admin',       'a_upd_other_dept',           '0',       '0'),
    ('2_home_admin',       'a_upd_self_name',            '1',       '1'),
    ('2_home_admin',       'a_rename_home_group',        '1',       '1'),
    ('2_home_admin',       'a_rename_other_group',       '0',       '0'),
    ('3_kenmu_admin',      'm_upd_kenmu_member',         '0',       '1'),
    ('3_kenmu_admin',      'm_set_kenmu_member_admin',   '0/false', '1/true'),
    ('3_kenmu_admin',      'm_softdel_kenmu_member',     '0/false', '1/true'),
    ('3_kenmu_admin',      'm_del_kenmu_member',         '0',       '1'),
    ('3_kenmu_admin',      'm_ins_kenmu',                'denied',  '1'),
    ('3_kenmu_admin',      'm_move_home_to_kenmu',       '1/true',  '1/false'),
    ('3_kenmu_admin',      'm_upd_home_member',          '1',       '1'),
    ('3_kenmu_admin',      'm_rename_kenmu_group',       '0',       '0'),
    ('4_super_admin',      's_upd_other_dept',           '1',       '1'),
    ('4_super_admin',      's_move_member',              '1/true',  '1/true'),
    ('4_super_admin',      's_del_other_dept',           '1',       '1'),
    ('4_super_admin',      's_ins_other_dept',           '1',       '1'),
    ('5_invite_admin',     'i_upd_guest',                '1',       '1'),
    ('5_invite_admin',     'i_set_guest_admin',          '1/true',  '1/true'),
    ('5_invite_admin',     'i_softdel_guest',            '1/true',  '1/true'),
    ('5_invite_admin',     'i_del_guest',                '1',       '1'),
    ('5_invite_admin',     'i_upd_other_dept_in_invite', '0',       '1'),
    ('6_guest',            'guest_upd_self_name',        '1',       '1'),
    ('6_guest',            'guest_set_self_admin',       '1/false', '1/false'),
    ('6_guest',            'guest_upd_peer_guest',       '0',       '1')
  ) AS x(persona, check_name, expected_after, expected_before)
 ORDER BY 1, 2;

ROLLBACK;
