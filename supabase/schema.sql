-- ============================================================
-- グループ計画管理アプリ スキーマ定義（統合版）
-- 最終更新: 2026-07-23
-- Supabase SQL エディタで上から順に実行してください
-- ============================================================
--
-- 【統合内容】
-- 旧スキーマ + supabase/migrations/* の全マイグレーション + CLAUDE.md
-- 記載のテーブル定義（milestones）+ 実コードから推定したテーブル
-- (ai_usage_logs / kr_sessions / kr_declarations）を統合した完全版。
-- 2026-07-02：マルチテナント分離（groups/group_id/RLS）・is_admin 自己昇格防止
-- （migrations/20260702_fix_multitenancy_rls.sql）を反映。
-- 2026-07-02c：全社スーパー管理者ロール（is_super_admin）・部署ガバナンス強化
-- （migrations/20260702c_add_super_admin_and_department_governance.sql）を反映。
-- 2026-07-22：オンボーディング経路の是正（M25対応）。is_system_bootstrapped() /
-- bootstrap_first_group_and_member() の2関数を追加
-- （migrations/20260722_add_onboarding_bootstrap.sql）を反映。
-- 2026-07-22b：複数部署アクセス（メンバーの兼務・プロジェクトの部署横断）フェーズ1。
-- members/projects/tasks に group_ids(text[]) 追加・バックフィル・CHECK制約(members/projects)・
-- current_member_group_ids()・RLSの配列オーバーラップ化・tasks.group_ids自動導出トリガー・
-- projects→tasksカスケード・guard_member_privilege_columns/guard_group_deletionの拡張を反映
-- （migrations/20260722b_add_multi_department_access.sql）。フロントエンドは未対応（次フェーズ）。
-- 2026-07-23b：OKR/TFの部署別表示。objectives.group_id を追加・既存Objectiveを全てgrp-eggへ
-- バックフィル（migrations/20260723b_add_objective_group_id.sql）。KR/TFはgroup_id列を持たず
-- objective_id / kr_id を辿ってこの部署を継承する（表示の絞り込みのみ・RLSは今回変更しない）。
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

-- ===== グループ（マルチテナント）=====
-- migrations/20260626_add_multitenancy.sql 参照
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
-- migrations/20260703_add_group_teams_webhook.sql 参照
ALTER TABLE groups ADD COLUMN IF NOT EXISTS teams_webhook_url text;

INSERT INTO groups (id, name, updated_by)
VALUES ('grp-egg', 'EGG', 'system')
ON CONFLICT (id) DO NOTHING;

-- ===== メンバーマスタ =====
CREATE TABLE IF NOT EXISTS members (
  id            text PRIMARY KEY,
  display_name  text NOT NULL,
  short_name    text NOT NULL,
  initials      text NOT NULL,
  teams_account text NOT NULL DEFAULT '',
  email         text,                       -- Supabase Auth メールとの自動マッチング用（migration 20260626）
  is_admin      boolean NOT NULL DEFAULT false,  -- migration 20260626_add_is_admin.sql
  is_super_admin boolean NOT NULL DEFAULT false, -- migration 20260702c（部署をまたぐ全社ロール）
  group_id      text REFERENCES groups(id),      -- migration 20260626_add_multitenancy.sql
  notify_pref   text NOT NULL DEFAULT 'none' CHECK (notify_pref IN ('none','browser','teams')),
  color_bg      text NOT NULL,
  color_text    text NOT NULL,
  is_deleted    boolean NOT NULL DEFAULT false,
  deleted_at    timestamptz,
  deleted_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text NOT NULL DEFAULT ''
);
-- 既存環境向け：列が無ければ追加（schema.sql 再適用時の drift 吸収）
ALTER TABLE members ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE members ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;
ALTER TABLE members ADD COLUMN IF NOT EXISTS is_super_admin boolean NOT NULL DEFAULT false;
ALTER TABLE members ADD COLUMN IF NOT EXISTS group_id text REFERENCES groups(id);
UPDATE members SET group_id = 'grp-egg' WHERE group_id IS NULL;
-- 複数部署アクセス（兼務）対応：migrations/20260722b_add_multi_department_access.sql 参照
ALTER TABLE members ADD COLUMN IF NOT EXISTS group_ids text[] NOT NULL DEFAULT '{}';
UPDATE members SET group_ids = array_append(group_ids, group_id)
  WHERE group_id IS NOT NULL AND NOT (group_id = ANY(group_ids));
CREATE UNIQUE INDEX IF NOT EXISTS members_email_unique
  ON members(email)
  WHERE email IS NOT NULL AND is_deleted = false;

-- ===== Objective（年間） =====
CREATE TABLE IF NOT EXISTS objectives (
  id          text PRIMARY KEY,
  title       text NOT NULL,
  period      text NOT NULL,
  purpose     text,
  background  text,
  is_current  boolean NOT NULL DEFAULT true,
  group_id    text REFERENCES groups(id),      -- migration 20260723b_add_objective_group_id.sql
  archived_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text NOT NULL DEFAULT ''
);
-- 既存環境向け：列が無ければ追加（schema.sql 再適用時の drift 吸収）
--
-- 【2026-07-23b時点】objectives.group_id は当初は表示の絞り込み（UI側）専用として追加。
-- 【2026-07-24更新】migration 20260724_scope_okr_core_tables.sqlでKR/TF/ToDoにも自前の
-- group_id列を追加し（objective_id/kr_id/tf_idを辿ってトリガーが自動継承）、objectives
-- 含む4テーブルのRLSを「authenticated full access」からgroup_idスコープの個別ポリシーに
-- 差し替え済み（下部「OKRコア階層」ブロック参照。CLAUDE.md Section 1.6参照）。
ALTER TABLE objectives ADD COLUMN IF NOT EXISTS group_id text REFERENCES groups(id);
-- 既存Objectiveは全てEGGへバックフィル（AID等の新しいOKRはPDF取込・手入力で入れ直す方針）
UPDATE objectives SET group_id = 'grp-egg' WHERE group_id IS NULL;

-- ===== Key Results（年間・通年固定） =====
CREATE TABLE IF NOT EXISTS key_results (
  id           text PRIMARY KEY,
  objective_id text NOT NULL REFERENCES objectives(id),
  title        text NOT NULL,
  -- 所属部署（migration 20260724_scope_okr_core_tables.sql）。親Objectiveから
  -- トリガー（sync_kr_group_id）が自動注入する。フロントはこの列を一切送らない。
  group_id     text REFERENCES groups(id),
  is_deleted   boolean NOT NULL DEFAULT false,
  deleted_at   timestamptz,
  deleted_by   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   text NOT NULL DEFAULT ''
);
-- 既存環境向け：列が無ければ追加（schema.sql 再適用時の drift 吸収）
ALTER TABLE key_results ADD COLUMN IF NOT EXISTS group_id text REFERENCES groups(id);
UPDATE key_results kr SET group_id = o.group_id
  FROM objectives o WHERE o.id = kr.objective_id AND kr.group_id IS NULL;

-- ===== Quarterly Objectives =====
CREATE TABLE IF NOT EXISTS quarterly_objectives (
  id           text PRIMARY KEY,
  objective_id text NOT NULL REFERENCES objectives(id),
  quarter      text NOT NULL CHECK (quarter IN ('1Q','2Q','3Q','4Q')),
  title        text NOT NULL,
  purpose      text,
  background   text,
  -- 所属部署（2026-07-23・20260723c）。objectivesと同型。RLSは変更せず表示絞り込みのみ
  -- （src/lib/okr/deptScope.ts参照）。既存行はobjective_id経由の親Objectiveから継承バックフィル。
  group_id     text REFERENCES groups(id),
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
  quarter          text CONSTRAINT task_forces_quarter_check CHECK (quarter IS NULL OR quarter IN ('1Q','2Q','3Q','4Q')),
  leader_member_id text REFERENCES members(id),
  -- 所属部署（migration 20260724_scope_okr_core_tables.sql）。親KeyResult(=Objective経由)
  -- からトリガー（sync_tf_group_id）が自動注入する。フロントはこの列を一切送らない。
  group_id         text REFERENCES groups(id),
  is_deleted       boolean NOT NULL DEFAULT false,
  deleted_at       timestamptz,
  deleted_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       text NOT NULL DEFAULT ''
);
-- 既存環境向け：列が無ければ追加（schema.sql 再適用時の drift 吸収。key_resultsの
-- バックフィル後に実行する必要があるため、このブロックはkey_resultsの定義より後）
ALTER TABLE task_forces ADD COLUMN IF NOT EXISTS group_id text REFERENCES groups(id);
UPDATE task_forces tf SET group_id = kr.group_id
  FROM key_results kr WHERE kr.id = tf.kr_id AND tf.group_id IS NULL;

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
  -- 所属部署（migration 20260724_scope_okr_core_tables.sql）。親TaskForceから
  -- トリガー（sync_todo_group_id）が自動注入する。フロントはこの列を一切送らない。
  group_id   text REFERENCES groups(id),
  is_deleted boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  deleted_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL DEFAULT ''
);
-- 既存環境向け：列が無ければ追加（schema.sql 再適用時の drift 吸収。task_forcesの
-- バックフィル後に実行する必要があるため、このブロックはtask_forcesの定義より後）
ALTER TABLE todos ADD COLUMN IF NOT EXISTS group_id text REFERENCES groups(id);
UPDATE todos t SET group_id = tf.group_id
  FROM task_forces tf WHERE tf.id = t.tf_id AND t.group_id IS NULL;

-- ===== Projects =====
CREATE TABLE IF NOT EXISTS projects (
  id                text PRIMARY KEY,
  name              text NOT NULL,
  purpose           text NOT NULL DEFAULT '',
  contribution_memo text NOT NULL DEFAULT '',
  owner_member_id   text REFERENCES members(id),       -- 互換目的の単数 FK
  owner_member_ids  text[] NOT NULL DEFAULT '{}',      -- 複数オーナー対応
  member_roles      jsonb NOT NULL DEFAULT '{}',       -- メンバー別役割マップ（migration 20260612）
  group_id          text REFERENCES groups(id),        -- migration 20260626_add_multitenancy.sql
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
-- 既存環境向け：列が無ければ追加（schema.sql 再適用時の drift 吸収）
ALTER TABLE projects ADD COLUMN IF NOT EXISTS member_roles jsonb NOT NULL DEFAULT '{}';  -- migration 20260612
ALTER TABLE projects ADD COLUMN IF NOT EXISTS group_id text REFERENCES groups(id);  -- migration 20260626_add_multitenancy.sql
UPDATE projects SET group_id = 'grp-egg' WHERE group_id IS NULL;
-- 複数部署アクセス（兼務・プロジェクトの部署横断）対応：migrations/20260722b_add_multi_department_access.sql 参照
ALTER TABLE projects ADD COLUMN IF NOT EXISTS group_ids text[] NOT NULL DEFAULT '{}';
UPDATE projects SET group_ids = array_append(group_ids, group_id)
  WHERE group_id IS NOT NULL AND NOT (group_id = ANY(group_ids));

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
  status              text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','done','on_hold','cancelled')),  -- on_hold/cancelledはmigration 20260721_add_task_status_hold_cancelled.sql
  priority            text CHECK (priority IN ('high','mid','low')),
  start_date          date,
  due_date            date,
  estimated_hours     numeric,
  comment             text NOT NULL DEFAULT '',
  tags                text[] NOT NULL DEFAULT '{}',     -- 自由入力タグ（migration 20260604）
  finalized_mentions  text[] NOT NULL DEFAULT '{}',     -- メンション通知確定スナップショット（migration 20260608）
  is_deleted          boolean NOT NULL DEFAULT false,
  deleted_at          timestamptz,
  deleted_by          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          text NOT NULL DEFAULT ''
);
-- 既存環境向け：列が無ければ追加（schema.sql 再適用時の drift 吸収）
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS parent_task_id text REFERENCES tasks(id);  -- migration 20260527
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 0;  -- migration 20260527
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS finalized_mentions text[] NOT NULL DEFAULT '{}';  -- migration 20260608
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS group_id text REFERENCES groups(id);  -- migration 20260626_add_multitenancy.sql
UPDATE tasks SET group_id = 'grp-egg' WHERE group_id IS NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS baseline_start_date date;  -- migration 20260717b_add_task_baseline.sql（B4）
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS baseline_due_date date;    -- migration 20260717b_add_task_baseline.sql（B4）
-- 複数部署アクセス対応：tasks.group_ids はDBトリガー（sync_task_group_ids）が唯一の真実。
-- ここでは既存データのバックフィルのみ行う（migrations/20260722b_add_multi_department_access.sql 参照）。
-- project_idがあればそのプロジェクトのgroup_ids（projectsは上のブロックで既にバックフィル済み）を、
-- 無ければホーム部署（tasks.group_id）のみの配列を採用する。
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS group_ids text[] NOT NULL DEFAULT '{}';
UPDATE tasks t
SET group_ids = CASE
  WHEN t.project_id IS NOT NULL THEN
    COALESCE((SELECT p.group_ids FROM projects p WHERE p.id = t.project_id),
              CASE WHEN t.group_id IS NULL THEN '{}'::text[] ELSE ARRAY[t.group_id] END)
  WHEN t.group_id IS NULL THEN '{}'::text[]
  ELSE ARRAY[t.group_id]
END
WHERE t.group_ids = '{}';  -- 新規追加列の初期バックフィルのみ対象（再適用時に既存の値を壊さない）

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

-- ===== Task 依存関係（先行→後続。B1：依存ゲート） =====
-- migrations/20260717_add_task_dependencies.sql 参照。
-- task_task_forces/task_projects と違い is_deleted による論理削除の監査証跡を持つため
-- 複合PKではなく独立 id（milestones/kr_reports と同じ流儀）にする。
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

-- ===== Milestones（PJ に紐づく期日マーカー） =====
-- 注: project_id は projects.id と型を合わせるため text にする
-- （CLAUDE.md の旧 DDL は uuid だったが projects.id が text のため整合性なし）
CREATE TABLE IF NOT EXISTS milestones (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  text NOT NULL REFERENCES projects(id),
  name        text NOT NULL,
  date        date NOT NULL,
  description text,                         -- メモ・詳細（任意。migrations/20260603_add_milestone_description.sql で追加）
  is_deleted  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text,
  deleted_at  timestamptz,
  deleted_by  text
);
-- 既存環境向け：列が無ければ追加（schema.sql 再適用時の drift 吸収）
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS description text;

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
-- ============================================================
-- メンバータグ（migrations/20260508_member_tags.sql 参照）
-- ============================================================

CREATE TABLE IF NOT EXISTS member_tags (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  kind        text NOT NULL DEFAULT 'static'
              CHECK (kind IN ('static','all_members','kr_members','tf_members')),
  source_id   text,
  is_deleted  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text NOT NULL DEFAULT '',
  deleted_at  timestamptz,
  deleted_by  text
);

CREATE TABLE IF NOT EXISTS member_tag_members (
  tag_id     text NOT NULL REFERENCES member_tags(id) ON DELETE CASCADE,
  member_id  text NOT NULL REFERENCES members(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tag_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_member_tag_members_member_id ON member_tag_members(member_id);
CREATE INDEX IF NOT EXISTS idx_member_tags_kind ON member_tags(kind) WHERE is_deleted = false;

CREATE TABLE IF NOT EXISTS kr_sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kr_id             text NOT NULL REFERENCES key_results(id),
  week_start        date NOT NULL,                    -- 月曜日
  session_type      text NOT NULL CHECK (session_type IN ('checkin','win_session','freeform')),
  signal            text CHECK (signal IN ('green','yellow','red')),
  signal_comment    text NOT NULL DEFAULT '',
  learnings         text NOT NULL DEFAULT '',
  external_changes  text NOT NULL DEFAULT '',
  transcript        text NOT NULL DEFAULT '',
  -- freeform 用の3列（migrations/20260508_freeform_session.sql 参照）
  summary           text NOT NULL DEFAULT '',
  decisions         text NOT NULL DEFAULT '',
  kr_mentions       text NOT NULL DEFAULT '',
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

-- ===== PJごとのAI分析結果（全員で共有・最新2件） =====
-- migrations/20260513_add_project_analyses.sql 参照
CREATE TABLE IF NOT EXISTS project_analyses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  text NOT NULL REFERENCES projects(id),
  content     text NOT NULL,
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ===== 会議ノート（OKR循環ワークフロー Phase A）：KR×週で1件、配下にTFごとのエントリ =====
-- migrations/20260513b_restructure_kr_meeting_notes.sql / docs/okr-cycle-design.md 参照
CREATE TABLE IF NOT EXISTS kr_meeting_notes (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kr_id                text NOT NULL REFERENCES key_results(id),
  week_start           date NOT NULL,
  carried_from_note_id uuid REFERENCES kr_meeting_notes(id),
  carry_memo           text NOT NULL DEFAULT '',
  created_by           text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           text NOT NULL DEFAULT '',
  is_deleted           boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS kr_note_tf_entries (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id            uuid NOT NULL REFERENCES kr_meeting_notes(id) ON DELETE CASCADE,
  tf_id              text NOT NULL REFERENCES task_forces(id),
  tf_theme           text NOT NULL DEFAULT '',
  target_definition  text NOT NULL DEFAULT '',
  eval_criteria      text NOT NULL DEFAULT '',
  hypotheses         text NOT NULL DEFAULT '',
  facts              text NOT NULL DEFAULT '',
  next_actions       text NOT NULL DEFAULT '',
  progress_pct       int,
  progress_reason    text NOT NULL DEFAULT '',
  todo               text NOT NULL DEFAULT '',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (note_id, tf_id)
);

-- ===== KR単位のAI分析の蓄積（OKR循環ワークフロー Phase B） =====
-- migrations/20260513c_add_okr_tf_analyses.sql → 20260513d_restructure_okr_analyses_to_kr.sql
CREATE TABLE IF NOT EXISTS okr_analyses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope        text NOT NULL DEFAULT 'kr' CHECK (scope IN ('kr','objective')),
  kr_id        text REFERENCES key_results(id),
  objective_id text REFERENCES objectives(id),
  content      text NOT NULL,
  edited       boolean NOT NULL DEFAULT false,
  created_by   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   text NOT NULL DEFAULT '',
  is_deleted   boolean NOT NULL DEFAULT false,
  CONSTRAINT okr_analyses_scope_target_check CHECK (
    (scope = 'kr'        AND kr_id        IS NOT NULL AND objective_id IS NULL)
    OR (scope = 'objective' AND objective_id IS NOT NULL AND kr_id        IS NULL)
  )
);

-- ===== KRレポート（OKR循環ワークフロー Phase C）：AI下書き→人が確認・編集→確定 =====
-- migrations/20260513e_add_kr_reports.sql 参照
CREATE TABLE IF NOT EXISTS kr_reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kr_id        text NOT NULL REFERENCES key_results(id),
  week_start   date NOT NULL,
  mode         text NOT NULL DEFAULT 'checkin',
  content      text NOT NULL DEFAULT '',
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','finalized')),
  created_by   text NOT NULL,
  finalized_by text,
  finalized_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   text NOT NULL DEFAULT '',
  is_deleted   boolean NOT NULL DEFAULT false
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
    ('milestones'), ('kr_sessions'), ('kr_declarations'),
    ('member_tags'), ('kr_meeting_notes'), ('kr_note_tf_entries'),
    ('okr_analyses'), ('kr_reports'), ('task_dependencies')
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

ALTER TABLE groups                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE members                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE objectives                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE key_results                ENABLE ROW LEVEL SECURITY;
ALTER TABLE quarterly_objectives       ENABLE ROW LEVEL SECURITY;
ALTER TABLE quarterly_kr_task_forces   ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_task_forces           ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_projects              ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_dependencies          ENABLE ROW LEVEL SECURITY;
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
ALTER TABLE member_tags                ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_tag_members         ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_analyses           ENABLE ROW LEVEL SECURITY;
ALTER TABLE kr_meeting_notes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE kr_note_tf_entries         ENABLE ROW LEVEL SECURITY;
ALTER TABLE okr_analyses               ENABLE ROW LEVEL SECURITY;
ALTER TABLE kr_reports                 ENABLE ROW LEVEL SECURITY;

-- members / projects / tasks / groups はグループ分離・権限昇格防止のため
-- 個別ポリシー（このセクションの下）を使う。ここでは「全員フルアクセス」のブランケット
-- ポリシーをそれ以外のテーブルにのみ適用する。
-- 【注意】OKR周辺テーブル（kr_sessions等）はまだグループ分離未対応（既知の残課題）。
DO $$
DECLARE
  t text;
BEGIN
  -- 【2026-07-23】PJ・タスク周辺テーブル（milestones/project_analyses/
  -- project_task_forces/task_task_forces/task_projects/member_tag_members/
  -- admin_change_logs/ai_usage_logs）は下部で親を辿る部署スコープポリシーに
  -- 差し替えたためこのループから除外。member_tags 本体は全社共通マスタとして
  -- 全公開のまま維持（部署概念が無いため）。
  -- 【2026-07-24】OKRコア階層（objectives/key_results/task_forces/todos）は
  -- migration 20260724_scope_okr_core_tables.sql で個別のgroup_idスコープポリシーに
  -- 差し替えたためこのループから除外（下部の「OKRコア階層」ブロック参照）。
  -- 残るOKR周辺テーブル（quarterly_*/kr_sessions/kr_declarations/kr_meeting_notes/
  -- kr_note_tf_entries/okr_analyses/kr_reports）はマルチテナント未対応の既知の残課題
  -- （第2弾でまとめて対応する方針。CLAUDE.md Section 1.6・Section 9のG参照）。
  FOR t IN VALUES
    ('quarterly_objectives'), ('quarterly_kr_task_forces'),
    ('kr_sessions'), ('kr_declarations'),
    ('member_tags'),
    ('kr_meeting_notes'), ('kr_note_tf_entries'), ('okr_analyses'), ('kr_reports')
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS "authenticated full access" ON %1$s;
       CREATE POLICY "authenticated full access" ON %1$s
         FOR ALL TO authenticated USING (true) WITH CHECK (true);', t);
  END LOOP;
END $$;

-- ============================================================
-- マルチテナント分離：ヘルパー関数（SECURITY DEFINER で members の RLS を迂回）
-- ============================================================

CREATE OR REPLACE FUNCTION current_member_group_id()
RETURNS text
LANGUAGE sql
SECURITY DEFINER STABLE
SET search_path = ''
AS $fn_group_id$
  SELECT group_id FROM public.members
  WHERE email = auth.email()
    AND is_deleted = false
  LIMIT 1
$fn_group_id$;

CREATE OR REPLACE FUNCTION current_member_is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER STABLE
SET search_path = ''
AS $fn_is_admin$
  SELECT COALESCE(is_admin, false) FROM public.members
  WHERE email = auth.email()
    AND is_deleted = false
  LIMIT 1
$fn_is_admin$;

-- 全社スーパー管理者判定（部署非依存。migration 20260702c）
CREATE OR REPLACE FUNCTION current_member_is_super_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER STABLE
SET search_path = ''
AS $fn_is_super_admin$
  SELECT COALESCE(is_super_admin, false) FROM public.members
  WHERE email = auth.email()
    AND is_deleted = false
  LIMIT 1
$fn_is_super_admin$;

-- 複数部署アクセス（兼務）対応：アクセス可能な部署の全リストを返すヘルパー関数（新規）。
-- current_member_group_id()（単数・ホーム部署）は変更せず併存させる（is_admin判定・新規
-- レコードのデフォルト割当は引き続きこちらを基準にする）。migration 20260722b 参照。
CREATE OR REPLACE FUNCTION current_member_group_ids()
RETURNS text[]
LANGUAGE sql
SECURITY DEFINER STABLE
SET search_path = ''
AS $fn_group_ids$
  SELECT group_ids FROM public.members
  WHERE email = auth.email()
    AND is_deleted = false
  LIMIT 1
$fn_group_ids$;

-- members / projects / tasks：group_ids（アクセス可能な部署の全リスト）が自分の
-- group_ids と1つでも重なるか、またはsuper-adminなら部署をまたいで許可
-- （migration 20260722b で group_id 単一値比較 → 配列オーバーラップに置き換え）
DROP POLICY IF EXISTS "authenticated full access" ON members;
DROP POLICY IF EXISTS "members_group" ON members;
CREATE POLICY "members_group" ON members FOR ALL TO authenticated
  USING (group_ids && current_member_group_ids() OR current_member_is_super_admin());

DROP POLICY IF EXISTS "authenticated full access" ON projects;
DROP POLICY IF EXISTS "projects_group" ON projects;
CREATE POLICY "projects_group" ON projects FOR ALL TO authenticated
  USING (group_ids && current_member_group_ids() OR current_member_is_super_admin());

DROP POLICY IF EXISTS "authenticated full access" ON tasks;
DROP POLICY IF EXISTS "tasks_group" ON tasks;
CREATE POLICY "tasks_group" ON tasks FOR ALL TO authenticated
  USING (group_ids && current_member_group_ids() OR current_member_is_super_admin());

-- task_dependencies（B1）：tasks と同じ group_id スコープ。NULL猶予条項は入れない
-- （20260702b の教訓＝NULLを許すとRLSの穴になる。このテーブルはgroup_idがNOT NULLなので該当なし）
DROP POLICY IF EXISTS "authenticated full access" ON task_dependencies;
DROP POLICY IF EXISTS "task_dependencies_group" ON task_dependencies;
CREATE POLICY "task_dependencies_group" ON task_dependencies FOR ALL TO authenticated
  USING (group_id = current_member_group_id() OR current_member_is_super_admin());

-- ============================================================
-- OKRコア階層（objectives/key_results/task_forces/todos）の部署スコープ
-- （migration 20260724_scope_okr_core_tables.sql 参照）。
--
-- 各テーブルが自前のgroup_id列を持つ（親を辿るJOINではなく単純な列比較）。
-- BEFORE INSERT/UPDATEトリガーが常に親からgroup_idを自動注入するため、フロントは
-- group_idを一切送らずに済む（saveKeyResult/saveTaskForce/saveTodoは無改修）。
-- NULL許可の猶予句は入れない（20260702bの教訓）。
-- ============================================================

-- key_results：親=objectivesからBEFORE INSERT/UPDATEで自動注入
CREATE OR REPLACE FUNCTION sync_kr_group_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_sync_kr_group_id$
BEGIN
  SELECT o.group_id INTO NEW.group_id
  FROM public.objectives o
  WHERE o.id = NEW.objective_id;
  RETURN NEW;
END;
$fn_sync_kr_group_id$;

DROP TRIGGER IF EXISTS trg_key_results_sync_group_id ON key_results;
CREATE TRIGGER trg_key_results_sync_group_id
  BEFORE INSERT OR UPDATE ON key_results
  FOR EACH ROW EXECUTE FUNCTION sync_kr_group_id();

-- task_forces：親=key_results（＝Objective経由）からBEFORE INSERT/UPDATEで自動注入
CREATE OR REPLACE FUNCTION sync_tf_group_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_sync_tf_group_id$
BEGIN
  SELECT kr.group_id INTO NEW.group_id
  FROM public.key_results kr
  WHERE kr.id = NEW.kr_id;
  RETURN NEW;
END;
$fn_sync_tf_group_id$;

DROP TRIGGER IF EXISTS trg_task_forces_sync_group_id ON task_forces;
CREATE TRIGGER trg_task_forces_sync_group_id
  BEFORE INSERT OR UPDATE ON task_forces
  FOR EACH ROW EXECUTE FUNCTION sync_tf_group_id();

-- todos：親=task_forcesからBEFORE INSERT/UPDATEで自動注入
CREATE OR REPLACE FUNCTION sync_todo_group_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_sync_todo_group_id$
BEGIN
  SELECT tf.group_id INTO NEW.group_id
  FROM public.task_forces tf
  WHERE tf.id = NEW.tf_id;
  RETURN NEW;
END;
$fn_sync_todo_group_id$;

DROP TRIGGER IF EXISTS trg_todos_sync_group_id ON todos;
CREATE TRIGGER trg_todos_sync_group_id
  BEFORE INSERT OR UPDATE ON todos
  FOR EACH ROW EXECUTE FUNCTION sync_todo_group_id();

-- 親のgroup_id変更時、子・孫へカスケード（cascade_project_group_ids_to_tasksと同型）。
-- 親のUPDATEだけでは子は保存されないため自動注入トリガーが働かない。このAFTER UPDATEが
-- 子を明示的に更新し、子のBEFORE INSERT/UPDATEトリガーで値が確定＝冪等。子の値が実際に
-- 変化すればさらに孫へ連鎖する（Objective変更→KR→TF→ToDoまで自動的に波及）。
CREATE OR REPLACE FUNCTION cascade_objective_group_id_to_krs()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_cascade_obj_to_kr$
BEGIN
  IF NEW.group_id IS DISTINCT FROM OLD.group_id THEN
    UPDATE public.key_results
    SET group_id = NEW.group_id
    WHERE objective_id = NEW.id
      AND group_id IS DISTINCT FROM NEW.group_id;
  END IF;
  RETURN NEW;
END;
$fn_cascade_obj_to_kr$;

DROP TRIGGER IF EXISTS trg_objectives_cascade_group_id ON objectives;
CREATE TRIGGER trg_objectives_cascade_group_id
  AFTER UPDATE ON objectives
  FOR EACH ROW EXECUTE FUNCTION cascade_objective_group_id_to_krs();

CREATE OR REPLACE FUNCTION cascade_kr_group_id_to_tfs()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_cascade_kr_to_tf$
BEGIN
  IF NEW.group_id IS DISTINCT FROM OLD.group_id THEN
    UPDATE public.task_forces
    SET group_id = NEW.group_id
    WHERE kr_id = NEW.id
      AND group_id IS DISTINCT FROM NEW.group_id;
  END IF;
  RETURN NEW;
END;
$fn_cascade_kr_to_tf$;

DROP TRIGGER IF EXISTS trg_key_results_cascade_group_id ON key_results;
CREATE TRIGGER trg_key_results_cascade_group_id
  AFTER UPDATE ON key_results
  FOR EACH ROW EXECUTE FUNCTION cascade_kr_group_id_to_tfs();

CREATE OR REPLACE FUNCTION cascade_tf_group_id_to_todos()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_cascade_tf_to_todo$
BEGIN
  IF NEW.group_id IS DISTINCT FROM OLD.group_id THEN
    UPDATE public.todos
    SET group_id = NEW.group_id
    WHERE tf_id = NEW.id
      AND group_id IS DISTINCT FROM NEW.group_id;
  END IF;
  RETURN NEW;
END;
$fn_cascade_tf_to_todo$;

DROP TRIGGER IF EXISTS trg_task_forces_cascade_group_id ON task_forces;
CREATE TRIGGER trg_task_forces_cascade_group_id
  AFTER UPDATE ON task_forces
  FOR EACH ROW EXECUTE FUNCTION cascade_tf_group_id_to_todos();

-- RLSポリシー本体（単一group_id列なので配列オーバーラップではなく = ANY を使う）
DROP POLICY IF EXISTS "authenticated full access" ON objectives;
DROP POLICY IF EXISTS "objectives_group" ON objectives;
CREATE POLICY "objectives_group" ON objectives FOR ALL TO authenticated
  USING (group_id = ANY(current_member_group_ids()) OR current_member_is_super_admin())
  WITH CHECK (group_id = ANY(current_member_group_ids()) OR current_member_is_super_admin());

DROP POLICY IF EXISTS "authenticated full access" ON key_results;
DROP POLICY IF EXISTS "key_results_group" ON key_results;
CREATE POLICY "key_results_group" ON key_results FOR ALL TO authenticated
  USING (group_id = ANY(current_member_group_ids()) OR current_member_is_super_admin())
  WITH CHECK (group_id = ANY(current_member_group_ids()) OR current_member_is_super_admin());

DROP POLICY IF EXISTS "authenticated full access" ON task_forces;
DROP POLICY IF EXISTS "task_forces_group" ON task_forces;
CREATE POLICY "task_forces_group" ON task_forces FOR ALL TO authenticated
  USING (group_id = ANY(current_member_group_ids()) OR current_member_is_super_admin())
  WITH CHECK (group_id = ANY(current_member_group_ids()) OR current_member_is_super_admin());

DROP POLICY IF EXISTS "authenticated full access" ON todos;
DROP POLICY IF EXISTS "todos_group" ON todos;
CREATE POLICY "todos_group" ON todos FOR ALL TO authenticated
  USING (group_id = ANY(current_member_group_ids()) OR current_member_is_super_admin())
  WITH CHECK (group_id = ANY(current_member_group_ids()) OR current_member_is_super_admin());

-- ============================================================
-- PJ・タスク周辺（子）テーブルの部署スコープ（migration 20260723 参照）。
-- これらは group_id 列を持たないため、親（projects/tasks/members）を辿って判定する。
-- ポリシーのUSING内から親を直接SELECTするとRLSが二重適用されるため、
-- SECURITY DEFINER のヘルパー関数（RLS迂回）で親の group_ids を引く。
-- ============================================================
CREATE OR REPLACE FUNCTION public.can_access_group_ids(p_group_ids text[])
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = ''
AS $fn_can_access$
  SELECT coalesce(p_group_ids && public.current_member_group_ids(), false)
    OR public.current_member_is_super_admin()
$fn_can_access$;
GRANT EXECUTE ON FUNCTION public.can_access_group_ids(text[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.project_group_ids(p_project_id text)
RETURNS text[] LANGUAGE sql SECURITY DEFINER STABLE SET search_path = ''
AS $fn_pj_gids$
  SELECT group_ids FROM public.projects WHERE id = p_project_id
$fn_pj_gids$;
GRANT EXECUTE ON FUNCTION public.project_group_ids(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.task_group_ids(p_task_id text)
RETURNS text[] LANGUAGE sql SECURITY DEFINER STABLE SET search_path = ''
AS $fn_task_gids$
  SELECT group_ids FROM public.tasks WHERE id = p_task_id
$fn_task_gids$;
GRANT EXECUTE ON FUNCTION public.task_group_ids(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.member_group_ids(p_member_id text)
RETURNS text[] LANGUAGE sql SECURITY DEFINER STABLE SET search_path = ''
AS $fn_mem_gids$
  SELECT group_ids FROM public.members WHERE id = p_member_id
$fn_mem_gids$;
GRANT EXECUTE ON FUNCTION public.member_group_ids(text) TO authenticated;

DROP POLICY IF EXISTS "authenticated_all" ON milestones;
DROP POLICY IF EXISTS "authenticated full access" ON milestones;
DROP POLICY IF EXISTS "milestones_group" ON milestones;
CREATE POLICY "milestones_group" ON milestones FOR ALL TO authenticated
  USING (public.can_access_group_ids(public.project_group_ids(project_id)));

DROP POLICY IF EXISTS "authenticated full access" ON project_analyses;
DROP POLICY IF EXISTS "project_analyses_group" ON project_analyses;
CREATE POLICY "project_analyses_group" ON project_analyses FOR ALL TO authenticated
  USING (public.can_access_group_ids(public.project_group_ids(project_id)));

DROP POLICY IF EXISTS "authenticated full access" ON project_task_forces;
DROP POLICY IF EXISTS "project_task_forces_group" ON project_task_forces;
CREATE POLICY "project_task_forces_group" ON project_task_forces FOR ALL TO authenticated
  USING (public.can_access_group_ids(public.project_group_ids(project_id)));

DROP POLICY IF EXISTS "authenticated full access" ON task_projects;
DROP POLICY IF EXISTS "task_projects_group" ON task_projects;
CREATE POLICY "task_projects_group" ON task_projects FOR ALL TO authenticated
  USING (public.can_access_group_ids(public.task_group_ids(task_id)));

DROP POLICY IF EXISTS "authenticated full access" ON task_task_forces;
DROP POLICY IF EXISTS "task_task_forces_group" ON task_task_forces;
CREATE POLICY "task_task_forces_group" ON task_task_forces FOR ALL TO authenticated
  USING (public.can_access_group_ids(public.task_group_ids(task_id)));

DROP POLICY IF EXISTS "authenticated full access" ON member_tag_members;
DROP POLICY IF EXISTS "member_tag_members_group" ON member_tag_members;
CREATE POLICY "member_tag_members_group" ON member_tag_members FOR ALL TO authenticated
  USING (public.can_access_group_ids(public.member_group_ids(member_id)));

DROP POLICY IF EXISTS "authenticated full access" ON admin_change_logs;
DROP POLICY IF EXISTS "admin_change_logs_group" ON admin_change_logs;
CREATE POLICY "admin_change_logs_group" ON admin_change_logs FOR ALL TO authenticated
  USING (public.can_access_group_ids(public.member_group_ids(performed_by)));

DROP POLICY IF EXISTS "authenticated users can select" ON ai_usage_logs;
DROP POLICY IF EXISTS "ai_usage_logs_select_group" ON ai_usage_logs;
CREATE POLICY "ai_usage_logs_select_group" ON ai_usage_logs FOR SELECT TO authenticated
  USING (public.can_access_group_ids(public.member_group_ids(member_id)));

-- 複数部署アクセス：不変条件をCHECK制約で強制（members / projects のみ。tasksはDBトリガーが
-- 唯一の真実のため対象外）。migration 20260722b 参照。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'members_group_id_in_group_ids'
  ) THEN
    ALTER TABLE members
      ADD CONSTRAINT members_group_id_in_group_ids
      CHECK (group_id IS NULL OR group_id = ANY(group_ids));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'projects_group_id_in_group_ids'
  ) THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_group_id_in_group_ids
      CHECK (group_id IS NULL OR group_id = ANY(group_ids));
  END IF;
END $$;

-- 複数部署アクセス：tasks.group_ids はDBトリガーが唯一の真実（アプリからは直接編集させない）。
-- project_id があればそのプロジェクトの group_ids をコピー、無ければホーム部署のみに正規化する。
CREATE OR REPLACE FUNCTION sync_task_group_ids()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_sync_task_group_ids$
DECLARE
  proj_group_ids text[];
BEGIN
  IF NEW.project_id IS NOT NULL THEN
    SELECT group_ids INTO proj_group_ids FROM public.projects WHERE id = NEW.project_id;
    IF proj_group_ids IS NULL THEN
      NEW.group_ids := CASE WHEN NEW.group_id IS NULL THEN '{}'::text[] ELSE ARRAY[NEW.group_id] END;
    ELSE
      NEW.group_ids := proj_group_ids;
    END IF;
  ELSE
    NEW.group_ids := CASE WHEN NEW.group_id IS NULL THEN '{}'::text[] ELSE ARRAY[NEW.group_id] END;
  END IF;
  RETURN NEW;
END;
$fn_sync_task_group_ids$;

DROP TRIGGER IF EXISTS trg_tasks_sync_group_ids ON tasks;
CREATE TRIGGER trg_tasks_sync_group_ids
  BEFORE INSERT OR UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION sync_task_group_ids();

-- 複数部署アクセス：projects.group_ids が変化したら配下タスクへカスケード反映
-- （既知の副作用：配下タスク全部のupdated_atが動きうる。B3自動リスケ連鎖等と同種の割り切り）
CREATE OR REPLACE FUNCTION cascade_project_group_ids_to_tasks()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_cascade_pj_group_ids$
BEGIN
  IF NEW.group_ids IS DISTINCT FROM OLD.group_ids THEN
    UPDATE public.tasks
    SET group_ids = NEW.group_ids
    WHERE project_id = NEW.id
      AND group_ids IS DISTINCT FROM NEW.group_ids;
  END IF;
  RETURN NEW;
END;
$fn_cascade_pj_group_ids$;

DROP TRIGGER IF EXISTS trg_projects_cascade_group_ids ON projects;
CREATE TRIGGER trg_projects_cascade_group_ids
  AFTER UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION cascade_project_group_ids_to_tasks();

-- 複数部署アクセス：projects.group_ids の正規化トリガー（安全網）。プロジェクトは全員編集可・
-- 特別なゲーティングなしの設計のため、group_id（ホーム部署）だけが変更されgroup_idsが
-- 追従しないケースでもCHECK制約違反にならないよう自動的に追加する（既存値の削除は行わない）。
CREATE OR REPLACE FUNCTION normalize_project_group_ids()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_normalize_pj_group_ids$
BEGIN
  IF NEW.group_id IS NOT NULL AND NOT (NEW.group_id = ANY(NEW.group_ids)) THEN
    NEW.group_ids := array_append(NEW.group_ids, NEW.group_id);
  END IF;
  RETURN NEW;
END;
$fn_normalize_pj_group_ids$;

DROP TRIGGER IF EXISTS trg_projects_normalize_group_ids ON projects;
CREATE TRIGGER trg_projects_normalize_group_ids
  BEFORE INSERT OR UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION normalize_project_group_ids();

-- groups：参照は全員可。新規部署の作成はsuper-admin限定、改名・編集はsuper-admin
-- または自分の部署のadminのみ、物理DELETE（アプリは未使用）はsuper-admin限定。
DROP POLICY IF EXISTS "authenticated full access" ON groups;
DROP POLICY IF EXISTS "groups_auth" ON groups;
DROP POLICY IF EXISTS "groups_select" ON groups;
CREATE POLICY "groups_select" ON groups FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "groups_insert_admin" ON groups;
CREATE POLICY "groups_insert_admin" ON groups FOR INSERT TO authenticated
  WITH CHECK (current_member_is_super_admin());
DROP POLICY IF EXISTS "groups_update_admin" ON groups;
CREATE POLICY "groups_update_admin" ON groups FOR UPDATE TO authenticated
  USING (
    current_member_is_super_admin()
    OR (current_member_is_admin() AND id = current_member_group_id())
  );
DROP POLICY IF EXISTS "groups_delete_admin" ON groups;
CREATE POLICY "groups_delete_admin" ON groups FOR DELETE TO authenticated
  USING (current_member_is_super_admin());

-- members：is_admin / group_id / is_super_admin の自己昇格防止
-- （列単位のガードは RLS では書けないためトリガーで実装。INSERT/UPDATE 両方に適用
--  ＝INSERT時に他人のメールアドレスで先回りis_admin/is_super_admin行を作られる
--  穴を防ぐ。migration 20260702c で INSERT にも拡張）
CREATE OR REPLACE FUNCTION guard_member_privilege_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_guard$
DECLARE
  dept_admin_count    integer;
  super_admin_count   integer;
  acting_super_admin  boolean;
  will_be_super_admin boolean;
  old_is_admin        boolean;
  old_is_super_admin  boolean;
  old_group_id        text;
  check_group_id      text;
  old_group_ids       text[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    old_is_admin       := false;
    old_is_super_admin := false;
    old_group_id       := NEW.group_id;
    check_group_id     := NEW.group_id;
    old_group_ids      := NULL; -- INSERTには「以前の行」が存在しない
  ELSE
    old_is_admin       := OLD.is_admin;
    old_is_super_admin := OLD.is_super_admin;
    old_group_id       := OLD.group_id;
    check_group_id     := OLD.group_id;
    old_group_ids      := OLD.group_ids;
  END IF;

  acting_super_admin := public.current_member_is_super_admin();

  -- フェーズ1: is_super_admin（全社ロール。他人の代理昇格は不可、自分自身のみブートストラップ可）
  IF NEW.is_super_admin IS DISTINCT FROM old_is_super_admin THEN
    IF acting_super_admin THEN
      NULL;
    ELSE
      SELECT count(*) INTO super_admin_count
      FROM public.members
      WHERE is_super_admin = true AND is_deleted = false;

      IF super_admin_count = 0 AND NEW.email = auth.email() THEN
        NULL;
      ELSE
        NEW.is_super_admin := old_is_super_admin;
      END IF;
    END IF;
  END IF;

  will_be_super_admin := NEW.is_super_admin;

  -- フェーズ2: is_admin / group_id（部署内権限・所属）
  IF NEW.is_admin IS DISTINCT FROM old_is_admin
     OR NEW.group_id IS DISTINCT FROM old_group_id THEN

    IF acting_super_admin OR will_be_super_admin THEN
      NULL; -- super-admin（既存 or フェーズ1で自己昇格した本人）は自由に変更可
    ELSIF public.current_member_is_admin() THEN
      NULL; -- 部署管理者は変更可（部署越境はRLSが別途ブロック）
    ELSE
      SELECT count(*) INTO dept_admin_count
      FROM public.members
      WHERE group_id = check_group_id
        AND is_admin = true
        AND is_deleted = false;

      IF dept_admin_count = 0 THEN
        NULL; -- 部署ブートストラップ：その部署にis_admin=trueが1人もいなければ許可
      ELSE
        NEW.is_admin  := old_is_admin;
        NEW.group_id  := old_group_id;
      END IF;
    END IF;
  END IF;

  -- フェーズ3（複数部署アクセス。migration 20260722b）: group_ids（追加部署アクセス）
  -- 直接付与・剥奪はsuper-admin限定。非super-adminがホーム部署(group_id)を付け替えた場合
  -- （部署ブートストラップ含む）・新規作成時は、group_idsを新ホーム部署のみにリセットする
  -- （追記のまま残すと部署admin経由で複数部署アクセスを迂回的に付与できる抜け穴になるため）。
  -- NEW.group_id はフェーズ2で既に最終確定済み（差し戻された場合は old_group_id と一致）。
  IF acting_super_admin OR will_be_super_admin THEN
    NULL; -- super-adminは自由に付与・剥奪可（末尾の正規化で group_id 包含だけ保証する）
  ELSIF TG_OP = 'INSERT' OR NEW.group_id IS DISTINCT FROM old_group_id THEN
    NEW.group_ids := CASE WHEN NEW.group_id IS NULL THEN '{}'::text[] ELSE ARRAY[NEW.group_id] END;
  ELSE
    NEW.group_ids := old_group_ids; -- 非super-adminによるgroup_ids自体の直接変更は差し戻す
  END IF;

  -- 常に NEW.group_id が NEW.group_ids に含まれるよう最終正規化する（安全網）
  IF NEW.group_id IS NOT NULL AND NOT (NEW.group_id = ANY(COALESCE(NEW.group_ids, '{}'::text[]))) THEN
    NEW.group_ids := array_append(COALESCE(NEW.group_ids, '{}'::text[]), NEW.group_id);
  END IF;

  RETURN NEW;
END;
$fn_guard$;

DROP TRIGGER IF EXISTS trg_members_guard_privilege ON members;
CREATE TRIGGER trg_members_guard_privilege
  BEFORE INSERT OR UPDATE ON members
  FOR EACH ROW EXECUTE FUNCTION guard_member_privilege_columns();

-- groups：非空の部署はsuper-admin以外は論理削除できない（クライアント側の
-- memberCount>0チェックだけだとAPI直叩きで回避できるため、DB側にも安全装置を置く）
CREATE OR REPLACE FUNCTION guard_group_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_guard_group_del$
DECLARE
  active_member_count integer;
BEGIN
  IF NEW.is_deleted = true AND OLD.is_deleted = false THEN
    IF public.current_member_is_super_admin() THEN
      RETURN NEW; -- super-adminは非空の部署でも強制削除可（統廃合用途）
    END IF;

    -- group_id = OLD.id：ホーム部署としてこの部署に所属。OLD.id = ANY(group_ids)：追加部署
    -- アクセスとしてのみこの部署に所属（migration 20260722b で判定条件を拡張）。
    SELECT count(*) INTO active_member_count
    FROM public.members
    WHERE (group_id = OLD.id OR OLD.id = ANY(group_ids))
      AND is_deleted = false;

    IF active_member_count > 0 THEN
      RAISE EXCEPTION
        'このグループには % 名のアクティブなメンバー（追加部署アクセスとして所属する人を含む）がいるため削除できません（全社スーパー管理者のみ強制削除可）',
        active_member_count
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn_guard_group_del$;

DROP TRIGGER IF EXISTS trg_groups_guard_deletion ON groups;
CREATE TRIGGER trg_groups_guard_deletion
  BEFORE UPDATE ON groups
  FOR EACH ROW EXECUTE FUNCTION guard_group_deletion();

-- ============================================================
-- オンボーディング経路の是正（M25対応。migration 20260722）
--
-- RLSは「自分のgroup_idと一致するか、super-adminか」でしか可視性を判定できないため、
-- 未登録の認証ユーザーには members が0件に見える。これは「本当にシステムが空
-- （初回セットアップ）」なのか「自分に権限が無いだけ」なのかクライアント側では
-- 区別できない。この2関数でサーバー側に判定・処理を寄せる。
-- ============================================================

-- 「アクティブなmembersが1件でも存在するか」だけを返す（真偽値のみ・情報漏洩を最小化）。
-- 未登録の認証ユーザーからも呼べる必要があるため GRANT EXECUTE TO authenticated。
CREATE OR REPLACE FUNCTION public.is_system_bootstrapped()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER STABLE
SET search_path = ''
AS $fn_is_bootstrapped$
  SELECT EXISTS (SELECT 1 FROM public.members WHERE is_deleted = false)
$fn_is_bootstrapped$;

GRANT EXECUTE ON FUNCTION public.is_system_bootstrapped() TO authenticated;

-- 「membersが0件のときに限り」部署＋最初のメンバー（is_admin=true かつ
-- is_super_admin=true）を作成する。通常のクライアントINSERTはgroups_insert_admin
-- ポリシー（super-admin限定）に阻まれるため、真の初回セットアップ専用の抜け道。
-- 【安全性の要】関数内の「membersが0件」ガードが、2回目以降にこの関数が呼ばれて
-- 誰でもsuper_adminになれてしまう穴を防ぐ唯一の防波堤。emailはクライアントの引数
-- からではなく必ずauth.email()から取得する（なりすまし防止）。
CREATE OR REPLACE FUNCTION public.bootstrap_first_group_and_member(
  p_group_name   text,
  p_display_name text,
  p_short_name   text,
  p_initials     text,
  p_color_bg     text,
  p_color_text   text
)
RETURNS TABLE(group_id text, member_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_bootstrap$
DECLARE
  v_email        text;
  v_group_id     text;
  v_member_id    text;
  v_active_count integer;
BEGIN
  -- 同時に2つのブートストラップ呼び出しが走るTOCTOUレースを防ぐアドバイザリロック
  -- （真の初回セットアップは通常1人しか行わないため実運用上のボトルネックにはならない）。
  PERFORM pg_advisory_xact_lock(hashtext('bootstrap_first_group_and_member'));

  SELECT count(*) INTO v_active_count FROM public.members WHERE is_deleted = false;
  IF v_active_count > 0 THEN
    RAISE EXCEPTION 'システムは既に初期化済みのため、ブートストラップは実行できません'
      USING ERRCODE = 'check_violation';
  END IF;

  v_email := auth.email();
  IF v_email IS NULL THEN
    RAISE EXCEPTION '認証されたメールアドレスが取得できません' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF coalesce(trim(p_group_name), '') = '' THEN
    RAISE EXCEPTION '部署名を入力してください' USING ERRCODE = 'check_violation';
  END IF;
  IF coalesce(trim(p_display_name), '') = '' OR coalesce(trim(p_short_name), '') = '' THEN
    RAISE EXCEPTION '表示名・略称を入力してください' USING ERRCODE = 'check_violation';
  END IF;

  v_group_id  := 'grp-' || replace(gen_random_uuid()::text, '-', '');
  v_member_id := gen_random_uuid()::text;

  INSERT INTO public.groups (id, name, updated_by)
  VALUES (v_group_id, trim(p_group_name), v_member_id);

  INSERT INTO public.members (
    id, display_name, short_name, initials, teams_account, email,
    is_admin, is_super_admin, group_id, color_bg, color_text,
    is_deleted, updated_by
  ) VALUES (
    v_member_id, trim(p_display_name), trim(p_short_name), p_initials, '', v_email,
    true, true, v_group_id, p_color_bg, p_color_text,
    false, v_member_id
  );

  RETURN QUERY SELECT v_group_id, v_member_id;
END;
$fn_bootstrap$;

GRANT EXECUTE ON FUNCTION public.bootstrap_first_group_and_member(text, text, text, text, text, text) TO authenticated;

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
CREATE INDEX IF NOT EXISTS idx_project_analyses_project_id_created_at ON project_analyses(project_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_kr_meeting_notes_kr_week     ON kr_meeting_notes(kr_id, week_start)      WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_kr_meeting_notes_kr_id_week        ON kr_meeting_notes(kr_id, week_start DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_kr_note_tf_entries_note_id         ON kr_note_tf_entries(note_id);
CREATE INDEX IF NOT EXISTS idx_okr_analyses_kr_id_created          ON okr_analyses(kr_id, created_at DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_okr_analyses_objective_id_created   ON okr_analyses(objective_id, created_at DESC) WHERE is_deleted = false;
CREATE UNIQUE INDEX IF NOT EXISTS uq_kr_reports_kr_week_mode        ON kr_reports(kr_id, week_start, mode) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_kr_reports_kr_id_week               ON kr_reports(kr_id, week_start DESC) WHERE is_deleted = false;

-- task_dependencies（B1）：同一ペアの重複防止（論理削除は除外し、削除後の再追加を許す）
CREATE UNIQUE INDEX IF NOT EXISTS uq_task_dependencies_pair
  ON task_dependencies(predecessor_task_id, successor_task_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_task_dependencies_successor
  ON task_dependencies(successor_task_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_task_dependencies_predecessor
  ON task_dependencies(predecessor_task_id) WHERE is_deleted = false;
