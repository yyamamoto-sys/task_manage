-- ============================================================
-- 想定クエリ名：OKRモード（地図）の記録用の表の煙試験（20261117_okr_map_records.sql の適用後に流す）
-- 2026-11-18 ／ 書き込みを試すが、1件ずつ取り消し、最後に必ず ROLLBACK する（何も残らない）
--
-- なぜ要るか：マイグレーション末尾の確認ブロックは「表・関数・トリガー・権限があるか」しか見ない。
--   トリガー関数の中身が実行時に失敗する誤り（91-6 M1：列の無い表で record "new" has no field）は、
--   SQL Editor（メンバーとして解決できない＝トリガーが先に RETURN する）で流しても見えない。
--   この試験は「画面と同じ authenticated の権限・同じメールの JWT」で書き込みを試す。
--
-- 使い方：
--   1) 下の ★ の1行だけ、自分（members に登録済みで削除されていない人）のメールアドレスに差し替える。
--      ※ current_member_id() はメールで本人を引くので、uid ではなくメールを使う。
--   2) Supabase SQL Editor に全文を貼って実行する。最後の SELECT の表（と NOTICE）を見る。
--   3) judge 列がすべて OK（または SKIP）ならよい。NG の行は actual に SQLSTATE と原因が出る。
-- 個人を特定する値（メール・名前・id）は結果に出さない。
--
-- actual の読み方：'ok:行数' ／ 'ok:行数/読み戻し' ／ 'denied'＝RLS か付け替え禁止のトリガー（42501）
--   ／ 'error 23514'＝部署の一致のトリガー ／ 'error 55000'＝取り消し済みの回の確定 ／ 'skip'＝試すデータが無い
-- ============================================================

BEGIN;

-- ★ ここだけ差し替える（試す人のメールアドレス）
SELECT set_config('smoke.email', 'your.name@example.com', true);

CREATE TEMP TABLE smoke_result (no int, check_name text, expected text, actual text) ON COMMIT DROP;

-- 1回の試行：authenticated として p_pre（準備）→ p_sql（本番）を流し、影響行数と p_check の読み戻しを記録して、全部取り消す
CREATE FUNCTION pg_temp.try(p_no int, p_name text, p_expected text, p_sql text, p_check text DEFAULT NULL, p_pre text[] DEFAULT ARRAY[]::text[])
RETURNS void LANGUAGE plpgsql AS $fn_try$
DECLARE
  n int;
  v text;
  r text;
  s text;
BEGIN
  IF p_sql IS NULL THEN
    r := 'skip';
  ELSE
    BEGIN
      PERFORM set_config('request.jwt.claims',
        json_build_object('role', 'authenticated', 'email', current_setting('smoke.email'))::text, true);
      EXECUTE 'SET LOCAL ROLE authenticated';
      FOREACH s IN ARRAY p_pre LOOP
        EXECUTE s;
      END LOOP;
      EXECUTE p_sql;
      GET DIAGNOSTICS n = ROW_COUNT;
      r := 'ok:' || n::text;
      IF p_check IS NOT NULL THEN
        EXECUTE p_check INTO v;
        r := r || '/' || coalesce(v, 'null');
      END IF;
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = '__undo__';
    EXCEPTION
      WHEN insufficient_privilege THEN r := 'denied';
      WHEN OTHERS THEN
        IF SQLERRM <> '__undo__' THEN r := 'error ' || SQLSTATE || ' ' || left(SQLERRM, 120); END IF;
    END;
  END IF;
  INSERT INTO smoke_result VALUES (p_no, p_name, p_expected, r);
  RAISE NOTICE '% %：期待 % ／ 結果 %', p_no, p_name, p_expected, r;
END;
$fn_try$;

DO $smoke$
DECLARE
  v_me      text;
  v_groups  text[];
  v_kr      text;   -- 自分の部署の KR
  v_kr_x    text;   -- 他部署の KR
  v_task    text;   -- 自分が担当する、自分の部署の仕事
  v_task_x  text;   -- 他部署の仕事
  v_other   text;   -- 自分以外のメンバー
  v_ci      uuid := gen_random_uuid();
  v_ci2     uuid := gen_random_uuid();
  v_week    date := date_trunc('week', current_date)::date;
  v_confirm text;
  v_note    text;
BEGIN
  SELECT m.id, m.group_ids INTO v_me, v_groups FROM public.members m
   WHERE m.email = current_setting('smoke.email') AND m.is_deleted = false LIMIT 1;
  IF v_me IS NULL THEN
    RAISE EXCEPTION '★ のメールアドレスのメンバーが見つかりません（members に登録済み・削除されていない人にしてください）';
  END IF;
  SELECT kr.id INTO v_kr FROM public.key_results kr WHERE kr.group_id = ANY (v_groups) AND kr.is_deleted = false LIMIT 1;
  SELECT kr.id INTO v_kr_x FROM public.key_results kr WHERE NOT (kr.group_id = ANY (v_groups)) AND kr.is_deleted = false LIMIT 1;
  SELECT t.id INTO v_task FROM public.tasks t
   WHERE t.is_deleted = false AND t.group_ids && v_groups
     AND (t.assignee_member_id = v_me OR v_me = ANY (coalesce(t.assignee_member_ids, ARRAY[]::text[]))) LIMIT 1;
  SELECT t.id INTO v_task_x FROM public.tasks t WHERE t.is_deleted = false AND NOT (t.group_ids && v_groups) LIMIT 1;
  SELECT m.id INTO v_other FROM public.members m WHERE m.id <> v_me AND m.is_deleted = false LIMIT 1;

  -- 1) 書いた本人のトリガー（INSERT の経路）：updated_by に別人を送っても本人になる
  PERFORM pg_temp.try(1, 'okr_kr_defs を入れる（自分の部署の KR・updated_by は本人になる）', 'ok:1/true',
    CASE WHEN v_kr IS NOT NULL THEN format(
      'INSERT INTO public.okr_kr_defs (kr_id, bands, evidence, updated_by) VALUES (%L, ''{"60":"smoke"}''::jsonb, ''smoke'', ''someone-else'')'
      ' ON CONFLICT (kr_id) DO UPDATE SET evidence = ''smoke'', updated_by = ''someone-else''', v_kr) END,
    format('SELECT (updated_by = %L)::text FROM public.okr_kr_defs WHERE kr_id = %L', v_me, v_kr));

  -- 2) 書いた本人のトリガー（UPDATE の経路・OLD を読む）
  PERFORM pg_temp.try(2, 'okr_kr_defs を直す（UPDATE）', 'ok:1/true',
    CASE WHEN v_kr IS NOT NULL THEN format('UPDATE public.okr_kr_defs SET evidence = ''smoke2'', updated_by = ''someone-else'' WHERE kr_id = %L', v_kr) END,
    format('SELECT (updated_by = %L)::text FROM public.okr_kr_defs WHERE kr_id = %L', v_me, v_kr),
    CASE WHEN v_kr IS NOT NULL THEN ARRAY[format('INSERT INTO public.okr_kr_defs (kr_id) VALUES (%L) ON CONFLICT (kr_id) DO NOTHING', v_kr)] ELSE ARRAY[]::text[] END);

  -- 3) 確定の RPC（最小の payload）：回ができ、確定した人は本人
  v_confirm := format('SELECT public.okr_confirm_checkin(jsonb_build_object(''checkin'', jsonb_build_object(''id'', %L, ''group_id'', %L, ''date'', current_date, ''title'', ''smoke'')))',
                      v_ci, v_groups[1]);
  PERFORM pg_temp.try(3, 'okr_confirm_checkin（最小）', 'ok:1/true', v_confirm,
    format('SELECT (confirmed_by = %L)::text FROM public.okr_checkins WHERE id = %L', v_me, v_ci));

  -- 4) 確定の RPC：自分の部署の KR の学びを入れる（一致・本人・部署のトリガーが通る）
  PERFORM pg_temp.try(4, '確定で学びを1件（自分の部署の KR）', 'ok:1/1',
    CASE WHEN v_kr IS NOT NULL THEN format(
      'SELECT public.okr_confirm_checkin(jsonb_build_object(''checkin'', jsonb_build_object(''id'', %L, ''group_id'', %L, ''date'', current_date, ''title'', ''smoke''),'
      ' ''learnings'', jsonb_build_array(jsonb_build_object(''kr_id'', %L, ''kind'', ''分かったこと'', ''body'', ''smoke''))))', v_ci, v_groups[1], v_kr) END,
    format('SELECT count(*)::text FROM public.okr_learnings WHERE checkin_id = %L AND is_deleted = false', v_ci));

  -- 5) 確定の RPC：他部署の KR の学びは拒否（部署の一致のトリガー）。全体が取り消され、回も残らない
  PERFORM pg_temp.try(5, '確定で他部署の KR の学び（拒否）', 'error 23514',
    CASE WHEN v_kr_x IS NOT NULL THEN format(
      'SELECT public.okr_confirm_checkin(jsonb_build_object(''checkin'', jsonb_build_object(''id'', %L, ''group_id'', %L, ''date'', current_date, ''title'', ''smoke''),'
      ' ''learnings'', jsonb_build_array(jsonb_build_object(''kr_id'', %L, ''kind'', ''分かったこと'', ''body'', ''smoke''))))', v_ci, v_groups[1], v_kr_x) END);

  -- 6) 本人限定の表：自分の行は入る
  PERFORM pg_temp.try(6, 'okr_weekly_answers に自分の答え', 'ok:1',
    CASE WHEN v_kr IS NOT NULL THEN format(
      'INSERT INTO public.okr_weekly_answers (member_id, week_start, kr_id, effect) VALUES (%L, %L, %L, ''役立った'')'
      ' ON CONFLICT (member_id, week_start, kr_id) DO UPDATE SET effect = ''役立った''', v_me, v_week, v_kr) END);

  -- 7) 本人限定の表：他人の行は拒否
  PERFORM pg_temp.try(7, 'okr_weekly_answers に他人の答え（拒否）', 'denied',
    CASE WHEN v_kr IS NOT NULL AND v_other IS NOT NULL THEN format(
      'INSERT INTO public.okr_weekly_answers (member_id, week_start, kr_id, effect) VALUES (%L, %L, %L, ''役立った'')', v_other, v_week, v_kr) END);

  -- 8) 他部署の KR の定めは拒否（RLS）
  PERFORM pg_temp.try(8, '他部署の KR の okr_kr_defs（拒否）', 'denied',
    CASE WHEN v_kr_x IS NOT NULL THEN format('INSERT INTO public.okr_kr_defs (kr_id) VALUES (%L)', v_kr_x) END);

  -- 9・10) 結びつき：準備として確定で成果の記述と自分あての結びつきを作り、答える（通る）・付け替える（拒否）
  v_note := CASE WHEN v_kr IS NOT NULL AND v_task IS NOT NULL THEN format(
    'SELECT public.okr_confirm_checkin(jsonb_build_object(''checkin'', jsonb_build_object(''id'', %L, ''group_id'', %L, ''date'', current_date, ''title'', ''smoke''),'
    ' ''notes'', jsonb_build_array(jsonb_build_object(''kr_id'', %L, ''note_key'', ''smoke-note'', ''sources'', ''[]''::jsonb, ''links'', ''[]''::jsonb)),'
    ' ''claims'', jsonb_build_array(jsonb_build_object(''kr_id'', %L, ''note_key'', ''smoke-note'', ''task_id'', %L, ''member_id'', %L))))',
    v_ci, v_groups[1], v_kr, v_kr, v_task, v_me) END;
  PERFORM pg_temp.try(9, '結びつきに答える（yes）', 'ok:1',
    CASE WHEN v_note IS NOT NULL THEN format(
      'UPDATE public.okr_outcome_claims SET status = ''yes'', answered_at = now() WHERE member_id = %L AND task_id = %L'
      ' AND note_id = (SELECT id FROM public.okr_outcome_notes WHERE kr_id = %L AND note_key = ''smoke-note'')', v_me, v_task, v_kr) END,
    NULL, CASE WHEN v_note IS NOT NULL THEN ARRAY[v_note] ELSE ARRAY[]::text[] END);
  PERFORM pg_temp.try(10, '結びつきの仕事を付け替える（拒否）', 'denied',
    CASE WHEN v_note IS NOT NULL AND v_task_x IS NOT NULL THEN format(
      'UPDATE public.okr_outcome_claims SET task_id = %L WHERE member_id = %L AND task_id = %L'
      ' AND note_id = (SELECT id FROM public.okr_outcome_notes WHERE kr_id = %L AND note_key = ''smoke-note'')', v_task_x, v_me, v_task, v_kr) END,
    NULL, CASE WHEN v_note IS NOT NULL THEN ARRAY[v_note] ELSE ARRAY[]::text[] END);

  -- 11) 担当者の判定関数を rpc で直に呼んでも、他部署の仕事の担当者は返らない
  PERFORM pg_temp.try(11, 'okr_task_assignee_ids（他部署の仕事は NULL）', 'ok:1/true',
    CASE WHEN v_task_x IS NOT NULL THEN 'SELECT 1' END,
    format('SELECT (public.okr_task_assignee_ids(%L) IS NULL)::text', v_task_x));

  -- 12) 取り消し済みの回は確定し直せない
  PERFORM pg_temp.try(12, '取り消し済みの回の確定（拒否）', 'error 55000',
    format('SELECT public.okr_confirm_checkin(jsonb_build_object(''checkin'', jsonb_build_object(''id'', %L, ''group_id'', %L, ''date'', current_date, ''title'', ''smoke'')))', v_ci2, v_groups[1]),
    NULL,
    ARRAY[
      format('SELECT public.okr_confirm_checkin(jsonb_build_object(''checkin'', jsonb_build_object(''id'', %L, ''group_id'', %L, ''date'', current_date, ''title'', ''smoke'')))', v_ci2, v_groups[1]),
      format('UPDATE public.okr_checkins SET is_deleted = true, deleted_at = now() WHERE id = %L', v_ci2)
    ]);
END;
$smoke$;

SELECT no, check_name, expected, actual,
       CASE WHEN actual = 'skip' THEN 'SKIP'
            WHEN actual = expected OR actual LIKE expected || ' %' THEN 'OK'
            ELSE 'NG' END AS judge
  FROM smoke_result
 ORDER BY no;

ROLLBACK;
