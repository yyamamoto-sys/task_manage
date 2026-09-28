-- ============================================================
-- OKR周辺8テーブルの部署スコープ化（RLS第2弾・CLAUDE.md Section 9のG）
-- 2026-09-28 草案（冪等。何度でも再実行してよい）
--
-- 【前提】20260917c_block_anonymous_on_open_tables.sql（v3.112）適用済みの環境。
--   現状の8テーブルは (SELECT current_member_id()) IS NOT NULL ＝「登録済みなら全部署の
--   データを読み書きできる」。これを「親KR／Objectiveの部署にアクセスできる人だけ」に絞る。
--
-- 【部署の解決経路】（docs/dev/rls-phase2-investigation.md に根拠）
--   quarterly_objectives      自前の group_id
--   quarterly_kr_task_forces  quarterly_objective_id → quarterly_objectives.group_id
--   kr_sessions               kr_id → key_results.group_id
--   kr_declarations           session_id → kr_sessions.kr_id → key_results.group_id
--   kr_meeting_notes          kr_id → key_results.group_id
--   kr_note_tf_entries        note_id → kr_meeting_notes.kr_id → key_results.group_id
--   okr_analyses              scope='kr' は kr_id、scope='objective' は objective_id
--   kr_reports                kr_id → key_results.group_id
--   判定は key_results_group / objectives_group と同じ基準
--   （group_ids 兼務込み OR super_admin）。KRが見える人にはその周辺データも見える。
--
-- 【対象外】member_tags は部署を持たない全社共通マスタ（group_id 列も部署への経路も無い）。
--   20260917c の「登録済みのみ」ポリシーのまま残す。扱いは調査メモの論点A-2。
--   groups / loading_tips / ai_usage_logs も本ファイルでは触らない（論点B・C・D）。
--
-- 【Section 58 の教訓に従った書き方】
--   ① DROP は pg_policies から名前を問わず動的に（ネストした DO ブロックは使わない）
--   ② 1テーブル1ポリシー（PERMISSIVE は OR で緩い方が勝つ）
--   ③ Section 39：関数は (SELECT ...) で包む。単数列は = ANY((SELECT ...)) ではなく @>
--
-- 【適用方法】Supabase SQL Editor に全文を貼って実行する（dev → prod の順）。
--   適用前後に docs/dev/rls-phase2-investigation.md の検証SQLを実行する。
-- ============================================================

BEGIN;

-- ============================================================
-- ブロック1/4：親を辿って部署を返すヘルパー関数
--
-- ポリシー内から親テーブルを直接 SELECT すると親側のRLSが入れ子で評価されるため、
-- project_group_ids() 等と同じく SECURITY DEFINER で親の group_id を引く。
-- 主キー1件参照の STABLE 関数。行ごとに呼ばれる（行と相関するため InitPlan 化はできない）。
-- ============================================================

CREATE OR REPLACE FUNCTION public.kr_group_id(p_kr_id text)
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE SET search_path = ''
AS $fn_kr_group_id$
  SELECT group_id FROM public.key_results WHERE id = p_kr_id
$fn_kr_group_id$;

CREATE OR REPLACE FUNCTION public.objective_group_id(p_objective_id text)
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE SET search_path = ''
AS $fn_objective_group_id$
  SELECT group_id FROM public.objectives WHERE id = p_objective_id
$fn_objective_group_id$;

CREATE OR REPLACE FUNCTION public.quarterly_objective_group_id(p_quarterly_objective_id text)
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE SET search_path = ''
AS $fn_quarterly_objective_group_id$
  SELECT group_id FROM public.quarterly_objectives WHERE id = p_quarterly_objective_id
$fn_quarterly_objective_group_id$;

CREATE OR REPLACE FUNCTION public.kr_session_group_id(p_session_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE SET search_path = ''
AS $fn_kr_session_group_id$
  SELECT kr.group_id
    FROM public.kr_sessions s
    JOIN public.key_results kr ON kr.id = s.kr_id
   WHERE s.id = p_session_id
$fn_kr_session_group_id$;

CREATE OR REPLACE FUNCTION public.kr_note_group_id(p_note_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE SET search_path = ''
AS $fn_kr_note_group_id$
  SELECT kr.group_id
    FROM public.kr_meeting_notes n
    JOIN public.key_results kr ON kr.id = n.kr_id
   WHERE n.id = p_note_id
$fn_kr_note_group_id$;

REVOKE ALL ON FUNCTION public.kr_group_id(text)                  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.objective_group_id(text)           FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.quarterly_objective_group_id(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.kr_session_group_id(uuid)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.kr_note_group_id(uuid)             FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kr_group_id(text)                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.objective_group_id(text)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.quarterly_objective_group_id(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kr_session_group_id(uuid)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.kr_note_group_id(uuid)             TO authenticated;


-- ============================================================
-- ブロック2/4：8テーブルの既存ポリシーを名前を問わず全部落とす
--
-- 🔴 名前決め打ちにしない（v3.112 rev2 の失敗）。ネストしない（rev3 の失敗）。
-- 🔴 member_tags はここに入れない（落とすと 20260917c のポリシーごと消えて全拒否になる）。
-- ============================================================

DO $drop_okr_peripheral_policies$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT tablename, policyname
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN (
         'quarterly_objectives', 'quarterly_kr_task_forces',
         'kr_sessions', 'kr_declarations',
         'kr_meeting_notes', 'kr_note_tf_entries', 'okr_analyses', 'kr_reports'
       )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', r.policyname, r.tablename);
  END LOOP;
END
$drop_okr_peripheral_policies$;


-- ============================================================
-- ブロック3/4：部署スコープのポリシーを1テーブル1本ずつ作る
--
-- 形は entity_change_logs（Section 39 但し書き）と同じ：
--   (SELECT current_member_group_ids()) @> ARRAY[<行の部署>] OR (SELECT current_member_is_super_admin())
-- ヘルパーが NULL（親が見つからない孤児行）を返すと ARRAY[NULL] になり、@> は偽になる
-- （NULL要素はどの配列にも含まれない）。孤児行は super_admin だけが見られる。
-- 匿名・未登録は current_member_group_ids() も is_super_admin() も NULL → 拒否。
-- ============================================================

CREATE POLICY "quarterly_objectives_group" ON public.quarterly_objectives
  FOR ALL TO authenticated
  USING (
    (group_id IS NOT NULL AND (SELECT public.current_member_group_ids()) @> ARRAY[group_id])
    OR (SELECT public.current_member_is_super_admin())
  )
  WITH CHECK (
    (group_id IS NOT NULL AND (SELECT public.current_member_group_ids()) @> ARRAY[group_id])
    OR (SELECT public.current_member_is_super_admin())
  );

CREATE POLICY "quarterly_kr_task_forces_group" ON public.quarterly_kr_task_forces
  FOR ALL TO authenticated
  USING (
    (SELECT public.current_member_group_ids()) @> ARRAY[public.quarterly_objective_group_id(quarterly_objective_id)]
    OR (SELECT public.current_member_is_super_admin())
  )
  WITH CHECK (
    (SELECT public.current_member_group_ids()) @> ARRAY[public.quarterly_objective_group_id(quarterly_objective_id)]
    OR (SELECT public.current_member_is_super_admin())
  );

CREATE POLICY "kr_sessions_group" ON public.kr_sessions
  FOR ALL TO authenticated
  USING (
    (SELECT public.current_member_group_ids()) @> ARRAY[public.kr_group_id(kr_id)]
    OR (SELECT public.current_member_is_super_admin())
  )
  WITH CHECK (
    (SELECT public.current_member_group_ids()) @> ARRAY[public.kr_group_id(kr_id)]
    OR (SELECT public.current_member_is_super_admin())
  );

CREATE POLICY "kr_declarations_group" ON public.kr_declarations
  FOR ALL TO authenticated
  USING (
    (SELECT public.current_member_group_ids()) @> ARRAY[public.kr_session_group_id(session_id)]
    OR (SELECT public.current_member_is_super_admin())
  )
  WITH CHECK (
    (SELECT public.current_member_group_ids()) @> ARRAY[public.kr_session_group_id(session_id)]
    OR (SELECT public.current_member_is_super_admin())
  );

CREATE POLICY "kr_meeting_notes_group" ON public.kr_meeting_notes
  FOR ALL TO authenticated
  USING (
    (SELECT public.current_member_group_ids()) @> ARRAY[public.kr_group_id(kr_id)]
    OR (SELECT public.current_member_is_super_admin())
  )
  WITH CHECK (
    (SELECT public.current_member_group_ids()) @> ARRAY[public.kr_group_id(kr_id)]
    OR (SELECT public.current_member_is_super_admin())
  );

CREATE POLICY "kr_note_tf_entries_group" ON public.kr_note_tf_entries
  FOR ALL TO authenticated
  USING (
    (SELECT public.current_member_group_ids()) @> ARRAY[public.kr_note_group_id(note_id)]
    OR (SELECT public.current_member_is_super_admin())
  )
  WITH CHECK (
    (SELECT public.current_member_group_ids()) @> ARRAY[public.kr_note_group_id(note_id)]
    OR (SELECT public.current_member_is_super_admin())
  );

-- okr_analyses_scope_target_check により kr_id と objective_id はちょうど一方だけが入る
CREATE POLICY "okr_analyses_group" ON public.okr_analyses
  FOR ALL TO authenticated
  USING (
    (SELECT public.current_member_group_ids())
      @> ARRAY[coalesce(public.kr_group_id(kr_id), public.objective_group_id(objective_id))]
    OR (SELECT public.current_member_is_super_admin())
  )
  WITH CHECK (
    (SELECT public.current_member_group_ids())
      @> ARRAY[coalesce(public.kr_group_id(kr_id), public.objective_group_id(objective_id))]
    OR (SELECT public.current_member_is_super_admin())
  );

CREATE POLICY "kr_reports_group" ON public.kr_reports
  FOR ALL TO authenticated
  USING (
    (SELECT public.current_member_group_ids()) @> ARRAY[public.kr_group_id(kr_id)]
    OR (SELECT public.current_member_is_super_admin())
  )
  WITH CHECK (
    (SELECT public.current_member_group_ids()) @> ARRAY[public.kr_group_id(kr_id)]
    OR (SELECT public.current_member_is_super_admin())
  );


-- ============================================================
-- ブロック4/4：RLSが有効であることの再確認（既に有効なら no-op）
-- ============================================================

ALTER TABLE public.quarterly_objectives     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quarterly_kr_task_forces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kr_sessions              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kr_declarations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kr_meeting_notes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kr_note_tf_entries       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.okr_analyses             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kr_reports               ENABLE ROW LEVEL SECURITY;

COMMIT;
