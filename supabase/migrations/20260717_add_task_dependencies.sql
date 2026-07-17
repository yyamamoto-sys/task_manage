-- B1: タスク依存関係（先行→後続）＋完了ハードゲート／着手ソフト警告の土台
-- 適用方法: Supabase SQL Editor に全文貼って実行（冪等・何度実行してもOK）
--
-- 【背景】task_manage をPM特化ツールへ進化させる方針の一部（project_task_manage.md 参照）。
-- 依存ゲート（B1）→ ガント矢印可視化（B2）→ 自動リスケ連鎖（B3）→ ベースライン差分（B4）の
-- 段階リリースのうち、今回は B1（データモデル＋先行タスクピッカー＋完了ハードゲート＋
-- 着手ソフト警告）のみ。B2〜B4のテーブル・列（baseline_start/due等）は含まない。
--
-- 【このマイグレーションで追加するもの】
-- 1. task_dependencies テーブル（predecessor_task_id/successor_task_id/group_id/監査列）
-- 2. 自己依存禁止（CHECK制約）・同一ペア重複禁止（部分ユニークインデックス）
-- 3. RLS：tasks/projects/members と同じ group_id スコープ（NULL猶予条項は入れない。
--    このテーブルは group_id を NOT NULL にするため、そもそもNULLを許す余地がない）
-- 4. updated_at 自動更新トリガー
-- 5. Supabase Realtime の購読対象に追加（複数人が同じタスクを見ているとき、
--    誰かが先行タスクを設定したら他の人の画面にもリロードなしで反映されるように）
--
-- 循環防止（A→B→…→A を作らせない）はDB制約では表現しない（クライアント側の
-- lib/dependencies/cycleCheck.ts の DFS チェックで担保する。appStore.addTaskDependency が
-- 唯一の追加経路のためここで確実に効く）。

-- ============================================================
-- ブロック1: テーブル本体
-- ============================================================
CREATE TABLE IF NOT EXISTS task_dependencies (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  predecessor_task_id  text NOT NULL REFERENCES tasks(id),  -- 先に完了すべきタスク
  successor_task_id    text NOT NULL REFERENCES tasks(id),  -- それを待つタスク
  group_id             text NOT NULL REFERENCES groups(id), -- 新規テーブルのためNULL猶予なし
  is_deleted           boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           text NOT NULL DEFAULT '',
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           text NOT NULL DEFAULT '',
  deleted_at           timestamptz,
  deleted_by           text,
  CONSTRAINT task_dependencies_no_self_dep CHECK (predecessor_task_id <> successor_task_id)
);

COMMENT ON TABLE task_dependencies IS
  'タスク依存関係（先行→後続、FS依存1種のみ）。完了ハードゲート・着手ソフト警告・先行タスクピッカーで使用（B1）。';

-- ============================================================
-- ブロック2: インデックス（同一ペアの重複防止は論理削除を除外した部分ユニーク）
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS uq_task_dependencies_pair
  ON task_dependencies(predecessor_task_id, successor_task_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_task_dependencies_successor
  ON task_dependencies(successor_task_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_task_dependencies_predecessor
  ON task_dependencies(predecessor_task_id) WHERE is_deleted = false;

-- ============================================================
-- ブロック3: RLS（tasks/projects/membersと同じ group_id スコープ）
-- ============================================================
ALTER TABLE task_dependencies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated full access" ON task_dependencies;
DROP POLICY IF EXISTS "task_dependencies_group" ON task_dependencies;
CREATE POLICY "task_dependencies_group" ON task_dependencies FOR ALL TO authenticated
  USING (group_id = current_member_group_id() OR current_member_is_super_admin());

-- ============================================================
-- ブロック4: updated_at 自動更新トリガー
-- ============================================================
DROP TRIGGER IF EXISTS trg_task_dependencies_updated_at ON task_dependencies;
CREATE TRIGGER trg_task_dependencies_updated_at
  BEFORE UPDATE ON task_dependencies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- ブロック5: Realtime 購読対象に追加（20260518_realtime_publication.sql と同じ書き方）
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'task_dependencies'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.task_dependencies';
  END IF;
END $$;
