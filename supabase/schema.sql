-- ============================================================
-- グループ計画管理アプリ スキーマ定義（統合版）
-- 最終更新: 2026-05-01
-- Supabase SQL エディタで上から順に実行してください
-- ============================================================
--
-- 【統合内容】
-- 旧スキーマ + supabase/migrations/* の全マイグレーション + CLAUDE.md
-- 記載のテーブル定義（milestones）+ 実コードから推定したテーブル
-- (ai_usage_logs / kr_sessions / kr_declarations）を統合した完全版。
--
-- 既存環境で再適用しても安全（IF NOT EXISTS 多用）。
-- 新規環境ではこのファイル一発で初期化できる。
-- ============================================================

-- ===== updated_at 自動更新トリガー（先に定義） =====

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ===== メンバーマスタ =====
CREATE TABLE IF NOT EXISTS members (
  id            text PRIMARY KEY,
  display_name  text NOT NULL,
  short_name    text NOT NULL,
  initials      text NOT NULL,
  teams_account text NOT NULL DEFAULT '',
  color_bg      text NOT NULL,
  color_text    text NOT NULL,
  is_deleted    boolean NOT NULL DEFAULT false,
  deleted_at    timestamptz,
  deleted_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text NOT NULL DEFAULT ''
);

-- ===== Objective（年間） =====
CREATE TABLE IF NOT EXISTS objectives (
  id          text PRIMARY KEY,
  title       text NOT NULL,
  period      text NOT NULL,
  purpose     text,
  background  text,
  is_current  boolean NOT NULL DEFAULT true,
  archived_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text NOT NULL DEFAULT ''
);

-- ===== Key Results（年間・通年固定） =====
CREATE TABLE IF NOT EXISTS key_results (
  id           text PRIMARY KEY,
  objective_id text NOT NULL REFERENCES objectives(id),
  title        text NOT NULL,
  is_deleted   boolean NOT NULL DEFAULT false,
  deleted_at   timestamptz,
  deleted_by   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   text NOT NULL DEFAULT ''
);

-- ===== Quarterly Objectives =====
CREATE TABLE IF NOT EXISTS quarterly_objectives (
  id           text PRIMARY KEY,
  objective_id text NOT NULL REFERENCES objectives(id),
  quarter      text NOT NULL CHECK (quarter IN ('1Q','2Q','3Q','4Q')),
  title        text NOT NULL,
  purpose      text,
  background   text,
  is_deleted   boolean NOT NULL DEFAULT false,
  deleted_at   timestamptz,
  deleted_by   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   text NOT NULL DEFAULT ''
);

-- ===== Task Forces =====
CREATE TABLE IF NOT EXISTS task_forces (
  id               text PRIMARY KEY,
  kr_id            text NOT NULL REFERENCES key_results(id),
  tf_number        text NOT NULL DEFAULT '',
  name             text NOT NULL,
  description      text,
  background       text,
  leader_member_id text REFERENCES members(id),
  is_deleted       boolean NOT NULL DEFAULT false,
  deleted_at       timestamptz,
  deleted_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       text NOT NULL DEFAULT ''
);

-- ===== Quarterly KR ↔ Task Force（多対多） =====
-- 通期 KR と TF を四半期ごとに紐づける
CREATE TABLE IF NOT EXISTS quarterly_kr_task_forces (
  quarterly_objective_id text NOT NULL REFERENCES quarterly_objectives(id),
  kr_id                  text NOT NULL REFERENCES key_results(id),
  tf_id                  text NOT NULL REFERENCES task_forces(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (quarterly_objective_id, kr_id, tf_id)
);

-- ===== ToDos（TF達成のための大タスク） =====
CREATE TABLE IF NOT EXISTS todos (
  id         text PRIMARY KEY,
  tf_id      text NOT NULL REFERENCES task_forces(id),
  title      text NOT NULL,
  due_date   date,
  memo       text NOT NULL DEFAULT '',
  is_deleted boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  deleted_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL DEFAULT ''
);

-- ===== Projects =====
CREATE TABLE IF NOT EXISTS projects (
  id                text PRIMARY KEY,
  name              text NOT NULL,
  purpose           text NOT NULL DEFAULT '',
  contribution_memo text NOT NULL DEFAULT '',
  owner_member_id   text REFERENCES members(id),       -- 互換目的の単数 FK
  owner_member_ids  text[] NOT NULL DEFAULT '{}',      -- 複数オーナー対応
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','archived')),
  color_tag         text NOT NULL DEFAULT '#7F77DD',
  start_date        date,
  end_date          date,
  is_deleted        boolean NOT NULL DEFAULT false,
  deleted_at        timestamptz,
  deleted_by        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        text NOT NULL DEFAULT ''
);

-- ===== Project ↔ TaskForce（多対多） =====
CREATE TABLE IF NOT EXISTS project_task_forces (
  project_id text NOT NULL REFERENCES projects(id),
  tf_id      text NOT NULL REFERENCES task_forces(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, tf_id)
);

-- ===== Tasks =====
CREATE TABLE IF NOT EXISTS tasks (
  id                  text PRIMARY KEY,
  name                text NOT NULL,
  project_id          text REFERENCES projects(id),    -- Project への紐づき（任意）
  todo_id             text REFERENCES todos(id),       -- ToDo への紐づき（任意・単数互換）
  assignee_member_id  text REFERENCES members(id),     -- 互換目的の単数 FK
  assignee_member_ids text[] NOT NULL DEFAULT '{}',    -- 複数担当者対応
  status              text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','done')),
  priority            text CHECK (priority IN ('high','mid','low')),
  start_date          date,
  due_date            date,
  estimated_hours     numeric,
  comment             text NOT NULL DEFAULT '',
  is_deleted          boolean NOT NULL DEFAULT false,
  deleted_at          timestamptz,
  deleted_by          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          text NOT NULL DEFAULT ''
);

-- ===== Task ↔ TaskForce（多対多） =====
CREATE TABLE IF NOT EXISTS task_task_forces (
  task_id    text NOT NULL REFERENCES tasks(id),
  tf_id      text NOT NULL REFERENCES task_forces(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, tf_id)
);

-- ===== Task ↔ 追加 Project（多対多） =====
CREATE TABLE IF NOT EXISTS task_projects (
  task_id    text NOT NULL REFERENCES tasks(id),
  project_id text NOT NULL REFERENCES projects(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, project_id)
);

-- ===== Milestones（PJ に紐づく期日マーカー） =====
-- 注: project_id は projects.id と型を合わせるため text にする
-- （CLAUDE.md の旧 DDL は uuid だったが projects.id が text のため整合性なし）
CREATE TABLE IF NOT EXISTS milestones (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  text NOT NULL REFERENCES projects(id),
  name        text NOT NULL,
  date        date NOT NULL,
  is_deleted  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text,
  deleted_at  timestamptz,
  deleted_by  text
);

-- ===== 変更履歴 =====
CREATE TABLE IF NOT EXISTS admin_change_logs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  layer                text NOT NULL CHECK (layer IN ('objective','kr','tf','project','member')),
  action               text NOT NULL CHECK (action IN ('create','update','delete','restore','period_switch')),
  target_id            text NOT NULL,
  target_name          text NOT NULL,
  diff                 jsonb NOT NULL DEFAULT '{}',
  performed_by         text NOT NULL,
  performed_at         timestamptz NOT NULL DEFAULT now(),
  is_conflict_override boolean NOT NULL DEFAULT false
);
-- 14日経過削除は migrations/20260501_admin_logs_cleanup.sql で pg_cron 自動化

-- ===== AI 使用量ログ =====
CREATE TABLE IF NOT EXISTS ai_usage_logs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  called_at         timestamptz NOT NULL DEFAULT now(),
  member_id         text NOT NULL,
  consultation_type text NOT NULL,
  input_tokens      integer NOT NULL DEFAULT 0,
  output_tokens     integer NOT NULL DEFAULT 0
);

-- ===== KR セッション記録（ラボ機能） =====
CREATE TABLE IF NOT EXISTS kr_sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kr_id             text NOT NULL REFERENCES key_results(id),
  week_start        date NOT NULL,                    -- 月曜日
  session_type      text NOT NULL CHECK (session_type IN ('checkin','win_session')),
  signal            text CHECK (signal IN ('green','yellow','red')),
  signal_comment    text NOT NULL DEFAULT '',
  learnings         text NOT NULL DEFAULT '',
  external_changes  text NOT NULL DEFAULT '',
  transcript        text NOT NULL DEFAULT '',
  created_by        text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        text NOT NULL DEFAULT '',
  is_deleted        boolean NOT NULL DEFAULT false
);

-- ===== KR セッション宣言 =====
CREATE TABLE IF NOT EXISTS kr_declarations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    uuid NOT NULL REFERENCES kr_sessions(id),
  member_id     text NOT NULL,
  content       text NOT NULL DEFAULT '',
  due_date      date,
  result_status text CHECK (result_status IN ('achieved','partial','not_achieved')),
  result_note   text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text NOT NULL DEFAULT '',
  is_deleted    boolean NOT NULL DEFAULT false
);

-- ============================================================
-- updated_at トリガー（テーブル定義後に作成）
-- ============================================================

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN VALUES
    ('members'), ('objectives'), ('key_results'), ('task_forces'),
    ('todos'), ('projects'), ('tasks'),
    ('quarterly_objectives'),
    ('milestones'), ('kr_sessions'), ('kr_declarations')
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%1$s_updated_at ON %1$s;
       CREATE TRIGGER trg_%1$s_updated_at
         BEFORE UPDATE ON %1$s
         FOR EACH ROW EXECUTE FUNCTION update_updated_at();', t);
  END LOOP;
END $$;

-- ============================================================
-- RLS（行レベルセキュリティ）
-- 全テーブルで有効化し、authenticated ロールのみフルアクセス可能
-- 10名規模・全員フラットな権限設計（CLAUDE.md 設計原則）
-- ============================================================

ALTER TABLE members                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE objectives                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE key_results                ENABLE ROW LEVEL SECURITY;
ALTER TABLE quarterly_objectives       ENABLE ROW LEVEL SECURITY;
ALTER TABLE quarterly_kr_task_forces   ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_task_forces           ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_projects              ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_forces                ENABLE ROW LEVEL SECURITY;
ALTER TABLE todos                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_task_forces        ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE milestones                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_change_logs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage_logs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE kr_sessions                ENABLE ROW LEVEL SECURITY;
ALTER TABLE kr_declarations            ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN VALUES
    ('members'), ('objectives'), ('key_results'),
    ('quarterly_objectives'), ('quarterly_kr_task_forces'),
    ('task_task_forces'), ('task_projects'),
    ('task_forces'), ('todos'), ('projects'), ('project_task_forces'),
    ('tasks'), ('milestones'), ('admin_change_logs'),
    ('ai_usage_logs'), ('kr_sessions'), ('kr_declarations')
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS "authenticated full access" ON %1$s;
       CREATE POLICY "authenticated full access" ON %1$s
         FOR ALL TO authenticated USING (true) WITH CHECK (true);', t);
  END LOOP;
END $$;

-- ============================================================
-- インデックス
-- 詳細は migrations/20260501_add_indexes.sql 参照
-- ここでは新環境構築時に最低限必要なものを再掲する
-- ============================================================

-- tasks
CREATE INDEX IF NOT EXISTS idx_tasks_project_id          ON tasks(project_id)         WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_tasks_todo_id             ON tasks(todo_id)            WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_tasks_assignee_member_id  ON tasks(assignee_member_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_tasks_due_date            ON tasks(due_date)           WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_tasks_start_date          ON tasks(start_date)         WHERE is_deleted = false;

-- task_forces / key_results / todos / projects
CREATE INDEX IF NOT EXISTS idx_task_forces_kr_id              ON task_forces(kr_id)              WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_task_forces_leader_member_id   ON task_forces(leader_member_id)   WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_key_results_objective_id       ON key_results(objective_id)       WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_todos_tf_id                    ON todos(tf_id)                    WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_projects_owner_member_id       ON projects(owner_member_id)       WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_projects_status                ON projects(status)                WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_quarterly_objectives_objective_id ON quarterly_objectives(objective_id) WHERE is_deleted = false;

-- junction reverse-direction
CREATE INDEX IF NOT EXISTS idx_task_task_forces_tf_id           ON task_task_forces(tf_id);
CREATE INDEX IF NOT EXISTS idx_task_projects_project_id         ON task_projects(project_id);
CREATE INDEX IF NOT EXISTS idx_project_task_forces_tf_id        ON project_task_forces(tf_id);
CREATE INDEX IF NOT EXISTS idx_quarterly_kr_task_forces_kr_id   ON quarterly_kr_task_forces(kr_id);
CREATE INDEX IF NOT EXISTS idx_quarterly_kr_task_forces_tf_id   ON quarterly_kr_task_forces(tf_id);
CREATE INDEX IF NOT EXISTS idx_quarterly_kr_task_forces_qobj_id ON quarterly_kr_task_forces(quarterly_objective_id);

-- admin_change_logs / ai_usage_logs
CREATE INDEX IF NOT EXISTS idx_admin_change_logs_performed_at  ON admin_change_logs(performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_change_logs_target_id     ON admin_change_logs(target_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_called_at         ON ai_usage_logs(called_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_member_id         ON ai_usage_logs(member_id);

-- kr_sessions / kr_declarations / milestones
CREATE INDEX IF NOT EXISTS idx_kr_sessions_kr_id_week_start    ON kr_sessions(kr_id, week_start DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_kr_declarations_session_id      ON kr_declarations(session_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_milestones_project_id           ON milestones(project_id) WHERE is_deleted = false;
