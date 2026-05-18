-- 2026-05-18: 主要9テーブルをRealtime購読対象に追加
--
-- 目的：複数人が同じ画面でタスク管理しているときに、誰かの変更が
--       他の人の画面にリロードなしで反映されるようにする。
--
-- 対象テーブル（日常業務の主要データ）：
--   - tasks / projects / todos
--   - task_task_forces / task_projects / project_task_forces  （中間テーブル）
--   - key_results / task_forces / milestones                  （OKR構造）
--   - members                                                 （担当者表示同期）
--
-- 含めないテーブル（意図的）：
--   - kr_sessions / kr_declarations / kr_meeting_notes / kr_note_tf_entries
--     okr_analyses / kr_reports / project_analyses
--     → AI生成・1人作成中心で realtime の利得が薄く、メッセージ量を抑える
--   - admin_change_logs / ai_usage_logs / member_tags / member_tag_members
--     → 通常運用での同時編集が少ない
--
-- 注意：この publication 操作は IF NOT EXISTS を直接サポートしないため、
--       DO ブロック内で「未登録のテーブルのみ追加」する。再実行安全。

DO $$
DECLARE
  t text;
  pub_tables text[] := ARRAY[
    'tasks', 'projects', 'todos',
    'task_task_forces', 'task_projects', 'project_task_forces',
    'key_results', 'task_forces', 'milestones',
    'members'
  ];
BEGIN
  FOREACH t IN ARRAY pub_tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
