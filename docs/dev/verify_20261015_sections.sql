-- ============================================================
-- 想定クエリ名：PJ内グループ（project_sections）マイグレ 20261015 の適用後検証（ROLLBACK で終わる）
-- 2026-10-15 ／ 最後に必ず ROLLBACK する（何も残らない）
--
-- 使い方：20261015_sections_deliverable.sql を適用した「後」に、Supabase SQL Editor へ全文を貼って実行する。
--   最後の SELECT の judge 列がすべて OK であること（SKIP は前提の行が足りないだけ）。
--   dev → prod の順。個人を特定する値は結果に出さない（結果は真偽と件数だけ）。
--
-- 仕組み：
--   - 試験用の行（id が 'vf-' で始まるタスク・グループ）を作って確かめる。既存の PJ を 2 つ借りる
--     （PJ が 1 つしか無い環境では「別 PJ へ移す」系の項目は SKIP）。全体を ROLLBACK するので何も残らない。
--   - SQL Editor は postgres ロールで動き RLS を迂回するため、トリガー（整合性）は postgres で、
--     RLS は SET LOCAL ROLE authenticated ＋ request.jwt.claims で別に確かめる（Section 58 の手順）。
-- ============================================================

BEGIN;

CREATE TEMP TABLE _vf (step int, name text, expected text, actual text);

DO $vf$
DECLARE
  p1 text; p2 text; g1 text; g2 text;
  s1 text := 'vf-s1'; s2 text := 'vf-s2'; s3 text := 'vf-s3';
  v text;
BEGIN
  SELECT id, (group_ids)[1] INTO p1, g1 FROM public.projects WHERE is_deleted = false ORDER BY created_at LIMIT 1;
  SELECT id, (group_ids)[1] INTO p2, g2 FROM public.projects WHERE is_deleted = false AND id <> p1 ORDER BY created_at LIMIT 1;
  IF p1 IS NULL THEN
    INSERT INTO _vf VALUES (0, 'PJ が 1 つも無い', '-', 'SKIP');
    RETURN;
  END IF;

  INSERT INTO public.project_sections (id, project_id, name, sort_order) VALUES
    (s1, p1, 'vf グループ1', 1), (s2, p1, 'vf グループ2', 2);
  IF p2 IS NOT NULL THEN
    INSERT INTO public.project_sections (id, project_id, name, sort_order) VALUES (s3, p2, 'vf 別PJのグループ', 1);
  END IF;

  -- 1) 親＋子。子が別のグループを指して作られても、親と同じグループに揃う
  INSERT INTO public.tasks (id, name, project_id, group_id, section_id) VALUES ('vf-parent', 'vf親', p1, g1, s1);
  INSERT INTO public.tasks (id, name, project_id, group_id, parent_task_id, section_id) VALUES ('vf-child', 'vf子', p1, g1, 'vf-parent', s2);
  SELECT section_id INTO v FROM public.tasks WHERE id = 'vf-child';
  INSERT INTO _vf VALUES (1, '子は親と同じグループに揃う（子の指定 s2 は無視）', s1, coalesce(v, 'null'));

  -- 2) 親を別グループへ移すと子も移る
  UPDATE public.tasks SET section_id = s2 WHERE id = 'vf-parent';
  SELECT section_id INTO v FROM public.tasks WHERE id = 'vf-child';
  INSERT INTO _vf VALUES (2, '親を s2 へ移すと子も s2', s2, coalesce(v, 'null'));

  -- 3) 子だけを別グループへ移そうとしても親に戻される
  UPDATE public.tasks SET section_id = s1 WHERE id = 'vf-child';
  SELECT section_id INTO v FROM public.tasks WHERE id = 'vf-child';
  INSERT INTO _vf VALUES (3, '子だけ別グループにはできない（親の s2 に戻る）', s2, coalesce(v, 'null'));

  -- 4) 別 PJ のグループは指せない（未分類へ戻る）
  IF p2 IS NOT NULL THEN
    UPDATE public.tasks SET section_id = s3 WHERE id = 'vf-parent';
    SELECT section_id INTO v FROM public.tasks WHERE id = 'vf-parent';
    INSERT INTO _vf VALUES (4, '別 PJ のグループを指すと NULL に戻る', 'null', coalesce(v, 'null'));

    -- 5) タスクの PJ を変えると section_id は NULL（親も子も）
    UPDATE public.tasks SET section_id = s2 WHERE id = 'vf-parent';
    UPDATE public.tasks SET project_id = p2, group_id = g2 WHERE id = 'vf-parent';
    SELECT coalesce(section_id, 'null') INTO v FROM public.tasks WHERE id = 'vf-parent';
    INSERT INTO _vf VALUES (5, 'PJ を変えた親は NULL', 'null', v);
    SELECT coalesce(section_id, 'null') INTO v FROM public.tasks WHERE id = 'vf-child';
    INSERT INTO _vf VALUES (6, 'その子も NULL（親の変更が子へ伝わる）', 'null', v);
    UPDATE public.tasks SET project_id = p1, group_id = g1 WHERE id = 'vf-parent';
  ELSE
    INSERT INTO _vf VALUES (4, '別 PJ 系（4〜6）', '-', 'SKIP');
  END IF;

  -- 7) PJ なしのタスクはグループを持てない
  INSERT INTO public.tasks (id, name, project_id, group_id, section_id) VALUES ('vf-nopj', 'vf PJなし', NULL, g1, s1);
  SELECT coalesce(section_id, 'null') INTO v FROM public.tasks WHERE id = 'vf-nopj';
  INSERT INTO _vf VALUES (7, 'PJ なしは NULL', 'null', v);

  -- 8) グループの論理削除で中のタスクは未分類へ
  UPDATE public.tasks SET section_id = s1 WHERE id = 'vf-parent';
  UPDATE public.project_sections SET is_deleted = true, deleted_at = now() WHERE id = s1;
  SELECT coalesce(section_id, 'null') INTO v FROM public.tasks WHERE id = 'vf-parent';
  INSERT INTO _vf VALUES (8, 'グループ削除で親が NULL', 'null', v);
  SELECT coalesce(section_id, 'null') INTO v FROM public.tasks WHERE id = 'vf-child';
  INSERT INTO _vf VALUES (9, 'グループ削除で子も NULL', 'null', v);

  -- 9) 削除済みのグループは指せない
  UPDATE public.tasks SET section_id = s1 WHERE id = 'vf-parent';
  SELECT coalesce(section_id, 'null') INTO v FROM public.tasks WHERE id = 'vf-parent';
  INSERT INTO _vf VALUES (10, '削除済みグループは指せない', 'null', v);

  -- 10) グループの project_id は変えられない
  UPDATE public.project_sections SET project_id = coalesce(p2, p1) WHERE id = s2;
  SELECT project_id INTO v FROM public.project_sections WHERE id = s2;
  INSERT INTO _vf VALUES (11, 'グループの project_id は不変', p1, v);

  -- 11) 成果物の既定値は空文字（NOT NULL）
  SELECT deliverable INTO v FROM public.tasks WHERE id = 'vf-nopj';
  INSERT INTO _vf VALUES (12, 'deliverable の既定は空文字', '', coalesce(v, 'null'));
END
$vf$;

-- 12) RLS：PJ に入れる人は作成・読み取りできる／入れない人は 0 件（authenticated ロールで確認）
DO $vf2$
DECLARE
  p1 text; g1 text; email_in text; email_out text; n int; v text;
BEGIN
  SELECT id, (group_ids)[1] INTO p1, g1 FROM public.projects WHERE is_deleted = false ORDER BY created_at LIMIT 1;
  IF p1 IS NULL THEN
    INSERT INTO _vf VALUES (13, 'RLS', '-', 'SKIP');
    RETURN;
  END IF;
  SELECT email INTO email_in FROM public.members
   WHERE is_deleted = false AND email IS NOT NULL AND group_ids @> ARRAY[g1] LIMIT 1;
  SELECT email INTO email_out FROM public.members
   WHERE is_deleted = false AND email IS NOT NULL AND NOT (group_ids && (SELECT group_ids FROM public.projects WHERE id = p1))
     AND coalesce(is_super_admin, false) = false LIMIT 1;

  IF email_in IS NULL THEN
    INSERT INTO _vf VALUES (13, 'RLS（PJ に入れる人）', '-', 'SKIP');
  ELSE
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
    INSERT INTO _vf VALUES (13, 'PJ に入れる人は作成して読める', '1', coalesce(v, 'null'));
  END IF;

  IF email_out IS NULL THEN
    INSERT INTO _vf VALUES (14, 'RLS（PJ に入れない人）', '-', 'SKIP');
  ELSE
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', email_out)::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
      EXECUTE 'SELECT count(*) FROM public.project_sections WHERE project_id = ' || quote_literal(p1) INTO n;
      v := n::text;
    EXCEPTION WHEN OTHERS THEN
      v := 'error ' || SQLSTATE;
    END;
    EXECUTE 'RESET ROLE';
    INSERT INTO _vf VALUES (14, 'PJ に入れない人には 0 件（他部署の PJ のグループが見えない）', '0', coalesce(v, 'null'));
  END IF;

  -- 匿名（email なし）は 0 件
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    EXECUTE 'SELECT count(*) FROM public.project_sections' INTO n;
    v := n::text;
  EXCEPTION WHEN OTHERS THEN
    v := 'error ' || SQLSTATE;
  END;
  EXECUTE 'RESET ROLE';
  INSERT INTO _vf VALUES (15, '匿名（メールなし）は 0 件', '0', coalesce(v, 'null'));
END
$vf2$;

-- 13) 構造の確認（試験データなし）
INSERT INTO _vf
SELECT 20, 'publication に project_sections がある', '1',
       (SELECT count(*)::text FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'project_sections');
INSERT INTO _vf
SELECT 21, 'publication に in_app_notifications がある', '1',
       (SELECT count(*)::text FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'in_app_notifications');
INSERT INTO _vf
SELECT 22, 'project_sections のポリシーは 1 本だけ（緩いものが並存していない）', '1',
       (SELECT count(*)::text FROM pg_policies WHERE schemaname = 'public' AND tablename = 'project_sections');
INSERT INTO _vf
SELECT 23, 'backup_snapshot（group 分岐）に project_sections が入っている', 'true',
       (position('project_sections' IN pg_get_functiondef('public.backup_snapshot(text,text,bigint,text)'::regprocedure)) > 0)::text;

SELECT step, name, expected, actual,
       CASE WHEN actual = 'SKIP' THEN 'SKIP' WHEN actual = expected THEN 'OK' ELSE 'NG' END AS judge
  FROM _vf ORDER BY step;

ROLLBACK;
