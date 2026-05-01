-- ============================================================
-- マイグレーション: 主要 FK・フィルタカラムへのインデックス追加
-- 実行日: 2026-05-01
-- Supabase SQL Editor で順に実行してください（再実行可・冪等）
-- ============================================================
--
-- 【背景】
-- Postgres は PRIMARY KEY と UNIQUE 制約以外を自動で索引化しない。
-- スキーマ作成時から FK・フィルタカラムに索引が無く、データ増加に伴って
-- 順次クエリ性能が劣化する設計負債だった。本マイグレーションで解消する。
--
-- 【方針】
-- - `is_deleted = false` を高頻度で絞るため部分インデックス（partial index）を採用
-- - junction テーブルは複合 PK の左端以外も検索するため逆方向索引を追加
-- - 追加対象は実クエリで実際に WHERE / JOIN に使われるカラムのみ
-- ============================================================

-- ===== tasks =====
CREATE INDEX IF NOT EXISTS idx_tasks_project_id
  ON tasks(project_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_tasks_todo_id
  ON tasks(todo_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_tasks_assignee_member_id
  ON tasks(assignee_member_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_tasks_due_date
  ON tasks(due_date) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_tasks_start_date
  ON tasks(start_date) WHERE is_deleted = false;

-- ===== task_forces =====
CREATE INDEX IF NOT EXISTS idx_task_forces_kr_id
  ON task_forces(kr_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_task_forces_leader_member_id
  ON task_forces(leader_member_id) WHERE is_deleted = false;

-- ===== key_results =====
CREATE INDEX IF NOT EXISTS idx_key_results_objective_id
  ON key_results(objective_id) WHERE is_deleted = false;

-- ===== todos =====
CREATE INDEX IF NOT EXISTS idx_todos_tf_id
  ON todos(tf_id) WHERE is_deleted = false;

-- ===== projects =====
CREATE INDEX IF NOT EXISTS idx_projects_owner_member_id
  ON projects(owner_member_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_projects_status
  ON projects(status) WHERE is_deleted = false;

-- ===== quarterly_objectives =====
CREATE INDEX IF NOT EXISTS idx_quarterly_objectives_objective_id
  ON quarterly_objectives(objective_id) WHERE is_deleted = false;

-- ===== junction: 逆方向索引 =====
-- task_task_forces PK = (task_id, tf_id) → tf_id 単独検索向け
CREATE INDEX IF NOT EXISTS idx_task_task_forces_tf_id
  ON task_task_forces(tf_id);
-- task_projects PK = (task_id, project_id) → project_id 単独検索向け
CREATE INDEX IF NOT EXISTS idx_task_projects_project_id
  ON task_projects(project_id);
-- project_task_forces PK = (project_id, tf_id) → tf_id 単独検索向け
CREATE INDEX IF NOT EXISTS idx_project_task_forces_tf_id
  ON project_task_forces(tf_id);
-- quarterly_kr_task_forces は kr_id・tf_id 両方で検索される
CREATE INDEX IF NOT EXISTS idx_quarterly_kr_task_forces_kr_id
  ON quarterly_kr_task_forces(kr_id);
CREATE INDEX IF NOT EXISTS idx_quarterly_kr_task_forces_tf_id
  ON quarterly_kr_task_forces(tf_id);
CREATE INDEX IF NOT EXISTS idx_quarterly_kr_task_forces_qobj_id
  ON quarterly_kr_task_forces(quarterly_objective_id);

-- ===== admin_change_logs =====
-- 14日経過削除（pg_cron）と UI からの履歴閲覧で使う
CREATE INDEX IF NOT EXISTS idx_admin_change_logs_performed_at
  ON admin_change_logs(performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_change_logs_target_id
  ON admin_change_logs(target_id);

-- ===== kr_sessions / kr_declarations =====
-- fetchKrSessions: kr_id で絞って week_start DESC で並べる
-- fetchLatestCheckinSession: kr_id + session_type + week_start DESC LIMIT 1
CREATE INDEX IF NOT EXISTS idx_kr_sessions_kr_id_week_start
  ON kr_sessions(kr_id, week_start DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_kr_declarations_session_id
  ON kr_declarations(session_id) WHERE is_deleted = false;

-- ===== milestones =====
CREATE INDEX IF NOT EXISTS idx_milestones_project_id
  ON milestones(project_id) WHERE is_deleted = false;

-- ===== ai_usage_logs =====
-- 一覧表示で called_at DESC 順に並べる
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_called_at
  ON ai_usage_logs(called_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_member_id
  ON ai_usage_logs(member_id);
