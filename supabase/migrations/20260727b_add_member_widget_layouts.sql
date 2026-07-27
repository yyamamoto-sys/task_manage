-- ============================================================
-- マイページ（ウィジェット）レイアウトの永続化（member_widget_layouts）
-- 2026-07-27
--
-- 【目的】
-- ラボ機能「マイページ」で、各メンバーが自分専用に並べたウィジェット配置を
-- 端末をまたいで保持する（PCブラウザとTeams埋め込みの両方で使うため。
-- localStorageだけだと端末・ブラウザごとに別物になってしまう）。
--
-- 【設計方針】
-- ・個人所有データ（member_id が主キー）。所有者本人しかアクセスしないため
--   group_id（部署スコープ）は持たせない（docs/dev/mypage-widgets-design.md §3）。
-- ・current_member_group_id() 等と同じ流儀で current_member_id()
--   （auth.email() から自分の member id を返す SECURITY DEFINER 関数）を新設する。
-- ・RLS は member_id = current_member_id() のみ。NULL猶予条項は入れない
--   （20260702b の教訓＝current_member_id() がNULL（未登録ユーザー等）なら
--   何も見えないのが正しい挙動。OR ... IS NULL のような抜け穴を作らない）。
--
-- 【適用】Supabase SQL Editor に全文を貼って実行（dev → prod の順）。
-- ============================================================

-- ============================================================
-- ヘルパー関数：current_member_id()
-- current_member_group_id() 等（schema.sql）と完全に同じ流儀。
-- ============================================================
CREATE OR REPLACE FUNCTION current_member_id()
RETURNS text
LANGUAGE sql
SECURITY DEFINER STABLE
SET search_path = ''
AS $fn_member_id$
  SELECT id FROM public.members
  WHERE email = auth.email()
    AND is_deleted = false
  LIMIT 1
$fn_member_id$;

-- ============================================================
-- テーブル：member_widget_layouts
-- ============================================================
CREATE TABLE IF NOT EXISTS member_widget_layouts (
  member_id   text PRIMARY KEY REFERENCES members(id),
  layout      jsonb NOT NULL DEFAULT '{"version":1,"widgets":[]}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text NOT NULL DEFAULT ''
);

-- updated_at トリガー（schema.sql の他テーブルと同じ流儀）
DROP TRIGGER IF EXISTS trg_member_widget_layouts_updated_at ON member_widget_layouts;
CREATE TRIGGER trg_member_widget_layouts_updated_at
  BEFORE UPDATE ON member_widget_layouts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- RLS：本人（member_id = current_member_id()）のみ読み書き可
-- ============================================================
ALTER TABLE member_widget_layouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated full access" ON member_widget_layouts;
DROP POLICY IF EXISTS "member_widget_layouts_own" ON member_widget_layouts;

CREATE POLICY "member_widget_layouts_own" ON member_widget_layouts
  FOR ALL TO authenticated
  USING (member_id = current_member_id())
  WITH CHECK (member_id = current_member_id());

-- ============================================================
-- 適用後の確認クエリ（任意）
-- ============================================================
-- 1) ヘルパー関数が自分の member id を返すか（ログイン中のユーザーで実行）
-- SELECT current_member_id();
--
-- 2) テーブル・トリガー・RLSが期待どおり作成されたか
-- SELECT count(*) FROM member_widget_layouts;
-- SELECT polname, polcmd FROM pg_policy WHERE polrelid = 'member_widget_layouts'::regclass;
--
-- 3) 緩いポリシーが残っていないか（0件であること）
-- SELECT polname FROM pg_policy WHERE polrelid = 'member_widget_layouts'::regclass AND polname = 'authenticated full access';
