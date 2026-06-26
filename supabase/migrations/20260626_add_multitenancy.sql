-- マルチテナント対応マイグレーション
-- 適用方法: Supabase SQL Editor に全文貼って実行
-- 既存データはすべて 'grp-egg' グループに移行される

-- ===== groups テーブル =====
CREATE TABLE IF NOT EXISTS groups (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  is_deleted boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  deleted_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL DEFAULT ''
);

ALTER TABLE groups ENABLE ROW LEVEL SECURITY;

-- グループ名は全認証ユーザーが参照できる（所属確認のため）
DROP POLICY IF EXISTS "groups_auth" ON groups;
CREATE POLICY "groups_auth" ON groups FOR ALL TO authenticated USING (true);

-- デフォルトグループ EGG を作成
INSERT INTO groups (id, name, updated_by)
VALUES ('grp-egg', 'EGG', 'system')
ON CONFLICT (id) DO NOTHING;

-- ===== members に group_id 追加 =====
ALTER TABLE members ADD COLUMN IF NOT EXISTS group_id text REFERENCES groups(id);
UPDATE members SET group_id = 'grp-egg' WHERE group_id IS NULL;

-- ===== projects に group_id 追加 =====
ALTER TABLE projects ADD COLUMN IF NOT EXISTS group_id text REFERENCES groups(id);
UPDATE projects SET group_id = 'grp-egg' WHERE group_id IS NULL;

-- ===== tasks に group_id 追加 =====
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS group_id text REFERENCES groups(id);
UPDATE tasks SET group_id = 'grp-egg' WHERE group_id IS NULL;

-- ===== RLS ヘルパー関数 =====
-- SECURITY DEFINER で members テーブルの RLS を迂回して自分の group_id を取得する
CREATE OR REPLACE FUNCTION current_member_group_id()
RETURNS text
LANGUAGE sql
SECURITY DEFINER STABLE
AS $$
  SELECT group_id FROM members
  WHERE email = auth.email()
    AND is_deleted = false
  LIMIT 1
$$;

-- ===== members RLS 更新 =====
DROP POLICY IF EXISTS "authenticated_all" ON members;
CREATE POLICY "members_group" ON members FOR ALL TO authenticated
  USING (
    group_id = current_member_group_id()
    OR current_member_group_id() IS NULL
  );

-- ===== projects RLS 更新 =====
DROP POLICY IF EXISTS "authenticated_all" ON projects;
CREATE POLICY "projects_group" ON projects FOR ALL TO authenticated
  USING (
    group_id = current_member_group_id()
    OR current_member_group_id() IS NULL
  );

-- ===== tasks RLS 更新 =====
DROP POLICY IF EXISTS "authenticated_all" ON tasks;
CREATE POLICY "tasks_group" ON tasks FOR ALL TO authenticated
  USING (
    group_id = current_member_group_id()
    OR current_member_group_id() IS NULL
  );
