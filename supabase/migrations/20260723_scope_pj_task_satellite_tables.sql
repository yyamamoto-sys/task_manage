-- PJ・タスク周辺テーブルのRLS部署分離
-- 適用方法: Supabase SQL Editor に全文を一括で貼って実行する
--   （分割せず一括で。失敗時はトランザクションごと巻き戻る）
--
-- 【背景】
-- 2026-07-22、マルチテナンシーが導入以来まったく実効していなかったことが発覚し、
-- members / projects / tasks の全公開ポリシーを削除した
-- （20260722c_drop_legacy_full_access_policies.sql）。
-- その後、本番の pg_policies を全件監査したところ、PJ・タスク周辺の
-- 「子テーブル」にも全公開ポリシー（USING (true) や
-- auth.role() = 'authenticated'）が残っていることが判明した。
-- これらは group_id 列を持たないため、親（projects / tasks / members）を
-- 辿って部署を判定するポリシーに書き換える。
--
-- 【対象】
--   milestones          -> project_id で projects を辿る
--   project_analyses    -> project_id で projects を辿る
--   project_task_forces -> project_id で projects を辿る
--   task_projects       -> task_id    で tasks を辿る
--   task_task_forces    -> task_id    で tasks を辿る
--   member_tag_members  -> member_id  で members を辿る
--   admin_change_logs   -> performed_by(メンバーid) で members を辿る
--   ai_usage_logs       -> member_id  で members を辿る（selectのみ）
--
-- 【スコープ外＝今回は触らない】
--   OKR系(objectives/key_results/task_forces/todos/kr_*/okr_analyses/
--     quarterly_*)：OKRモードは全面刷新予定のため刷新時にまとめて対応する
--   member_tags 本体：タグはstatic等の全社共通マスタで部署概念が無いため
--     閲覧は全員可のまま維持する（誰にタグが付いているか＝member_tag_members
--     の方は今回 members を辿って絞る）
--   groups の groups_select(true)：意図的（部署一覧は全員参照可）
--
-- 【設計方針】
-- ポリシーのUSING内から親テーブルを直接SELECTすると親テーブルのRLSも
-- 適用されて評価が複雑になる。そこで SECURITY DEFINER のヘルパー関数を
-- 1つ用意し、そこで「その部署集合が自分のアクセス可能部署と重なるか、
-- または自分がsuper_adminか」を一元判定する。親テーブルの group_ids を
-- 関数内で参照するときは RLS を迂回する（SECURITY DEFINER）。

-- ============================================================
-- ブロック1: ヘルパー関数
--   group_ids(text[]) を1つ受け取り、
--   「その集合が自分のアクセス可能部署と重なる or 自分がsuper_admin」
--   を返す。子テーブルのポリシーはこの関数に親の group_ids を渡すだけ。
-- ============================================================
CREATE OR REPLACE FUNCTION public.can_access_group_ids(
  p_group_ids text[]
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $fn_can_access$
  SELECT
    coalesce(
      p_group_ids && public.current_member_group_ids(),
      false
    )
    OR public.current_member_is_super_admin()
$fn_can_access$;

GRANT EXECUTE ON FUNCTION public.can_access_group_ids(text[])
  TO authenticated;

-- ============================================================
-- ブロック2: 親の group_ids を id から引く SECURITY DEFINER 関数群
--   （RLSを迂回して親の部署集合を取得する。ポリシーからはこれを呼ぶ）
-- ============================================================

-- projects.group_ids を project_id から取得
CREATE OR REPLACE FUNCTION public.project_group_ids(
  p_project_id text
)
RETURNS text[]
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $fn_pj_gids$
  SELECT group_ids FROM public.projects
  WHERE id = p_project_id
$fn_pj_gids$;

GRANT EXECUTE ON FUNCTION public.project_group_ids(text)
  TO authenticated;

-- tasks.group_ids を task_id から取得
CREATE OR REPLACE FUNCTION public.task_group_ids(
  p_task_id text
)
RETURNS text[]
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $fn_task_gids$
  SELECT group_ids FROM public.tasks
  WHERE id = p_task_id
$fn_task_gids$;

GRANT EXECUTE ON FUNCTION public.task_group_ids(text)
  TO authenticated;

-- members.group_ids を member_id から取得
CREATE OR REPLACE FUNCTION public.member_group_ids(
  p_member_id text
)
RETURNS text[]
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $fn_mem_gids$
  SELECT group_ids FROM public.members
  WHERE id = p_member_id
$fn_mem_gids$;

GRANT EXECUTE ON FUNCTION public.member_group_ids(text)
  TO authenticated;

-- ============================================================
-- ブロック3: milestones（project_id で projects を辿る）
-- ============================================================
DROP POLICY IF EXISTS "authenticated_all" ON milestones;
DROP POLICY IF EXISTS "authenticated full access" ON milestones;

CREATE POLICY "milestones_group" ON milestones
  FOR ALL TO authenticated
  USING (
    public.can_access_group_ids(
      public.project_group_ids(project_id)
    )
  );

-- ============================================================
-- ブロック4: project_analyses（project_id で projects を辿る）
-- ============================================================
DROP POLICY IF EXISTS "authenticated full access" ON project_analyses;

CREATE POLICY "project_analyses_group" ON project_analyses
  FOR ALL TO authenticated
  USING (
    public.can_access_group_ids(
      public.project_group_ids(project_id)
    )
  );

-- ============================================================
-- ブロック5: project_task_forces（project_id で projects を辿る）
-- ============================================================
DROP POLICY IF EXISTS "authenticated full access" ON project_task_forces;

CREATE POLICY "project_task_forces_group" ON project_task_forces
  FOR ALL TO authenticated
  USING (
    public.can_access_group_ids(
      public.project_group_ids(project_id)
    )
  );

-- ============================================================
-- ブロック6: task_projects（task_id で tasks を辿る）
-- ============================================================
DROP POLICY IF EXISTS "authenticated full access" ON task_projects;

CREATE POLICY "task_projects_group" ON task_projects
  FOR ALL TO authenticated
  USING (
    public.can_access_group_ids(
      public.task_group_ids(task_id)
    )
  );

-- ============================================================
-- ブロック7: task_task_forces（task_id で tasks を辿る）
-- ============================================================
DROP POLICY IF EXISTS "authenticated full access" ON task_task_forces;

CREATE POLICY "task_task_forces_group" ON task_task_forces
  FOR ALL TO authenticated
  USING (
    public.can_access_group_ids(
      public.task_group_ids(task_id)
    )
  );

-- ============================================================
-- ブロック8: member_tag_members（member_id で members を辿る）
--   タグ本体(member_tags)は全社共通マスタのまま。誰に付いているかは絞る。
-- ============================================================
DROP POLICY IF EXISTS "authenticated full access" ON member_tag_members;

CREATE POLICY "member_tag_members_group" ON member_tag_members
  FOR ALL TO authenticated
  USING (
    public.can_access_group_ids(
      public.member_group_ids(member_id)
    )
  );

-- ============================================================
-- ブロック9: admin_change_logs（performed_by=メンバーid で辿る）
--   変更履歴。実行者のホーム部署で絞る。super_adminは全件。
-- ============================================================
DROP POLICY IF EXISTS "authenticated full access" ON admin_change_logs;

CREATE POLICY "admin_change_logs_group" ON admin_change_logs
  FOR ALL TO authenticated
  USING (
    public.can_access_group_ids(
      public.member_group_ids(performed_by)
    )
  );

-- ============================================================
-- ブロック10: ai_usage_logs（member_id で辿る・selectのみ書き換え）
--   INSERT用の "authenticated users can insert" はそのまま残す
--   （自分の使用量を記録する経路。with_check側で別途担保）。
-- ============================================================
DROP POLICY IF EXISTS "authenticated users can select"
  ON ai_usage_logs;

CREATE POLICY "ai_usage_logs_select_group" ON ai_usage_logs
  FOR SELECT TO authenticated
  USING (
    public.can_access_group_ids(
      public.member_group_ids(member_id)
    )
  );
