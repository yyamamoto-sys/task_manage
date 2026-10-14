-- ============================================================
-- 想定クエリ名：PJ内グループ（project_sections）マイグレ 20261015 の適用後検証（DO 1文・必ず取り消される）
-- 2026-10-15
--
-- 使い方：20261015_sections_deliverable.sql を適用した「後」に、Supabase SQL Editor へ全文を貼って実行する。
--   結果はエラーメッセージとして表示される（ERROR: 検証結果…）。これは意図した動作で、何も残らない。
--   各行は「step｜name｜expected｜actual｜judge」。judge が OK か SKIP だけならよい（NG があれば要確認）。
--   SKIP は前提の行が足りないだけ（PJ が1つしか無い／該当メンバーがいない／ロール切替が使えない）。
--   dev → prod の順。個人を特定する値は結果に出さない（結果は真偽と件数だけ）。
--
-- 仕組み：
--   - 全体が DO ブロック1文だけ。一時表・BEGIN/ROLLBACK・SET LOCAL に依存しない
--     （SQL Editor は文ごとに別の接続・別のトランザクションで実行しうるため）。
--   - 検証結果は plpgsql の配列に溜め、最後に RAISE EXCEPTION で全体を出す。例外でブロック全体が
--     ロールバックされるので、試験用の行（id が 'vf-' で始まるタスク・グループ）は何も残らない。
--   - 各検証は BEGIN ... EXCEPTION で囲んである。予期しない例外は、その項目を NG（SQLERRM 付き）として
--     記録して先へ進む。
--   - 試験用の行を作って確かめる。既存の PJ を 2 つ借りる
--     （PJ が 1 つしか無い環境では「別 PJ へ移す」系の項目は SKIP）。
--   - SQL Editor は postgres ロールで動き RLS を迂回するため、トリガー（整合性）は postgres で、
--     RLS は set_config('request.jwt.claims') ＋ SET LOCAL ROLE authenticated で別に確かめる
--     （Section 58 の手順）。ロールを切り替えられない環境では step 13〜15 は SKIP になる。
-- ============================================================

DO $vf$
DECLARE
  res text[] := ARRAY[]::text[];
  p1 text; p2 text; g1 text; g2 text;
  s1 text := 'vf-s1'; s2 text := 'vf-s2'; s3 text := 'vf-s3';
  v text;
  n int;
  email_in text; email_out text;
  can_role boolean := false;
  role_err text := '';
  n_ok int; n_ng int; n_skip int;
BEGIN
  <<core>>
  BEGIN
    SELECT id, (group_ids)[1] INTO p1, g1 FROM public.projects WHERE is_deleted = false ORDER BY created_at LIMIT 1;
    SELECT id, (group_ids)[1] INTO p2, g2 FROM public.projects WHERE is_deleted = false AND id <> p1 ORDER BY created_at LIMIT 1;
    IF p1 IS NULL THEN
      res := array_append(res, '00｜PJ が 1 つも無い｜-｜-｜SKIP');
      EXIT core;
    END IF;

    -- 準備：試験用のグループを作る
    BEGIN
      INSERT INTO public.project_sections (id, project_id, name, sort_order) VALUES
        (s1, p1, 'vf グループ1', 1), (s2, p1, 'vf グループ2', 2);
      IF p2 IS NOT NULL THEN
        INSERT INTO public.project_sections (id, project_id, name, sort_order) VALUES (s3, p2, 'vf 別PJのグループ', 1);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      res := array_append(res, format('00｜試験用グループの作成｜-｜%s｜NG', left(SQLERRM, 120)));
      EXIT core;
    END;

    -- 1) 親＋子。子が別のグループを指して作られても、親と同じグループに揃う
    BEGIN
      INSERT INTO public.tasks (id, name, project_id, group_id, section_id) VALUES ('vf-parent', 'vf親', p1, g1, s1);
      INSERT INTO public.tasks (id, name, project_id, group_id, parent_task_id, section_id) VALUES ('vf-child', 'vf子', p1, g1, 'vf-parent', s2);
      SELECT section_id INTO v FROM public.tasks WHERE id = 'vf-child';
      res := array_append(res, format('01｜子は親と同じグループに揃う｜%s｜%s｜%s', s1, coalesce(v, 'null'),
        CASE WHEN coalesce(v, 'null') = s1 THEN 'OK' ELSE 'NG' END));
    EXCEPTION WHEN OTHERS THEN
      res := array_append(res, format('01｜子は親と同じグループに揃う｜%s｜%s｜NG', s1, left(SQLERRM, 120)));
    END;

    -- 2) 親を別グループへ移すと子も移る
    BEGIN
      UPDATE public.tasks SET section_id = s2 WHERE id = 'vf-parent';
      SELECT section_id INTO v FROM public.tasks WHERE id = 'vf-child';
      res := array_append(res, format('02｜親を s2 へ移すと子も s2｜%s｜%s｜%s', s2, coalesce(v, 'null'),
        CASE WHEN coalesce(v, 'null') = s2 THEN 'OK' ELSE 'NG' END));
    EXCEPTION WHEN OTHERS THEN
      res := array_append(res, format('02｜親を s2 へ移すと子も s2｜%s｜%s｜NG', s2, left(SQLERRM, 120)));
    END;

    -- 3) 子だけを別グループへ移そうとしても親に戻される
    BEGIN
      UPDATE public.tasks SET section_id = s1 WHERE id = 'vf-child';
      SELECT section_id INTO v FROM public.tasks WHERE id = 'vf-child';
      res := array_append(res, format('03｜子だけ別グループにはできない｜%s｜%s｜%s', s2, coalesce(v, 'null'),
        CASE WHEN coalesce(v, 'null') = s2 THEN 'OK' ELSE 'NG' END));
    EXCEPTION WHEN OTHERS THEN
      res := array_append(res, format('03｜子だけ別グループにはできない｜%s｜%s｜NG', s2, left(SQLERRM, 120)));
    END;

    -- 4) 別 PJ のグループは指せない（未分類へ戻る）／5)6) タスクの PJ を変えると section_id は NULL
    IF p2 IS NOT NULL THEN
      BEGIN
        UPDATE public.tasks SET section_id = s3 WHERE id = 'vf-parent';
        SELECT section_id INTO v FROM public.tasks WHERE id = 'vf-parent';
        res := array_append(res, format('04｜別 PJ のグループを指すと NULL｜null｜%s｜%s', coalesce(v, 'null'),
          CASE WHEN coalesce(v, 'null') = 'null' THEN 'OK' ELSE 'NG' END));
      EXCEPTION WHEN OTHERS THEN
        res := array_append(res, format('04｜別 PJ のグループを指すと NULL｜null｜%s｜NG', left(SQLERRM, 120)));
      END;

      BEGIN
        UPDATE public.tasks SET section_id = s2 WHERE id = 'vf-parent';
        UPDATE public.tasks SET project_id = p2, group_id = g2 WHERE id = 'vf-parent';
        SELECT coalesce(section_id, 'null') INTO v FROM public.tasks WHERE id = 'vf-parent';
        res := array_append(res, format('05｜PJ を変えた親は NULL｜null｜%s｜%s', v,
          CASE WHEN v = 'null' THEN 'OK' ELSE 'NG' END));
        SELECT coalesce(section_id, 'null') INTO v FROM public.tasks WHERE id = 'vf-child';
        res := array_append(res, format('06｜その子も NULL（親の変更が伝わる）｜null｜%s｜%s', v,
          CASE WHEN v = 'null' THEN 'OK' ELSE 'NG' END));
        UPDATE public.tasks SET project_id = p1, group_id = g1 WHERE id = 'vf-parent';
      EXCEPTION WHEN OTHERS THEN
        res := array_append(res, format('05｜PJ を変えた親と子は NULL｜null｜%s｜NG', left(SQLERRM, 120)));
      END;
    ELSE
      res := array_append(res, '04｜別 PJ 系（4〜6）｜-｜SKIP｜SKIP');
    END IF;

    -- 7) PJ なしのタスクはグループを持てない
    BEGIN
      INSERT INTO public.tasks (id, name, project_id, group_id, section_id) VALUES ('vf-nopj', 'vf PJなし', NULL, g1, s1);
      SELECT coalesce(section_id, 'null') INTO v FROM public.tasks WHERE id = 'vf-nopj';
      res := array_append(res, format('07｜PJ なしは NULL｜null｜%s｜%s', v,
        CASE WHEN v = 'null' THEN 'OK' ELSE 'NG' END));
    EXCEPTION WHEN OTHERS THEN
      res := array_append(res, format('07｜PJ なしは NULL｜null｜%s｜NG', left(SQLERRM, 120)));
    END;

    -- 8) グループの論理削除で中のタスクは未分類へ（親・子）
    BEGIN
      UPDATE public.tasks SET section_id = s1 WHERE id = 'vf-parent';
      UPDATE public.project_sections SET is_deleted = true, deleted_at = now() WHERE id = s1;
      SELECT coalesce(section_id, 'null') INTO v FROM public.tasks WHERE id = 'vf-parent';
      res := array_append(res, format('08｜グループ削除で親が NULL｜null｜%s｜%s', v,
        CASE WHEN v = 'null' THEN 'OK' ELSE 'NG' END));
      SELECT coalesce(section_id, 'null') INTO v FROM public.tasks WHERE id = 'vf-child';
      res := array_append(res, format('09｜グループ削除で子も NULL｜null｜%s｜%s', v,
        CASE WHEN v = 'null' THEN 'OK' ELSE 'NG' END));
    EXCEPTION WHEN OTHERS THEN
      res := array_append(res, format('08｜グループ削除で親子が NULL｜null｜%s｜NG', left(SQLERRM, 120)));
    END;

    -- 9) 削除済みのグループは指せない
    BEGIN
      UPDATE public.tasks SET section_id = s1 WHERE id = 'vf-parent';
      SELECT coalesce(section_id, 'null') INTO v FROM public.tasks WHERE id = 'vf-parent';
      res := array_append(res, format('10｜削除済みグループは指せない｜null｜%s｜%s', v,
        CASE WHEN v = 'null' THEN 'OK' ELSE 'NG' END));
    EXCEPTION WHEN OTHERS THEN
      res := array_append(res, format('10｜削除済みグループは指せない｜null｜%s｜NG', left(SQLERRM, 120)));
    END;

    -- 10) グループの project_id は変えられない
    BEGIN
      UPDATE public.project_sections SET project_id = coalesce(p2, p1) WHERE id = s2;
      SELECT project_id INTO v FROM public.project_sections WHERE id = s2;
      res := array_append(res, format('11｜グループの project_id は不変｜PJ1｜%s｜%s',
        CASE WHEN v = p1 THEN 'PJ1' ELSE 'changed' END,
        CASE WHEN v = p1 THEN 'OK' ELSE 'NG' END));
    EXCEPTION WHEN OTHERS THEN
      res := array_append(res, format('11｜グループの project_id は不変｜PJ1｜%s｜NG', left(SQLERRM, 120)));
    END;

    -- 11) 成果物の既定値は空文字（NOT NULL）
    BEGIN
      SELECT deliverable INTO v FROM public.tasks WHERE id = 'vf-nopj';
      res := array_append(res, format('12｜deliverable の既定は空文字｜(空文字)｜%s｜%s',
        CASE WHEN v IS NULL THEN 'null' WHEN v = '' THEN '(空文字)' ELSE 'other' END,
        CASE WHEN v = '' THEN 'OK' ELSE 'NG' END));
    EXCEPTION WHEN OTHERS THEN
      res := array_append(res, format('12｜deliverable の既定は空文字｜(空文字)｜%s｜NG', left(SQLERRM, 120)));
    END;
  EXCEPTION WHEN OTHERS THEN
    res := array_append(res, format('00｜step 1〜12 の途中で予期しない例外｜-｜%s｜NG', left(SQLERRM, 120)));
  END;

  -- 12) RLS：PJ に入れる人は作成・読み取りできる／入れない人は 0 件（authenticated ロールで確認）
  <<rls>>
  BEGIN
    IF p1 IS NULL THEN
      res := array_append(res, '13｜RLS（PJ に入れる人）｜-｜-｜SKIP');
      res := array_append(res, '14｜RLS（PJ に入れない人）｜-｜-｜SKIP');
      res := array_append(res, '15｜RLS（匿名）｜-｜-｜SKIP');
      EXIT rls;
    END IF;

    -- ロール切替が使えるかを先に確かめる（使えなければ無理に通さず SKIP）
    BEGIN
      EXECUTE 'SET LOCAL ROLE authenticated';
      EXECUTE 'RESET ROLE';
      can_role := true;
    EXCEPTION WHEN OTHERS THEN
      can_role := false;
      role_err := left(SQLERRM, 80);
    END;

    IF NOT can_role THEN
      res := array_append(res, format('13｜RLS（PJ に入れる人）｜-｜ロール切替不可 %s｜SKIP', role_err));
      res := array_append(res, '14｜RLS（PJ に入れない人）｜-｜ロール切替不可｜SKIP');
      res := array_append(res, '15｜RLS（匿名）｜-｜ロール切替不可｜SKIP');
      EXIT rls;
    END IF;

    SELECT email INTO email_in FROM public.members
     WHERE is_deleted = false AND email IS NOT NULL AND group_ids @> ARRAY[g1] LIMIT 1;
    SELECT email INTO email_out FROM public.members
     WHERE is_deleted = false AND email IS NOT NULL AND NOT (group_ids && (SELECT group_ids FROM public.projects WHERE id = p1))
       AND coalesce(is_super_admin, false) = false LIMIT 1;

    -- 13) PJ に入れる人は作成して読める
    IF email_in IS NULL THEN
      res := array_append(res, '13｜RLS（PJ に入れる人）｜-｜該当メンバー無し｜SKIP');
    ELSE
      BEGIN
        PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', email_in)::text, true);
        EXECUTE 'SET LOCAL ROLE authenticated';
        BEGIN
          INSERT INTO public.project_sections (id, project_id, name) VALUES ('vf-s-rls', p1, 'vf RLS');
          EXECUTE 'SELECT count(*) FROM public.project_sections WHERE id = ''vf-s-rls''' INTO n;
          v := n::text;
        EXCEPTION WHEN OTHERS THEN
          v := 'error ' || SQLSTATE;
        END;
        EXECUTE 'RESET ROLE';
        res := array_append(res, format('13｜PJ に入れる人は作成して読める｜1｜%s｜%s', coalesce(v, 'null'),
          CASE WHEN coalesce(v, 'null') = '1' THEN 'OK' ELSE 'NG' END));
      EXCEPTION WHEN OTHERS THEN
        res := array_append(res, format('13｜PJ に入れる人は作成して読める｜1｜%s｜NG', left(SQLERRM, 120)));
      END;
    END IF;

    -- 14) PJ に入れない人には 0 件
    IF email_out IS NULL THEN
      res := array_append(res, '14｜RLS（PJ に入れない人）｜-｜該当メンバー無し｜SKIP');
    ELSE
      BEGIN
        PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', email_out)::text, true);
        EXECUTE 'SET LOCAL ROLE authenticated';
        BEGIN
          EXECUTE 'SELECT count(*) FROM public.project_sections WHERE project_id = ' || quote_literal(p1) INTO n;
          v := n::text;
        EXCEPTION WHEN OTHERS THEN
          v := 'error ' || SQLSTATE;
        END;
        EXECUTE 'RESET ROLE';
        res := array_append(res, format('14｜PJ に入れない人には 0 件｜0｜%s｜%s', coalesce(v, 'null'),
          CASE WHEN coalesce(v, 'null') = '0' THEN 'OK' ELSE 'NG' END));
      EXCEPTION WHEN OTHERS THEN
        res := array_append(res, format('14｜PJ に入れない人には 0 件｜0｜%s｜NG', left(SQLERRM, 120)));
      END;
    END IF;

    -- 15) 匿名（email なし）は 0 件
    BEGIN
      PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);
      EXECUTE 'SET LOCAL ROLE authenticated';
      BEGIN
        EXECUTE 'SELECT count(*) FROM public.project_sections' INTO n;
        v := n::text;
      EXCEPTION WHEN OTHERS THEN
        v := 'error ' || SQLSTATE;
      END;
      EXECUTE 'RESET ROLE';
      res := array_append(res, format('15｜匿名（メールなし）は 0 件｜0｜%s｜%s', coalesce(v, 'null'),
        CASE WHEN coalesce(v, 'null') = '0' THEN 'OK' ELSE 'NG' END));
    EXCEPTION WHEN OTHERS THEN
      res := array_append(res, format('15｜匿名（メールなし）は 0 件｜0｜%s｜NG', left(SQLERRM, 120)));
    END;
  EXCEPTION WHEN OTHERS THEN
    res := array_append(res, format('13｜RLS の途中で予期しない例外｜-｜%s｜NG', left(SQLERRM, 120)));
  END;

  -- 13) 構造の確認（試験データなし）
  BEGIN
    SELECT count(*)::text INTO v FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'project_sections';
    res := array_append(res, format('20｜publication に project_sections｜1｜%s｜%s', v,
      CASE WHEN v = '1' THEN 'OK' ELSE 'NG' END));
  EXCEPTION WHEN OTHERS THEN
    res := array_append(res, format('20｜publication に project_sections｜1｜%s｜NG', left(SQLERRM, 120)));
  END;

  BEGIN
    SELECT count(*)::text INTO v FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'in_app_notifications';
    res := array_append(res, format('21｜publication に in_app_notifications｜1｜%s｜%s', v,
      CASE WHEN v = '1' THEN 'OK' ELSE 'NG' END));
  EXCEPTION WHEN OTHERS THEN
    res := array_append(res, format('21｜publication に in_app_notifications｜1｜%s｜NG', left(SQLERRM, 120)));
  END;

  BEGIN
    SELECT (SELECT count(*)::text FROM pg_policies WHERE schemaname = 'public' AND tablename = 'project_sections'
             AND cmd IN ('SELECT', 'INSERT', 'UPDATE'))
        || '/' || (SELECT count(*)::text FROM pg_policies WHERE schemaname = 'public' AND tablename = 'project_sections')
      INTO v;
    res := array_append(res, format('22｜ポリシーは select/insert/update の3本のみ｜3/3｜%s｜%s', v,
      CASE WHEN v = '3/3' THEN 'OK' ELSE 'NG' END));
  EXCEPTION WHEN OTHERS THEN
    res := array_append(res, format('22｜ポリシーは select/insert/update の3本のみ｜3/3｜%s｜NG', left(SQLERRM, 120)));
  END;

  BEGIN
    SELECT (position('project_sections' IN pg_get_functiondef('public.backup_snapshot(text,text,bigint,text)'::regprocedure)) > 0)::text
      INTO v;
    res := array_append(res, format('23｜backup_snapshot に project_sections｜true｜%s｜%s', v,
      CASE WHEN v = 'true' THEN 'OK' ELSE 'NG' END));
  EXCEPTION WHEN OTHERS THEN
    res := array_append(res, format('23｜backup_snapshot に project_sections｜true｜%s｜NG', left(SQLERRM, 120)));
  END;

  -- 集計して、必ず RAISE EXCEPTION で全体を出す（＝ここまでの試験用の行はすべてロールバックされる）
  SELECT count(*) FILTER (WHERE l LIKE '%｜OK'),
         count(*) FILTER (WHERE l LIKE '%｜NG'),
         count(*) FILTER (WHERE l LIKE '%｜SKIP')
    INTO n_ok, n_ng, n_skip
    FROM unnest(res) AS l;

  RAISE EXCEPTION '%', format('検証結果（この後すべて取り消されます）：OK %s件／NG %s件／SKIP %s件', n_ok, n_ng, n_skip)
    || E'\n' || array_to_string(res, E'\n');
END
$vf$;
