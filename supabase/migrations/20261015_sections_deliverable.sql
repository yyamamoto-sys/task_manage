-- 想定クエリ名：PJ内の「グループ」（project_sections）とタスクの「成果物」欄（v3.149）
-- ============================================================
-- 2026-10-15（v3.149）
--
-- 【何をするか】
--   1. project_sections 表を作る（PJごとのグループ。画面の文言は「グループ」・コードと DB は section で統一する。
--      社内では「グループ」が部署（groups 表）の意味でも使われるため）。
--   2. tasks.section_id（NULL＝未分類）と tasks.deliverable（成果物の説明・複数行・URL を含みうる）を足す。
--   3. 整合性をトリガーで DB に持たせる（画面だけを信じない）：
--        - 子タスクは親と同じグループ（親を移すと子も移る・子だけ別にはできない）
--        - タスクの PJ が変わる／PJ なしになる／別 PJ のグループを指している場合は section_id を NULL に戻す
--        - グループを論理削除すると、中のタスクは未分類（NULL）に戻る
--   4. RLS（milestones と同じ流儀＝PJ の可視範囲に従う。PJ の基本情報と同じく部署内の誰でも作成・編集可）。
--   5. Realtime の publication に project_sections と in_app_notifications を追加（再実行安全）。
--   6. 日次バックアップ backup_snapshot の group 分岐に project_sections を追加する。
--      full 分岐は information_schema から表を動的に列挙して 40 表ずつ連結する作りなので、この表は自動で入る
--      （2026-10-07 の jsonb_build_object 引数上限 100 の教訓。何もしなくてよい）。group 分岐だけが表を
--      ハードコードしているため、この版で 1 行足している。
--
-- 【適用方法】Supabase SQL Editor に全文を貼って一度に実行する（dev → prod の順）。再実行しても安全
--   （IF NOT EXISTS・CREATE OR REPLACE・DROP ... IF EXISTS・DO ブロック内の存在確認）。
--   末尾の確認クエリで結果を見る。適用後に初めてフロントを push する（列・表が無い本番に新画面を出さない）。
--
-- 【本番の現行 backup_snapshot について】
--   本ファイルの backup_snapshot は 20261007_fix_backup_snapshot_arg_limit.sql（2026-10-07 に本番の
--   pg_get_functiondef と同一であることを確認済み）の全文に、'project_sections' の 1 行だけを足したもの。
--   適用前に念のため、本番で pg_get_functiondef('public.backup_snapshot(text,text,bigint,text)'::regprocedure)
--   を取り、20261007 の内容と一致していることを確認すること。
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- ① project_sections
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_sections (
  id          text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id  text NOT NULL REFERENCES public.projects(id),
  name        text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  sort_order  integer NOT NULL DEFAULT 0,
  is_deleted  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text,
  deleted_at  timestamptz,
  deleted_by  text
);

CREATE INDEX IF NOT EXISTS idx_project_sections_project_id
  ON public.project_sections(project_id) WHERE is_deleted = false;

DROP TRIGGER IF EXISTS trg_project_sections_updated_at ON public.project_sections;
CREATE TRIGGER trg_project_sections_updated_at
  BEFORE UPDATE ON public.project_sections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- グループの所属 PJ は変えない（別 PJ へ移すとタスクが別 PJ のグループを指す事故になる）。
CREATE OR REPLACE FUNCTION public.keep_section_project_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn_keep_section_project_id$
BEGIN
  IF NEW.project_id IS DISTINCT FROM OLD.project_id THEN
    NEW.project_id := OLD.project_id;
  END IF;
  RETURN NEW;
END;
$fn_keep_section_project_id$;

DROP TRIGGER IF EXISTS trg_project_sections_keep_project ON public.project_sections;
CREATE TRIGGER trg_project_sections_keep_project
  BEFORE UPDATE ON public.project_sections
  FOR EACH ROW EXECUTE FUNCTION public.keep_section_project_id();

-- ------------------------------------------------------------
-- ② tasks.section_id ／ ③ tasks.deliverable
-- ------------------------------------------------------------
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS section_id text REFERENCES public.project_sections(id);
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS deliverable text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_tasks_section_id
  ON public.tasks(section_id) WHERE section_id IS NOT NULL;

-- ------------------------------------------------------------
-- ⑥ 整合性トリガー
-- ------------------------------------------------------------

-- (a) タスクの INSERT／UPDATE の直前：親と同じグループへ揃え、PJ と食い違うグループは外す。
--     SECURITY DEFINER（RLS で見えない行も参照して判定するため）。search_path は空に固定。
CREATE OR REPLACE FUNCTION public.enforce_task_section_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_enforce_task_section_integrity$
DECLARE
  v_parent_section text;
  v_section_project text;
BEGIN
  -- 子タスクは親と同じグループ（親が未分類なら子も未分類）
  IF NEW.parent_task_id IS NOT NULL THEN
    SELECT p.section_id INTO v_parent_section
      FROM public.tasks p
     WHERE p.id = NEW.parent_task_id;
    NEW.section_id := v_parent_section;
  END IF;

  -- PJ なし・別 PJ のグループ・削除済みのグループを指していたら未分類へ戻す
  IF NEW.section_id IS NOT NULL THEN
    IF NEW.project_id IS NULL THEN
      NEW.section_id := NULL;
    ELSE
      SELECT s.project_id INTO v_section_project
        FROM public.project_sections s
       WHERE s.id = NEW.section_id
         AND s.is_deleted = false;
      IF v_section_project IS DISTINCT FROM NEW.project_id THEN
        NEW.section_id := NULL;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$fn_enforce_task_section_integrity$;

DROP TRIGGER IF EXISTS trg_tasks_section_integrity ON public.tasks;
CREATE TRIGGER trg_tasks_section_integrity
  BEFORE INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.enforce_task_section_integrity();

-- (b) 親タスクのグループが変わったら、子タスクも同じグループへ（親を移すと子も移る）。
--     WHEN を使い、section_id が実際に変わった行だけを対象にする（無関係な更新で子を触らない）。
CREATE OR REPLACE FUNCTION public.cascade_task_section_to_children()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_cascade_task_section_to_children$
BEGIN
  UPDATE public.tasks c
     SET section_id = NEW.section_id
   WHERE c.parent_task_id = NEW.id
     AND c.section_id IS DISTINCT FROM NEW.section_id;
  RETURN NULL;
END;
$fn_cascade_task_section_to_children$;

DROP TRIGGER IF EXISTS trg_tasks_section_cascade ON public.tasks;
CREATE TRIGGER trg_tasks_section_cascade
  AFTER UPDATE ON public.tasks
  FOR EACH ROW
  WHEN (OLD.section_id IS DISTINCT FROM NEW.section_id)
  EXECUTE FUNCTION public.cascade_task_section_to_children();

-- (c) グループを論理削除したら、中のタスクは未分類へ戻る。
CREATE OR REPLACE FUNCTION public.release_tasks_on_section_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_release_tasks_on_section_delete$
BEGIN
  UPDATE public.tasks t
     SET section_id = NULL
   WHERE t.section_id = NEW.id;
  RETURN NULL;
END;
$fn_release_tasks_on_section_delete$;

DROP TRIGGER IF EXISTS trg_project_sections_release_tasks ON public.project_sections;
CREATE TRIGGER trg_project_sections_release_tasks
  AFTER UPDATE ON public.project_sections
  FOR EACH ROW
  WHEN (NEW.is_deleted = true AND OLD.is_deleted = false)
  EXECUTE FUNCTION public.release_tasks_on_section_delete();

-- ------------------------------------------------------------
-- ④ RLS（milestones と同じ＝PJ の可視範囲に従う。SELECT／INSERT／UPDATE の3本に分け、INSERT・UPDATE には WITH CHECK を明示。DELETE は作らない）
--    PJ の基本情報と同じく、PJ にアクセスできる人なら誰でも作成・編集・削除できる
--    （canEditProjectBasicInfo と同じ規則。Section 55）。
-- ------------------------------------------------------------
ALTER TABLE public.project_sections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_all" ON public.project_sections;
DROP POLICY IF EXISTS "authenticated full access" ON public.project_sections;
DROP POLICY IF EXISTS "project_sections_group" ON public.project_sections;
DROP POLICY IF EXISTS "project_sections_select" ON public.project_sections;
DROP POLICY IF EXISTS "project_sections_insert" ON public.project_sections;
DROP POLICY IF EXISTS "project_sections_update" ON public.project_sections;
-- DELETE のポリシーは作らない（物理削除禁止。削除は is_deleted の UPDATE）
CREATE POLICY "project_sections_select" ON public.project_sections
  FOR SELECT TO authenticated
  USING (public.can_access_group_ids(public.project_group_ids(project_id)));
CREATE POLICY "project_sections_insert" ON public.project_sections
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access_group_ids(public.project_group_ids(project_id)));
CREATE POLICY "project_sections_update" ON public.project_sections
  FOR UPDATE TO authenticated
  USING (public.can_access_group_ids(public.project_group_ids(project_id)))
  WITH CHECK (public.can_access_group_ids(public.project_group_ids(project_id)));

-- ------------------------------------------------------------
-- ⑤ Realtime の publication（再実行安全）
--    project_sections：他の人のグループの追加・改名・並べ替え・削除をリロードなしで反映するため。
--    in_app_notifications：20261002b と同じ DO ブロック（未適用の環境でもここで一緒に入る）。
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'project_sections'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.project_sections';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'in_app_notifications'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.in_app_notifications';
  END IF;
END $$;

-- ------------------------------------------------------------
-- ⑦ 日次バックアップ：backup_snapshot（group 分岐に project_sections を 1 行追加）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.backup_snapshot(
  p_scope       text,
  p_group_id    text DEFAULT NULL,
  p_run_id      bigint DEFAULT NULL,
  p_app_version text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_backup_snapshot$
DECLARE
  v_taken_at      timestamptz := now();
  v_all_tables    text[];
  v_parts         text;
  v_sql           text;
  v_tables        jsonb;
  v_schema        jsonb;
  v_row_counts    jsonb;
  v_orphan_counts jsonb;
  v_sha256        text;
  v_result        jsonb;
BEGIN
  IF p_scope NOT IN ('full', 'group') THEN
    RAISE EXCEPTION 'invalid scope: %', p_scope;
  END IF;
  IF p_scope = 'group' AND (p_group_id IS NULL OR p_group_id = '') THEN
    RAISE EXCEPTION 'p_group_id is required when p_scope = group';
  END IF;

  -- ============================================================
  -- 🔴 REPEATABLE READ は「使えない」うえに「使う必要もない」（2026-09-16 実測で確定）
  --
  -- ここには EXECUTE 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ' を置いていたが、
  -- Supabase SQL Editor も PostgREST 経由のRPCも、既にトランザクションを開始した状態で
  -- この関数を呼ぶため、必ず次のエラーで失敗する：
  --   25001: SET TRANSACTION ISOLATION LEVEL must be called before any query
  -- 関数の外から分離レベルを指定する手段も無い（PostgRESTは各リクエストのトランザクションを
  -- 自分で開始するため、呼び出し側から介入できない）。
  --
  -- 削除しても、テーブル間の整合性（親を読んだ後に作られた子行が孤児になる問題）は保たれる。
  -- 理由：PostgreSQLは READ COMMITTED でも「1つのSQL文」は文の開始時点の単一スナップショットを
  -- 文全体で使う。full・group とも、テーブル群の取得を1文にまとめてある：
  --   - full  : EXECUTE v_sql（全テーブルのサブクエリを並べた jsonb_build_object を40表ずつ連結した動的SQL）1文
  --   - group : WITH ... SELECT jsonb_build_object(...) 1文
  -- この1文の中では全テーブルが同じ時点を見るため、分離レベルを上げる必要が無い。
  --
  -- 🔴 この前提を壊さないこと：テーブル群の取得を複数のSQL文に分割すると、文と文の間で
  -- 他トランザクションのコミットが見えるようになり、整合性が崩れる。分割したくなったら、
  -- 先にこのコメントを読み直すこと。
  -- ============================================================

  IF p_scope = 'full' THEN
    ------------------------------------------------------------
    -- full：テーブル一覧をハードコードせず動的に列挙し、1SQL文で丸ごと取得する
    -- （§3.1「新テーブルが追加されたとき黙って漏れないため」）。
    ------------------------------------------------------------
    SELECT array_agg(table_name ORDER BY table_name)
    INTO v_all_tables
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name NOT IN ('backup_runs', 'backup_objects', 'backup_exports');

    -- 🔴 jsonb_build_object に渡せる引数は100個まで（PostgreSQLの関数引数の上限。超えると
    -- 54023 で失敗する）。1表につき2引数（表名・中身）を使うため、40表＝80引数ずつの
    -- jsonb_build_object に分け、jsonb の連結演算子でつないだ式にする。連結しても
    -- 「1つのSELECT文」のままなので、全表が同じ時点を見る性質（上の🔴）は保たれる。
    -- 2026-10-02 に対象が52表＝104引数になり、full だけが毎日失敗していた（20261007で修正）。
    SELECT string_agg(c.chunk_sql, ' || ' ORDER BY c.chunk_no)
    INTO v_parts
    FROM (
      SELECT
        (u.ord - 1) / 40 AS chunk_no,
        format(
          'jsonb_build_object(%s)',
          string_agg(
            format('%L, coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM public.%I t), ''[]''::jsonb)', u.tbl, u.tbl),
            ', ' ORDER BY u.ord
          )
        ) AS chunk_sql
      FROM unnest(v_all_tables) WITH ORDINALITY AS u(tbl, ord)
      GROUP BY (u.ord - 1) / 40
    ) c;

    -- 対象表が0個だと v_parts は NULL になる。旧実装と同じく空オブジェクトを返す。
    v_sql := 'SELECT ' || coalesce(v_parts, '''{}''::jsonb');
    EXECUTE v_sql INTO v_tables;

    -- スキーマ情報（復元時の差分検出用。§5・§9）
    SELECT jsonb_object_agg(c.table_name, c.cols)
    INTO v_schema
    FROM (
      SELECT
        table_name,
        jsonb_agg(
          jsonb_build_object(
            'column', column_name,
            'type', data_type,
            'nullable', (is_nullable = 'YES')
          ) ORDER BY ordinal_position
        ) AS cols
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ANY(v_all_tables)
      GROUP BY table_name
    ) c;

    -- 孤児行（§4「孤児データの扱い」）：層Aの直接列がNULL/空のまま残った行の件数。
    -- 層B以下は親を辿るため、親が論理削除(is_deleted)されているだけならFKは有効で
    -- 孤児にはならない（このカウントは物理的な欠落・注入漏れの検知が目的）。
    SELECT jsonb_object_agg(s.t, s.c)
    INTO v_orphan_counts
    FROM (
      SELECT 'objectives'::text AS t, count(*) AS c FROM public.objectives WHERE group_id IS NULL
      UNION ALL SELECT 'key_results', count(*) FROM public.key_results WHERE group_id IS NULL
      UNION ALL SELECT 'quarterly_objectives', count(*) FROM public.quarterly_objectives WHERE group_id IS NULL
      UNION ALL SELECT 'task_forces', count(*) FROM public.task_forces WHERE group_id IS NULL
      UNION ALL SELECT 'todos', count(*) FROM public.todos WHERE group_id IS NULL
      UNION ALL SELECT 'kr_quarter_plans', count(*) FROM public.kr_quarter_plans WHERE group_id IS NULL
      UNION ALL SELECT 'members', count(*) FROM public.members WHERE coalesce(array_length(group_ids, 1), 0) = 0
      UNION ALL SELECT 'projects', count(*) FROM public.projects WHERE coalesce(array_length(group_ids, 1), 0) = 0
      UNION ALL SELECT 'tasks', count(*) FROM public.tasks WHERE coalesce(array_length(group_ids, 1), 0) = 0
    ) s
    WHERE s.c > 0;

  ELSE
    ------------------------------------------------------------
    -- group：層A（直接列）＋層B（親を辿る）。層Cは含めない（§4）。
    -- 🔴 personal_kr_* / personal_period_reviews / member_widget_layouts /
    -- member_tag_members は members.group_ids（兼務）ではなく members.group_id
    -- （ホーム部署）で仕分ける（§4「個人データの仕分けは『ホーム部署』を使う」）。
    ------------------------------------------------------------
    WITH
      home_members AS (
        SELECT id FROM public.members WHERE group_id = p_group_id
      ),
      grp_objectives AS (
        SELECT id FROM public.objectives WHERE group_id = p_group_id
      ),
      grp_krs AS (
        SELECT id FROM public.key_results WHERE group_id = p_group_id
      ),
      grp_quarterly_objectives AS (
        SELECT id FROM public.quarterly_objectives WHERE group_id = p_group_id
      ),
      grp_projects AS (
        SELECT id FROM public.projects WHERE group_ids && ARRAY[p_group_id]
      ),
      grp_tasks AS (
        SELECT id FROM public.tasks WHERE group_ids && ARRAY[p_group_id]
      ),
      -- 🔴 personal_krs は group_id（NOT NULL）を持つが、仕分けには使わない（§4）。
      -- この列は「そのKRが参照するグループKRの部署」であり、データの所有者を表さない。
      -- group_id で仕分けると、同じ人の個人OKRが「KR本体はA部署・期末振り返り（member_id
      -- 基準）はB部署」に分裂し、どちらのファイルからも復元できなくなる（2026-09-16に
      -- 本番の実データで確認：personal_krs 7件=AID / personal_period_reviews 2件=grp-egg）。
      grp_personal_krs AS (
        SELECT id FROM public.personal_krs WHERE member_id IN (SELECT id FROM home_members)
      ),
      grp_personal_kr_weeks AS (
        SELECT id FROM public.personal_kr_weeks WHERE personal_kr_id IN (SELECT id FROM grp_personal_krs)
      ),
      grp_kr_sessions AS (
        SELECT id FROM public.kr_sessions WHERE kr_id IN (SELECT id FROM grp_krs)
      ),
      grp_kr_notes AS (
        SELECT id FROM public.kr_meeting_notes WHERE kr_id IN (SELECT id FROM grp_krs)
      )
    SELECT jsonb_build_object(
      'groups', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.groups x WHERE x.id = p_group_id),
      'members', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.members x WHERE x.group_ids && ARRAY[p_group_id]),
      'objectives', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.objectives x WHERE x.id IN (SELECT id FROM grp_objectives)),
      'key_results', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.key_results x WHERE x.id IN (SELECT id FROM grp_krs)),
      'quarterly_objectives', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.quarterly_objectives x WHERE x.id IN (SELECT id FROM grp_quarterly_objectives)),
      'task_forces', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.task_forces x WHERE x.group_id = p_group_id),
      'todos', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.todos x WHERE x.group_id = p_group_id),
      'projects', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.projects x WHERE x.id IN (SELECT id FROM grp_projects)),
      'tasks', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.tasks x WHERE x.id IN (SELECT id FROM grp_tasks)),
      'task_dependencies', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.task_dependencies x WHERE x.group_id = p_group_id),
      'kr_quarter_plans', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.kr_quarter_plans x WHERE x.group_id = p_group_id),
      'personal_krs', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.personal_krs x WHERE x.id IN (SELECT id FROM grp_personal_krs)),
      'project_invites', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.project_invites x WHERE x.invite_group_id = p_group_id),

      'personal_kr_months', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.personal_kr_months x WHERE x.personal_kr_id IN (SELECT id FROM grp_personal_krs)),
      'personal_kr_weeks', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.personal_kr_weeks x WHERE x.personal_kr_id IN (SELECT id FROM grp_personal_krs)),
      'personal_kr_week_tasks', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.personal_kr_week_tasks x WHERE x.week_id IN (SELECT id FROM grp_personal_kr_weeks)),
      'personal_kr_memos', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.personal_kr_memos x WHERE x.personal_kr_id IN (SELECT id FROM grp_personal_krs)),
      'personal_kr_outlooks', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.personal_kr_outlooks x WHERE x.personal_kr_id IN (SELECT id FROM grp_personal_krs)),
      'personal_kr_review_drafts', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.personal_kr_review_drafts x WHERE x.personal_kr_id IN (SELECT id FROM grp_personal_krs)),
      'personal_period_reviews', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.personal_period_reviews x WHERE x.member_id IN (SELECT id FROM home_members)),
      'member_widget_layouts', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.member_widget_layouts x WHERE x.member_id IN (SELECT id FROM home_members)),
      'kr_sessions', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.kr_sessions x WHERE x.id IN (SELECT id FROM grp_kr_sessions)),
      'kr_meeting_notes', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.kr_meeting_notes x WHERE x.id IN (SELECT id FROM grp_kr_notes)),
      'okr_analyses', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.okr_analyses x WHERE x.kr_id IN (SELECT id FROM grp_krs) OR x.objective_id IN (SELECT id FROM grp_objectives)),
      'kr_reports', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.kr_reports x WHERE x.kr_id IN (SELECT id FROM grp_krs)),
      'kr_declarations', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.kr_declarations x WHERE x.session_id IN (SELECT id FROM grp_kr_sessions)),
      'kr_note_tf_entries', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.kr_note_tf_entries x WHERE x.note_id IN (SELECT id FROM grp_kr_notes)),
      'milestones', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.milestones x WHERE x.project_id IN (SELECT id FROM grp_projects)),
      'project_sections', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.project_sections x WHERE x.project_id IN (SELECT id FROM grp_projects)),
      'project_analyses', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.project_analyses x WHERE x.project_id IN (SELECT id FROM grp_projects)),
      'task_task_forces', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.task_task_forces x WHERE x.task_id IN (SELECT id FROM grp_tasks)),
      'task_projects', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.task_projects x WHERE x.task_id IN (SELECT id FROM grp_tasks)),
      'project_task_forces', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.project_task_forces x WHERE x.project_id IN (SELECT id FROM grp_projects)),
      'quarterly_kr_task_forces', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.quarterly_kr_task_forces x WHERE x.quarterly_objective_id IN (SELECT id FROM grp_quarterly_objectives)),
      'member_tag_members', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM public.member_tag_members x WHERE x.member_id IN (SELECT id FROM home_members))
    )
    INTO v_tables;
  END IF;

  -- 行数（0件のテーブルは載せない。§5の出力例と同じ体裁）
  SELECT coalesce(jsonb_object_agg(e.key, jsonb_array_length(e.value)), '{}'::jsonb)
  INTO v_row_counts
  FROM jsonb_each(v_tables) AS e(key, value)
  WHERE jsonb_array_length(e.value) > 0;

  -- tables部のハッシュ（転送後の照合用。§5）。PostgreSQL 14以降の組み込み関数を使う
  -- （pgcryptoのdigest()はSupabaseでは既定でextensionsスキーマに入り、
  -- SET search_path=''の下では明示スキーマ修飾が別途必要になるため避けた）。
  v_sha256 := encode(sha256(convert_to(v_tables::text, 'UTF8')), 'hex');

  v_result := jsonb_build_object(
    'meta', jsonb_strip_nulls(jsonb_build_object(
      'app_version', p_app_version,
      'taken_at', to_char(v_taken_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'scope', p_scope,
      'group_id', p_group_id,
      'table_count', (SELECT count(*) FROM jsonb_object_keys(v_tables)),
      'row_counts', v_row_counts,
      'sha256', v_sha256,
      'generator', 'backup_snapshot@1'
    )),
    'tables', v_tables
  );

  IF p_scope = 'full' THEN
    v_result := v_result || jsonb_build_object('schema', v_schema);
  END IF;

  IF p_scope = 'full' AND p_run_id IS NOT NULL THEN
    UPDATE public.backup_runs
    SET row_counts    = v_row_counts,
        orphan_counts = coalesce(v_orphan_counts, '{}'::jsonb)
    WHERE id = p_run_id;
  END IF;

  RETURN v_result;
END;
$fn_backup_snapshot$;

REVOKE ALL ON FUNCTION public.backup_snapshot(text, text, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.backup_snapshot(text, text, bigint, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.backup_snapshot(text, text, bigint, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.backup_snapshot(text, text, bigint, text) TO service_role;

COMMIT;

-- ============================================================
-- 確認クエリ（適用後に実行する。SQL Editor は最後の結果しか出ないため1本にまとめてある）
-- すべての行が OK ならよい。ROLLBACK で試す詳しい検証は docs/dev/verify_20261015_sections.sql。
-- ============================================================
SELECT item, CASE WHEN ok THEN 'OK' ELSE 'NG' END AS result FROM (
  SELECT 'table project_sections' AS item,
         EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'project_sections') AS ok
  UNION ALL SELECT 'column tasks.section_id',
         EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'section_id')
  UNION ALL SELECT 'column tasks.deliverable',
         EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'deliverable')
  UNION ALL SELECT 'triggers (tasks x2, project_sections x3)',
         (SELECT count(DISTINCT trigger_name) FROM information_schema.triggers
           WHERE trigger_schema = 'public'
             AND trigger_name IN ('trg_tasks_section_integrity', 'trg_tasks_section_cascade',
                                  'trg_project_sections_updated_at', 'trg_project_sections_keep_project',
                                  'trg_project_sections_release_tasks')) = 5
  UNION ALL SELECT 'policies = select/insert/update only (no delete, no old FOR ALL)',
         (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'project_sections') = 3
         AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'project_sections' AND cmd IN ('ALL', 'DELETE'))
  UNION ALL SELECT 'publication has project_sections',
         EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'project_sections')
  UNION ALL SELECT 'publication has in_app_notifications',
         EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'in_app_notifications')
  UNION ALL SELECT 'backup_snapshot includes project_sections',
         position('project_sections' IN pg_get_functiondef('public.backup_snapshot(text,text,bigint,text)'::regprocedure)) > 0
) x;
