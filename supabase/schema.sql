-- ============================================================
-- グループ計画管理アプリ スキーマ定義（統合版）
-- 最終更新: 2026-07-27
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
-- プロジェクト招待用の部署かどうか（migrations/20260810_add_project_invites.sql）。
-- true の部署はcreate_project_invite()が対象PJごとに1つ作る「招待用の部署」で、
-- 通常の部署（is_admin/is_super_admin付与の対象になる通常運用の組織）とは区別する。
ALTER TABLE groups ADD COLUMN IF NOT EXISTS is_invite_group boolean NOT NULL DEFAULT false;

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
-- 【死蔵ぎみ・2026-08-07追記】2026-05-26のTF四半期判定モデル移行（→task_forces.quarter列）
-- 以降、この行を画面が読み取って表示することは無い。OKR PDF取込（OkrImportModal）が
-- 「四半期OKR」を選択したときに記録目的の骨組みとして1件だけ作成する“書き込みのみ”の
-- 経路が唯一残っている（読み取りは無し。docs/REFACTORING.md M24・CLAUDE.md Section 1.6）。
-- 取込機能を壊すため物理削除・書き込み経路の撤去はしない。新規に参照を追加しないこと。
-- 【v3.39追記】起動時フェッチ（fetchOkrData/Phase 2）からも除外済み（appStore.tsに
-- 読み取り用stateも持たない。CLAUDE.md Section 19）。全員に黙ってダウンロードさせない。
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
-- 【死蔵・2026-08-07追記】2026-05-26のTF四半期判定モデル移行（→task_forces.quarter列）
-- 以降、読み書きとも参照されない（appStore.ts/store.ts側の未使用state・アクション・
-- fetchは2026-08-07に削除済み。docs/REFACTORING.md M24）。テーブル自体は物理削除しない
-- （Section 4・過去データが残っている可能性があるため）。新規に参照を追加しないこと。
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
  -- 【2026-08-19・v3.80で判明・是正】この宣言は最初からtext[]だったが、実DBは
  -- uuid[]のままドリフトしていた（2026-08-18のv3.75適用失敗の原因。
  -- 20260819b_fix_owner_member_ids_type.sqlで実DBをtext[]に是正済み）。
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
-- 【drift是正・2026-08-18】PJに参加するメンバーID配列（オーナーとは別の「関与者」）。
-- migrations/20260515_add_project_member_ids.sql で本番に適用済みだったが、このファイル
-- （参照用の統合スキーマ）への反映が漏れていた（CLAUDE.md記載の「CLIで管理されていない
-- 手動適用マイグレーションがある」ドリフトの一例）。20260818_harden_invite_related_rls.sql の
-- visible_project_member_ids() がこの列を参照するために今回気づいて追記した。
ALTER TABLE projects ADD COLUMN IF NOT EXISTS member_ids text[] NOT NULL DEFAULT '{}';

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
  output_tokens     integer NOT NULL DEFAULT 0,
  -- ゲスト（サンプル閲覧）のAI利用かどうか（migrations/20260807_add_guest_ai_quota.sql）。
  -- ゲスト分は member_id='__guest__'（src/lib/guestMode.ts の GUEST_MEMBER_ID）で
  -- Edge Function がサービスロールで記録する。管理画面「AI使用量」タブの表示分けに使う。
  is_guest          boolean NOT NULL DEFAULT false
);

-- ===== ゲストAI利用回数の日次カウンタ（migrations/20260807_add_guest_ai_quota.sql）=====
-- ブラウザ別（＝匿名Authユーザー別）と全体（コストの天井）の2本。しきい値の数字は
-- ここには持たない（Edge Function側の定数1箇所で管理。consume_guest_ai_quota()参照）。
CREATE TABLE IF NOT EXISTS guest_ai_usage_daily (
  usage_date    date NOT NULL,
  anon_user_id  uuid NOT NULL,
  call_count    integer NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (usage_date, anon_user_id)
);

CREATE TABLE IF NOT EXISTS guest_ai_usage_global_daily (
  usage_date  date PRIMARY KEY,
  call_count  integer NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now()
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

-- ===== ローディング画面のヒント（migrations/20260727_add_loading_tips.sql 参照）=====
-- 全社共通の1テーブル（group_id を持たない）。読み取りは authenticated 全員、
-- 書き込みは全社スーパー管理者のみ（下部のRLSブロック参照）。
CREATE TABLE IF NOT EXISTS loading_tips (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL DEFAULT '',
  body        text NOT NULL,
  sort_order  integer NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  is_deleted  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text NOT NULL DEFAULT '',
  deleted_at  timestamptz,
  deleted_by  text
);

-- ===== マイページ（ウィジェット）レイアウト（migrations/20260727b_add_member_widget_layouts.sql 参照）=====
-- 個人所有データ（member_id が主キー）。所有者本人しかアクセスしないため group_id
-- （部署スコープ）は持たない。RLSは current_member_id() ヘルパー（下部で定義）で
-- 本人のみに限定する。
CREATE TABLE IF NOT EXISTS member_widget_layouts (
  member_id   text PRIMARY KEY REFERENCES members(id),
  layout      jsonb NOT NULL DEFAULT '{"version":1,"widgets":[]}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text NOT NULL DEFAULT ''
);

-- ===== クォーター計画（KrQuarterPlanPanel。OKRモード再設計 Phase 1 Step C・
--        migrations/20260807c_add_kr_quarter_plans.sql 参照）=====
-- 元はlocalStorageのみ（quarterPlanStore.ts）だったものを2026-08-07にSupabase移行。
-- KRに紐づくチーム（マネージャー）の資産のため、personal_kr系（本人のみ）とは異なり
-- 部署スコープ（group_id列。key_results経由でトリガーが自動注入）でRLSする。判断理由・
-- 「1つの(kr_id,quarter)につきアクティブな計画は最大1件」制約の理由はmigrationファイル
-- 冒頭コメント参照。
CREATE TABLE IF NOT EXISTS kr_quarter_plans (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kr_id         text NOT NULL REFERENCES key_results(id),
  group_id      text REFERENCES groups(id),  -- key_results経由でトリガーが自動注入。フロントは送らない
  quarter       text NOT NULL,                -- 例: "2026-3Q"（krQuarterPlanPrompt.tsの表現をそのまま）
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'finalized')),
  summary       text NOT NULL DEFAULT '',
  tfs           jsonb NOT NULL DEFAULT '[]'::jsonb,  -- ProposedTF[]をそのまま丸ごと保存（正規化しない）
  overall_risk  text,
  is_deleted    boolean NOT NULL DEFAULT false,
  deleted_at    timestamptz,
  deleted_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text NOT NULL DEFAULT ''
);
-- 「1つの(kr_id, quarter)につきアクティブな計画は最大1件」（localStorageの単一キー上書きと同じ制約）
CREATE UNIQUE INDEX IF NOT EXISTS kr_quarter_plans_active_unique
  ON kr_quarter_plans (kr_id, quarter)
  WHERE is_deleted = false;

DROP TRIGGER IF EXISTS trg_kr_quarter_plans_updated_at ON kr_quarter_plans;
CREATE TRIGGER trg_kr_quarter_plans_updated_at
  BEFORE UPDATE ON kr_quarter_plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ===== 個人OKR層（OKRモード再設計 Phase 1 Step A・migrations/20260807b_add_personal_okr.sql 参照）=====
-- Kintoneが正本・このアプリはKintoneに存在しない「週の層」を埋める実行層（docs/dev/okr-redesign-plan.md）。
-- 本人のみRLS（member_id/親を辿るpersonal_kr_owner_member_id等。下部のRLSブロック参照）。
CREATE TABLE IF NOT EXISTS personal_krs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id        text NOT NULL REFERENCES members(id),
  group_id         text NOT NULL REFERENCES groups(id),
  fiscal_year      integer NOT NULL,
  quarter          text NOT NULL CHECK (quarter IN ('1Q','2Q','3Q','4Q')),
  kr_kind          text NOT NULL CHECK (kr_kind IN ('group_kr','general','company_common','om_common','agm_common','leader_common')),
  key_result_id    text REFERENCES key_results(id),
  task_force_id    text REFERENCES task_forces(id),
  label            text NOT NULL,
  weight_pct       numeric NOT NULL DEFAULT 0,
  category         text,
  activity         text,
  strength_role    text,
  weakness_role    text,
  criteria         text,
  supplement       text,
  display_order    integer NOT NULL DEFAULT 0,
  imported_at      timestamptz,
  source_label     text,
  is_deleted       boolean NOT NULL DEFAULT false,
  deleted_at       timestamptz,
  deleted_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS personal_kr_months (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  personal_kr_id         uuid NOT NULL REFERENCES personal_krs(id),
  month                  date NOT NULL,
  month_index            integer NOT NULL CHECK (month_index IN (1,2,3)),
  positioning            text,
  activities             text,
  target_and_evidence    text,
  risks                  text,
  band_target            integer CHECK (band_target IS NULL OR band_target IN (60,70,80,90,100)),
  band_override          integer CHECK (band_override IS NULL OR band_override IN (60,70,80,90,100)),
  band_override_by       text REFERENCES members(id),
  band_override_at       timestamptz,
  weight_override_pct    numeric,
  review_text            text,
  self_eval_pct          numeric,
  gm_eval_pct            numeric,
  gm_comment             text,
  imported_at            timestamptz,
  source_label           text,
  is_deleted             boolean NOT NULL DEFAULT false,
  deleted_at             timestamptz,
  deleted_by             text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             text NOT NULL DEFAULT '',
  UNIQUE (personal_kr_id, month)
);

-- ★週の目標状態。week_indexの上限は6（1〜5ではない）：既存カレンダー週アルゴリズム
-- （src/lib/date/monthWeeks.ts）は月初の曜日次第で6週になる月が実在する（例：2026年8月）。
-- 詳細はmigrations/20260807b_add_personal_okr.sqlの冒頭コメント参照。
CREATE TABLE IF NOT EXISTS personal_kr_weeks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  personal_kr_id   uuid NOT NULL REFERENCES personal_krs(id),
  month            date NOT NULL,
  week_index       integer NOT NULL CHECK (week_index BETWEEN 1 AND 6),
  week_start       date NOT NULL,
  week_end         date NOT NULL,
  goal_state       text,
  self_rating      text CHECK (self_rating IS NULL OR self_rating IN ('o','t','x')),
  rated_at         timestamptz,
  note             text,
  is_deleted       boolean NOT NULL DEFAULT false,
  deleted_at       timestamptz,
  deleted_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       text NOT NULL DEFAULT '',
  UNIQUE (personal_kr_id, month, week_index),
  CONSTRAINT personal_kr_weeks_date_range_check CHECK (week_end >= week_start)
);

-- 週とタスクの紐づけ（多対多・物理削除でよい中間テーブル。task_task_forces等と同型）
CREATE TABLE IF NOT EXISTS personal_kr_week_tasks (
  week_id    uuid NOT NULL REFERENCES personal_kr_weeks(id),
  task_id    text NOT NULL REFERENCES tasks(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (week_id, task_id)
);

-- KRごとのメモ（追記型）。member_idは著者列（監査用）。RLSの根拠にはしない（下部参照）
CREATE TABLE IF NOT EXISTS personal_kr_memos (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  personal_kr_id   uuid NOT NULL REFERENCES personal_krs(id),
  member_id        text NOT NULL REFERENCES members(id),
  body             text NOT NULL,
  is_deleted       boolean NOT NULL DEFAULT false,
  deleted_at       timestamptz,
  deleted_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       text NOT NULL DEFAULT ''
);

-- AI解析の結果とキャッシュ（migrations/20260811_add_personal_kr_outlooks.sql）。履歴として積む
-- （UPDATEしない・updated_at列を持たない）。personal_kr_id→personal_krsの所有者判定は既存の
-- personal_kr_owner_member_id()を再利用する（新しいヘルパー関数は増やさない）。Phase 3前半時点
-- ではこのテーブルへの書き込みは無い（AI呼び出しはPhase 3後半で実装）。
CREATE TABLE IF NOT EXISTS personal_kr_outlooks (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  personal_kr_id     uuid NOT NULL REFERENCES personal_krs(id),
  month              date NOT NULL,
  input_fingerprint  text NOT NULL,
  outlook_json       jsonb NOT NULL,
  band_ai            integer CHECK (band_ai IS NULL OR band_ai IN (60,70,80,90,100)),
  band_ai_reason     text,
  model              text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- 月末の振り返り下書き（migrations/20260820_add_personal_kr_review_drafts.sql・Phase 4）。
-- 🔴 personal_kr_outlooksと違い、AI生成（insert）は履歴として積むが、人の編集
-- （edited_text/edited_at）だけは直近行をUPDATEする（updated_atトリガーは貼らない）。
-- personal_kr_id→personal_krsの所有者判定は既存のpersonal_kr_owner_member_id()を
-- 再利用する（新しいヘルパー関数は増やさない）。
CREATE TABLE IF NOT EXISTS personal_kr_review_drafts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  personal_kr_id     uuid NOT NULL REFERENCES personal_krs(id),
  month              date NOT NULL,
  input_fingerprint  text NOT NULL,
  draft_json         jsonb NOT NULL,
  edited_text        text,
  edited_at          timestamptz,
  model              text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- ===== プロジェクト招待（部署外メンバーの受け入れ。migrations/20260810_add_project_invites.sql）=====
-- 正本：docs/dev/project-invite-plan.md。RLSはSELECTのみ（CLAUDE.md新セクション参照）。
-- 書き込みはcreate_project_invite()/accept_project_invite()（SECURITY DEFINER）経由のみ。
CREATE TABLE IF NOT EXISTS project_invites (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          text NOT NULL REFERENCES projects(id),
  invite_group_id     text NOT NULL REFERENCES groups(id),
  invited_email       text NOT NULL,  -- 正規化済み（lower/trim）。検証条件3の照合先
  code_hash           text NOT NULL,  -- 平文コードは保存しない。sha256(コード)のhex表現
  invited_by          text NOT NULL REFERENCES members(id),
  expires_at          timestamptz NOT NULL,
  accepted_at         timestamptz,
  accepted_member_id  text REFERENCES members(id),
  revoked_at          timestamptz,   -- Phase 2で取り消し機能を実装する（今回は列のみ）
  revoked_by          text REFERENCES members(id),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_invites_code_hash ON project_invites(code_hash);
CREATE INDEX IF NOT EXISTS idx_project_invites_project_id ON project_invites(project_id);
CREATE INDEX IF NOT EXISTS idx_project_invites_invited_by ON project_invites(invited_by);

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
    ('okr_analyses'), ('kr_reports'), ('task_dependencies'),
    ('loading_tips'), ('member_widget_layouts'),
    ('personal_krs'), ('personal_kr_months'), ('personal_kr_weeks'), ('personal_kr_memos')
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
ALTER TABLE loading_tips               ENABLE ROW LEVEL SECURITY;
-- ※ loading_tips の個別ポリシーは current_member_is_super_admin() を参照するため、
--   ヘルパー関数の定義より後（下部の「ローディング画面のヒント」ブロック）で作成する。
ALTER TABLE member_widget_layouts      ENABLE ROW LEVEL SECURITY;
-- ※ member_widget_layouts の個別ポリシーは current_member_id() を参照するため、
--   ヘルパー関数の定義より後（下部の「マイページ（ウィジェット）レイアウト」ブロック）で作成する。
ALTER TABLE personal_krs               ENABLE ROW LEVEL SECURITY;
ALTER TABLE personal_kr_months         ENABLE ROW LEVEL SECURITY;
ALTER TABLE personal_kr_weeks          ENABLE ROW LEVEL SECURITY;
ALTER TABLE personal_kr_week_tasks     ENABLE ROW LEVEL SECURITY;
ALTER TABLE personal_kr_memos          ENABLE ROW LEVEL SECURITY;
-- ※ 個人OKR層5テーブルの個別ポリシーは current_member_id() 等を参照するため、
--   ヘルパー関数の定義より後（下部の「個人OKR層」ブロック）で作成する。
ALTER TABLE personal_kr_outlooks       ENABLE ROW LEVEL SECURITY;
-- ※ personal_kr_outlooks の個別ポリシーも同様に、ヘルパー関数（personal_kr_owner_member_id）の
--   定義より後（下部の「個人OKR層」ブロック）で作成する（migrations/20260811_add_personal_kr_outlooks.sql）。
ALTER TABLE personal_kr_review_drafts  ENABLE ROW LEVEL SECURITY;
-- ※ personal_kr_review_drafts の個別ポリシーも同様に、ヘルパー関数の定義より後
--   （下部の「個人OKR層」ブロック）で作成する（migrations/20260820_add_personal_kr_review_drafts.sql）。
ALTER TABLE project_invites             ENABLE ROW LEVEL SECURITY;
-- ※ project_invites の個別ポリシー（SELECTのみ）は can_access_group_ids()/member_group_ids()
--   を参照するため、ヘルパー関数の定義より後（下部の「PJ・タスク周辺（子）テーブル」ブロック）
--   で作成する（migrations/20260810_add_project_invites.sql）。
ALTER TABLE guest_ai_usage_daily        ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest_ai_usage_global_daily ENABLE ROW LEVEL SECURITY;
-- ※ guest_ai_usage_daily / guest_ai_usage_global_daily は個別ポリシーを一切作らない
--   （=authenticated/anonからは常にアクセス不可。service_role/postgresはRLSを迂回するため
--   consume_guest_ai_quota()からは問題なく読み書きできる。migrations/20260807_add_guest_ai_quota.sql）。

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

-- プロジェクト招待（migration 20260810c_extend_members_visibility_for_invites.sql）：
-- 自分がアクセスできるPJに紐づく「招待用部署（is_invite_group=true）」のidの配列を返す。
-- current_member_group_ids()・can_access_group_ids()と同じSECURITY DEFINERの流儀。
-- groups/projectsを直接SELECTするのはproject_group_ids()等（下部）と同じ先例に倣う
-- （SECURITY DEFINERなのでRLSを迂回して判定材料を集める。意図的）。
CREATE OR REPLACE FUNCTION public.visible_invite_group_ids()
RETURNS text[]
LANGUAGE sql
SECURITY DEFINER STABLE
SET search_path = ''
AS $fn_visible_invite_groups$
  SELECT coalesce(array_agg(DISTINCT g.id), ARRAY[]::text[])
  FROM public.groups g
  JOIN public.projects p ON g.id = ANY(p.group_ids)
  WHERE g.is_invite_group = true
    AND p.group_ids && public.current_member_group_ids()
$fn_visible_invite_groups$;
GRANT EXECUTE ON FUNCTION public.visible_invite_group_ids() TO authenticated;

-- members / projects / tasks：group_ids（アクセス可能な部署の全リスト）が自分の
-- group_ids と1つでも重なるか、またはsuper-adminなら部署をまたいで許可
-- （migration 20260722b で group_id 単一値比較 → 配列オーバーラップに置き換え）
--
-- 🔴 members のみ、20260810cで3つ目のOR条項（招待用部署の可視性）を追加した。
-- 既存2条項（group_ids && current_member_group_ids() / current_member_is_super_admin()）は
-- 1文字も変更していない。projects/tasksのgroup_ids比較には広げない
-- （広げるのは「招待用部署に属する人」の可視性だけ。CLAUDE.md Section 25参照）。
--
-- 【2026-08-18・v3.75・migration 20260818_harden_invite_related_rls.sql で全面差し替え】
-- FOR ALL かつ WITH CHECK 省略のポリシー（このUSING一本）は、USING式が書き込み
-- （INSERT/UPDATE）の認可にも流用されてしまっていた（PostgreSQLの仕様。CLAUDE.md
-- Section 33参照）。SELECT用（members_select）と書き込み用（members_write_insert/
-- update/delete）の4本に分割する。可視性（SELECT）は既存3条項に加え、招待受諾者から
-- PJ参加者全員が見えるようにする4条項目（visible_project_member_ids()）を新設した
-- （山本さんの追加要望・本番の羅針盤フォーラムPJで実害発生）。書き込み側には
-- 4条項目を一切足さない（可視性の拡張が書き込み権限も兼ねてしまう、という今回の
-- 事故と同型の誤りを繰り返さないため）。書き込み側は3条項目（招待用部署ごしに
-- 見えているだけの行）に限り「部署管理者 or 全社スーパー管理者」を課す
-- （v3.60の「部署管理者が招待受諾者を編集できる」はこれで維持される）。
--
-- 【visible_project_member_ids()：can_access_group_ids()を使わずインライン展開する理由】
-- 意味はcan_access_group_ids()と同一（group_ids && current_member_group_ids() OR
-- current_member_is_super_admin()）だが、can_access_group_ids()自体の定義は
-- このファイルの後方（「PJ・タスク周辺（子）テーブルの部署スコープ」節）にあるため、
-- ここで呼ぶと前方参照エラーになる。visible_invite_group_ids()と同じ理由で
-- インライン展開している。
--
-- 【「参加しているメンバー」の定義】src/lib/project/projectMembers.ts の
-- computeProjectMembers()の実際の呼び出し（ProjectSettingsModal.tsx）と
-- ProjectKarte.tsx の pjAllMembers（"AI分析に渡す「このPJに関わる全員」＝オーナー＋
-- メンバー＋タスク担当者の和集合"）で共通する集合：owner_member_id／owner_member_ids／
-- projects.member_ids／そのPJに紐づくタスクの assignee_member_id・assignee_member_ids
-- （project_id直接紐づき ＋ task_projects経由の追加PJ紐づけの両方）。is_deleted=falseの
-- PJ・タスクのみを対象にする。
--
-- 【意図的に受け入れる副作用】部署をまたぐPJでは、他部署のメンバー同士も相互に
-- 見えるようになる（同じPJの参加者に限る）。「部署間の素の可視性は広げない」という
-- 既存の設計原則からの意図的な緩和（山本さん承認済み）。PJを共有しない他部署の
-- メンバーは引き続き見えない。
--
-- 【2026-08-19・v3.81・migration 20260819d_optimize_visible_project_member_ids.sql で
-- 本文差し替え】旧実装は8ブランチ（実際に数えると7ブランチ）のUNIONで構成され、
-- 各ブランチが独立にprojects（一部はtasksとのJOIN）を走査し、各ブランチのWHERE句の
-- 中でcurrent_member_group_ids()/current_member_is_super_admin()を呼んでいた。
-- 実測（本番）でこの関数自体がInitPlanとして1回しか呼ばれていないのに53.9ms・
-- shared hit=730かかっており、呼び出し回数ではなく中身が重いことが分かった。
-- ctx CTE（自分の所属情報を1回だけ評価）・accessible_projects CTE（MATERIALIZED・
-- アクセス可能な削除されていないPJを1回だけ作る）を新設し、オーナー系3ブランチは
-- そこから取る。tasksの走査は「project_id直接」「task_projects経由」の2系統に絞り、
-- 各系統内の単数/複数担当者を配列結合してから1回unnestする形に統合した
-- （旧4ブランチ→新2ブランチ）。返る集合は1要素も変えていない（詳細な対応表・
-- 走査回数の変化はmigrationファイルのコメント参照）。
--
-- 🔴 【統括レビューで訂正】ctx にも AS MATERIALIZED が必須。PostgreSQL 12以降は
-- 「参照が1回だけ」かつ「volatile関数を含まない」非再帰CTEを既定でインライン展開
-- する。ctx は accessible_projects からしか参照されず、中の関数もSTABLE（volatile
-- ではない）ため、MATERIALIZEDが無いと既定でインライン展開され、展開後はprojectsの
-- 行ごとに関数が再評価される（v3.80で実測・確定した挙動そのもの。Section 39）。
DROP POLICY IF EXISTS "authenticated full access" ON members;
DROP POLICY IF EXISTS "members_group" ON members;
DROP POLICY IF EXISTS "members_select" ON members;
DROP POLICY IF EXISTS "members_write_insert" ON members;
DROP POLICY IF EXISTS "members_write_update" ON members;
DROP POLICY IF EXISTS "members_write_delete" ON members;

CREATE OR REPLACE FUNCTION public.visible_project_member_ids()
RETURNS text[]
LANGUAGE sql
SECURITY DEFINER STABLE
SET search_path = ''
AS $fn_visible_pj_members$
  WITH ctx AS MATERIALIZED (
    SELECT
      public.current_member_group_ids() AS gids,
      public.current_member_is_super_admin() AS is_super
  ),
  accessible_projects AS MATERIALIZED (
    SELECT p.id, p.owner_member_id, p.owner_member_ids, p.member_ids
    FROM public.projects p
    CROSS JOIN ctx
    WHERE p.is_deleted = false
      AND (p.group_ids && ctx.gids OR ctx.is_super)
  )
  SELECT coalesce(array_agg(DISTINCT mid), ARRAY[]::text[])
  FROM (
    -- 旧ブランチ1: owner_member_id（単数オーナー・互換目的のFK）
    SELECT ap.owner_member_id::text AS mid
      FROM accessible_projects ap
      WHERE ap.owner_member_id IS NOT NULL
    UNION
    -- 旧ブランチ2: owner_member_ids（複数オーナー対応）
    SELECT unnest(ap.owner_member_ids)::text
      FROM accessible_projects ap
    UNION
    -- 旧ブランチ3: member_ids（PJ関与者列）
    SELECT unnest(ap.member_ids)::text
      FROM accessible_projects ap
    UNION
    -- 旧ブランチ4+5統合: project_id直接紐づきタスクの担当者（単数・複数を1回の走査で）
    SELECT unnest(
             t.assignee_member_ids::text[]
             || CASE WHEN t.assignee_member_id IS NOT NULL
                       THEN ARRAY[t.assignee_member_id::text]
                       ELSE ARRAY[]::text[]
                  END
           ) AS mid
      FROM public.tasks t
      JOIN accessible_projects ap ON ap.id = t.project_id
      WHERE t.is_deleted = false
    UNION
    -- 旧ブランチ6+7統合: task_projects経由タスクの担当者（単数・複数を1回の走査で）
    SELECT unnest(
             t.assignee_member_ids::text[]
             || CASE WHEN t.assignee_member_id IS NOT NULL
                       THEN ARRAY[t.assignee_member_id::text]
                       ELSE ARRAY[]::text[]
                  END
           ) AS mid
      FROM public.tasks t
      JOIN public.task_projects tp ON tp.task_id = t.id
      JOIN accessible_projects ap ON ap.id = tp.project_id
      WHERE t.is_deleted = false
  ) x
  WHERE mid IS NOT NULL
$fn_visible_pj_members$;
GRANT EXECUTE ON FUNCTION public.visible_project_member_ids() TO authenticated;

-- 【2026-08-19・v3.80】SECURITY DEFINER関数呼び出しを (SELECT ...) で包み、InitPlanとして
-- クエリ全体で1回だけ評価されるようにした（20260819c_optimize_members_rls_initplan.sql）。
-- 実測（本番・招待受諾者アカウント）でmembers（21行）へのSELECTがshared hit=6504・
-- Execution Time 76.085msという異常値になっており、フィルタ内の関数が行ごとに
-- 再実行されていたことが原因だった。式の意味・条項の順序・キャストは変えていない。
CREATE POLICY "members_select" ON members
  FOR SELECT TO authenticated
  USING (
    group_ids && (SELECT public.current_member_group_ids())
    OR (SELECT public.current_member_is_super_admin())
    OR group_ids && (SELECT public.visible_invite_group_ids())
    -- 🔴 ここは (SELECT ...) を裸で ANY() に渡さないこと。PostgreSQLは
    --    `x = ANY (副問い合わせ)` と `x = ANY (配列式)` を別の構文として解釈するため、
    --    裸で渡すと副問い合わせ形式になり text と text[] の比較になって
    --    `operator does not exist: text = text[]` で落ちる（2026-08-19に実際に踏んだ）。
    --    ::text[] のキャストを付けて「配列式」であることを明示する。キャスト自体は
    --    型を変えないが、これがあることで配列形式として解釈され、かつ副問い合わせは
    --    引き続き相関を持たないためInitPlanとして1回だけ評価される。
    OR id::text = ANY ((SELECT public.visible_project_member_ids())::text[])
  );

CREATE POLICY "members_write_insert" ON members
  FOR INSERT TO authenticated
  WITH CHECK (
    group_ids && (SELECT public.current_member_group_ids())
    OR (SELECT public.current_member_is_super_admin())
    OR (
      group_ids && (SELECT public.visible_invite_group_ids())
      AND ((SELECT public.current_member_is_admin()) OR (SELECT public.current_member_is_super_admin()))
    )
  );

CREATE POLICY "members_write_update" ON members
  FOR UPDATE TO authenticated
  USING (
    group_ids && (SELECT public.current_member_group_ids())
    OR (SELECT public.current_member_is_super_admin())
    OR (
      group_ids && (SELECT public.visible_invite_group_ids())
      AND ((SELECT public.current_member_is_admin()) OR (SELECT public.current_member_is_super_admin()))
    )
  )
  WITH CHECK (
    group_ids && (SELECT public.current_member_group_ids())
    OR (SELECT public.current_member_is_super_admin())
    OR (
      group_ids && (SELECT public.visible_invite_group_ids())
      AND ((SELECT public.current_member_is_admin()) OR (SELECT public.current_member_is_super_admin()))
    )
  );

CREATE POLICY "members_write_delete" ON members
  FOR DELETE TO authenticated
  USING (
    group_ids && (SELECT public.current_member_group_ids())
    OR (SELECT public.current_member_is_super_admin())
    OR (
      group_ids && (SELECT public.visible_invite_group_ids())
      AND ((SELECT public.current_member_is_admin()) OR (SELECT public.current_member_is_super_admin()))
    )
  );

DROP POLICY IF EXISTS "authenticated full access" ON projects;
DROP POLICY IF EXISTS "projects_group" ON projects;
CREATE POLICY "projects_group" ON projects FOR ALL TO authenticated
  USING (group_ids && current_member_group_ids() OR current_member_is_super_admin())
  WITH CHECK (group_ids && current_member_group_ids() OR current_member_is_super_admin());

DROP POLICY IF EXISTS "authenticated full access" ON tasks;
DROP POLICY IF EXISTS "tasks_group" ON tasks;
CREATE POLICY "tasks_group" ON tasks FOR ALL TO authenticated
  USING (group_ids && current_member_group_ids() OR current_member_is_super_admin());

-- task_dependencies（B1）のRLSは、tasks/projects同様「PJ・タスク周辺（子）テーブルの
-- 部署スコープ」節（本ファイル下部・task_group_ids()定義の直後）でtask_group_ids()を
-- 使う形に統一して定義する（2026-08-18・v3.75・Section 33参照。旧group_id単数比較は
-- そちらで置き換える）。

-- ローディング画面のヒント：読み取りは authenticated 全員（機密情報ではない）、
-- 書き込みは全社スーパー管理者のみ。部署概念を持たない全社共通マスタのため
-- group_id によるスコープはしない（migrations/20260727_add_loading_tips.sql）。
DROP POLICY IF EXISTS "authenticated full access" ON loading_tips;
DROP POLICY IF EXISTS "loading_tips_read"  ON loading_tips;
DROP POLICY IF EXISTS "loading_tips_write" ON loading_tips;
CREATE POLICY "loading_tips_read" ON loading_tips
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "loading_tips_write" ON loading_tips
  FOR ALL TO authenticated
  USING (current_member_is_super_admin())
  WITH CHECK (current_member_is_super_admin());

-- ============================================================
-- マイページ（ウィジェット）レイアウト：本人のみ読み書き可
-- （migrations/20260727b_add_member_widget_layouts.sql 参照）
-- ============================================================

-- current_member_group_id() 等（本ファイル上部）と完全に同じ流儀のヘルパー関数
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

-- 個人所有データのため group_id によるスコープはしない。NULL猶予条項は入れない
-- （20260702bの教訓＝current_member_id()がNULLなら何も見えないのが正しい挙動）。
DROP POLICY IF EXISTS "authenticated full access" ON member_widget_layouts;
DROP POLICY IF EXISTS "member_widget_layouts_own" ON member_widget_layouts;
CREATE POLICY "member_widget_layouts_own" ON member_widget_layouts
  FOR ALL TO authenticated
  USING (member_id = current_member_id())
  WITH CHECK (member_id = current_member_id());

-- ============================================================
-- 個人OKR層：本人のみ読み書き可（migrations/20260807b_add_personal_okr.sql 参照）
-- RLSの実装方式（member_id冗長列 vs 親を辿るポリシー）の判断理由は同マイグレーション
-- 冒頭コメントを参照。NULL猶予条項は一切書かない。
-- ============================================================

-- personal_kr_id → その personal_krs 行の所有者 member_id（1ホップ）
CREATE OR REPLACE FUNCTION personal_kr_owner_member_id(p_personal_kr_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER STABLE
SET search_path = ''
AS $fn_personal_kr_owner$
  SELECT member_id FROM public.personal_krs WHERE id = p_personal_kr_id
$fn_personal_kr_owner$;

GRANT EXECUTE ON FUNCTION personal_kr_owner_member_id(uuid) TO authenticated;

-- week_id → personal_kr_weeks → personal_krs の所有者 member_id（2ホップ）
CREATE OR REPLACE FUNCTION personal_kr_week_owner_member_id(p_week_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER STABLE
SET search_path = ''
AS $fn_personal_kr_week_owner$
  SELECT pk.member_id
  FROM public.personal_kr_weeks w
  JOIN public.personal_krs pk ON pk.id = w.personal_kr_id
  WHERE w.id = p_week_id
$fn_personal_kr_week_owner$;

GRANT EXECUTE ON FUNCTION personal_kr_week_owner_member_id(uuid) TO authenticated;

DROP POLICY IF EXISTS "personal_krs_own" ON personal_krs;
CREATE POLICY "personal_krs_own" ON personal_krs
  FOR ALL TO authenticated
  USING (member_id = current_member_id())
  WITH CHECK (member_id = current_member_id());

DROP POLICY IF EXISTS "personal_kr_months_own" ON personal_kr_months;
CREATE POLICY "personal_kr_months_own" ON personal_kr_months
  FOR ALL TO authenticated
  USING (personal_kr_owner_member_id(personal_kr_id) = current_member_id())
  WITH CHECK (personal_kr_owner_member_id(personal_kr_id) = current_member_id());

DROP POLICY IF EXISTS "personal_kr_weeks_own" ON personal_kr_weeks;
CREATE POLICY "personal_kr_weeks_own" ON personal_kr_weeks
  FOR ALL TO authenticated
  USING (personal_kr_owner_member_id(personal_kr_id) = current_member_id())
  WITH CHECK (personal_kr_owner_member_id(personal_kr_id) = current_member_id());

DROP POLICY IF EXISTS "personal_kr_week_tasks_own" ON personal_kr_week_tasks;
CREATE POLICY "personal_kr_week_tasks_own" ON personal_kr_week_tasks
  FOR ALL TO authenticated
  USING (personal_kr_week_owner_member_id(week_id) = current_member_id())
  WITH CHECK (personal_kr_week_owner_member_id(week_id) = current_member_id());

DROP POLICY IF EXISTS "personal_kr_memos_own" ON personal_kr_memos;
CREATE POLICY "personal_kr_memos_own" ON personal_kr_memos
  FOR ALL TO authenticated
  USING (personal_kr_owner_member_id(personal_kr_id) = current_member_id())
  WITH CHECK (
    personal_kr_owner_member_id(personal_kr_id) = current_member_id()
    AND member_id = current_member_id()
  );

-- personal_kr_outlooks（migrations/20260811_add_personal_kr_outlooks.sql）。既存の
-- personal_kr_owner_member_id() をそのまま再利用する（新しいヘルパー関数は増やさない）。
DROP POLICY IF EXISTS "personal_kr_outlooks_own" ON personal_kr_outlooks;
CREATE POLICY "personal_kr_outlooks_own" ON personal_kr_outlooks
  FOR ALL TO authenticated
  USING (personal_kr_owner_member_id(personal_kr_id) = current_member_id())
  WITH CHECK (personal_kr_owner_member_id(personal_kr_id) = current_member_id());

-- personal_kr_review_drafts（migrations/20260820_add_personal_kr_review_drafts.sql）。
-- personal_kr_outlooks_own と同型（FOR ALLでUPDATEも許可されるため、人の編集はこの
-- ポリシー1本でそのまま通る）。既存のpersonal_kr_owner_member_id()をそのまま再利用する。
DROP POLICY IF EXISTS "personal_kr_review_drafts_own" ON personal_kr_review_drafts;
CREATE POLICY "personal_kr_review_drafts_own" ON personal_kr_review_drafts
  FOR ALL TO authenticated
  USING (personal_kr_owner_member_id(personal_kr_id) = current_member_id())
  WITH CHECK (personal_kr_owner_member_id(personal_kr_id) = current_member_id());

-- ============================================================
-- ゲストAI利用回数の条件付きカウントアップ関数（Phase 3・v3.29／v3.30で条件付き加算に修正）
-- （migrations/20260807_add_guest_ai_quota.sql 参照）
-- ============================================================
-- 「上限未満のときだけ加算し、拒否ならどちらのカウンタも進めない」判定＋加算を1関数に閉じる
-- （v3.29の「無条件加算→呼び出し元で事後判定」は、拒否された試行も全体枠を消費してしまう
-- 可用性バグがあったため修正した）。しきい値はSQL側に持たず、呼び出し元のEdge Function側の
-- 定数1箇所（GUEST_AI_PER_BROWSER_DAILY_LIMIT / GUEST_AI_GLOBAL_DAILY_LIMIT）から
-- 毎回引数で渡す。authenticated/anon にはEXECUTEを渡さず、service_role（Edge Functionから）
-- だけが呼べる。

DROP FUNCTION IF EXISTS public.consume_guest_ai_quota(uuid);

CREATE OR REPLACE FUNCTION public.consume_guest_ai_quota(
  p_anon_user_id uuid,
  p_browser_limit integer,
  p_global_limit integer
)
RETURNS TABLE(allowed boolean, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_consume_guest_ai_quota$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Tokyo')::date;
  v_global_count integer;
  v_browser_count integer;
BEGIN
  -- ① 全体枠（コストの天井）を先に条件付きで加算する。上限に達していればUPDATEが起きず
  --    RETURNINGは0行（=NULL）になる。
  INSERT INTO public.guest_ai_usage_global_daily (usage_date, call_count)
  VALUES (v_today, 1)
  ON CONFLICT (usage_date) DO UPDATE
    SET call_count = public.guest_ai_usage_global_daily.call_count + 1,
        updated_at = now()
    WHERE public.guest_ai_usage_global_daily.call_count < p_global_limit
  RETURNING call_count INTO v_global_count;

  IF v_global_count IS NULL THEN
    -- 全体枠が尽きている。ブラウザ別カウンタには一切触れていないため補償は不要。
    RETURN QUERY SELECT false, 'global'::text;
    RETURN;
  END IF;

  -- ② ブラウザ別（匿名Authユーザー別）の上限を条件付きで加算する。
  INSERT INTO public.guest_ai_usage_daily (usage_date, anon_user_id, call_count)
  VALUES (v_today, p_anon_user_id, 1)
  ON CONFLICT (usage_date, anon_user_id) DO UPDATE
    SET call_count = public.guest_ai_usage_daily.call_count + 1,
        updated_at = now()
    WHERE public.guest_ai_usage_daily.call_count < p_browser_limit
  RETURNING call_count INTO v_browser_count;

  IF v_browser_count IS NULL THEN
    -- ブラウザ別の上限に達している。①で加算した全体枠を同一トランザクション内で
    -- 必ず1減算して取り消す（拒否されたリクエストがどちらのカウンタも消費しないための補償）。
    UPDATE public.guest_ai_usage_global_daily
      SET call_count = call_count - 1, updated_at = now()
      WHERE usage_date = v_today;
    RETURN QUERY SELECT false, 'per_browser'::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, 'ok'::text;
END;
$fn_consume_guest_ai_quota$;

REVOKE ALL ON FUNCTION public.consume_guest_ai_quota(uuid, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_guest_ai_quota(uuid, integer, integer) FROM authenticated;
REVOKE ALL ON FUNCTION public.consume_guest_ai_quota(uuid, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.consume_guest_ai_quota(uuid, integer, integer) TO service_role;

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
-- クォーター計画（kr_quarter_plans）の部署スコープ（migration 20260807c_add_kr_quarter_plans.sql）。
-- key_results と同じ「自前のgroup_id列＋トリガーで親から自動注入」の流儀（OKRコア階層と同型）。
-- ============================================================
CREATE OR REPLACE FUNCTION sync_kr_quarter_plan_group_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_sync_kr_quarter_plan_group_id$
BEGIN
  SELECT kr.group_id INTO NEW.group_id
  FROM public.key_results kr
  WHERE kr.id = NEW.kr_id;
  RETURN NEW;
END;
$fn_sync_kr_quarter_plan_group_id$;

DROP TRIGGER IF EXISTS trg_kr_quarter_plans_sync_group_id ON kr_quarter_plans;
CREATE TRIGGER trg_kr_quarter_plans_sync_group_id
  BEFORE INSERT OR UPDATE ON kr_quarter_plans
  FOR EACH ROW EXECUTE FUNCTION sync_kr_quarter_plan_group_id();

DROP POLICY IF EXISTS "authenticated full access" ON kr_quarter_plans;
DROP POLICY IF EXISTS "kr_quarter_plans_group" ON kr_quarter_plans;
CREATE POLICY "kr_quarter_plans_group" ON kr_quarter_plans FOR ALL TO authenticated
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

-- 【2026-08-18・v3.75・migration 20260818_harden_invite_related_rls.sql で修正】
-- task_dependencies（B1）だけが 20260722b の配列化（group_ids && ...）に追従しておらず、
-- group_id（単数・ホーム部署）比較のまま残っていた。招待受諾者（ホーム部署＝招待用
-- 部署）にはPJのタスク依存関係が1本も見えず、ガントの矢印・依存ゲート・
-- BlockedTasksWidgetが機能しない実害があった（第2部署を兼務するメンバーも同様に
-- 見えない既存バグ）。tasks.group_ids は sync_task_group_ids/
-- cascade_project_group_ids_to_tasks によりPJのgroup_ids（招待用部署を含む）が
-- 既に伝播済みのため、group_id列の値ではなく、依存関係が結ぶ両端のタスクへの
-- アクセス可否で判定する形に切り替える。task_projects_group/task_task_forces_group
-- と同じ can_access_group_ids(task_group_ids(...)) の流儀に揃え、新しいヘルパー
-- 関数は作らない（predecessor/successorの2回の呼び出しはどちらも主キー1件参照の
-- STABLE関数で、既存2ポリシーと同じコストの範囲内）。
-- 🔴 両端ともアクセスできることを要求する（AND。ORにすると見えないタスクの存在が
-- 依存線から漏れる）。あわせてFOR ALLでWITH CHECKを省略していた問題
-- （今回のv3.75で塞いでいるのと同型＝USINGが書き込み認可を兼ねる）も解消する。
-- group_id列自体は残す（NOT NULL・アプリが書いている）が、RLSの判定材料としては
-- 使わない。
DROP POLICY IF EXISTS "authenticated full access" ON task_dependencies;
DROP POLICY IF EXISTS "task_dependencies_group" ON task_dependencies;
CREATE POLICY "task_dependencies_group" ON task_dependencies FOR ALL TO authenticated
  USING (
    public.can_access_group_ids(public.task_group_ids(predecessor_task_id))
    AND public.can_access_group_ids(public.task_group_ids(successor_task_id))
  )
  WITH CHECK (
    public.can_access_group_ids(public.task_group_ids(predecessor_task_id))
    AND public.can_access_group_ids(public.task_group_ids(successor_task_id))
  );

DROP POLICY IF EXISTS "authenticated full access" ON member_tag_members;
DROP POLICY IF EXISTS "member_tag_members_group" ON member_tag_members;
CREATE POLICY "member_tag_members_group" ON member_tag_members FOR ALL TO authenticated
  USING (public.can_access_group_ids(public.member_group_ids(member_id)));

DROP POLICY IF EXISTS "authenticated full access" ON admin_change_logs;
DROP POLICY IF EXISTS "admin_change_logs_group" ON admin_change_logs;
CREATE POLICY "admin_change_logs_group" ON admin_change_logs FOR ALL TO authenticated
  USING (public.can_access_group_ids(public.member_group_ids(performed_by)));

-- project_invites（migrations/20260810_add_project_invites.sql）：🔴 SELECTのみポリシー。
-- INSERT/UPDATE/DELETEのポリシーは意図的に作らない（RLSはポリシーが無いコマンドを全否定
-- する＝authenticatedからの直接書き込みは常に拒否。書き込みはcreate_project_invite()/
-- accept_project_invite()というSECURITY DEFINER関数経由のみ）。code_hashは列単位で隠せない
-- ため、クライアント側のSELECTで明示的に列を絞ることで守る
-- （src/lib/supabase/projectInviteStore.ts参照）。
--
-- 【2026-08-18・v3.75・migration 20260818_harden_invite_related_rls.sql で基準を変更】
-- 旧来は「発行者（invited_by）の所属部署」基準だった。招待を受諾した人は発行者と
-- 招待用部署を共有するため、発行者が発行した全ての招待行（他人のメールアドレス・
-- 他PJ宛を含む）が読めてしまっていた。監査に必要なのは「そのPJの関係者が、その
-- PJの招待を見られること」なので、対象PJが属する通常部署（招待用部署を除く）
-- 基準に変える。招待用部署を除く理由：除かないと、そのPJの招待用部署に属する人＝
-- 受諾者が引き続き全招待行を読めてしまい、変更した意味が無くなる。
CREATE OR REPLACE FUNCTION public.project_normal_group_ids(p_project_id text)
RETURNS text[] LANGUAGE sql SECURITY DEFINER STABLE SET search_path = ''
AS $fn_pj_normal_gids$
  SELECT coalesce(array_agg(gid), ARRAY[]::text[])
  FROM public.projects p
  CROSS JOIN LATERAL unnest(p.group_ids) AS gid
  WHERE p.id = p_project_id
    AND NOT EXISTS (
      SELECT 1 FROM public.groups g
      WHERE g.id = gid AND g.is_invite_group = true
    )
$fn_pj_normal_gids$;
GRANT EXECUTE ON FUNCTION public.project_normal_group_ids(text) TO authenticated;

DROP POLICY IF EXISTS "project_invites_select_same_dept" ON project_invites;
DROP POLICY IF EXISTS "project_invites_select_project_dept" ON project_invites;
CREATE POLICY "project_invites_select_project_dept" ON project_invites
  FOR SELECT TO authenticated
  USING (public.can_access_group_ids(public.project_normal_group_ids(project_id)));

DROP POLICY IF EXISTS "authenticated users can select" ON ai_usage_logs;
DROP POLICY IF EXISTS "ai_usage_logs_select_group" ON ai_usage_logs;
CREATE POLICY "ai_usage_logs_select_group" ON ai_usage_logs FOR SELECT TO authenticated
  USING (public.can_access_group_ids(public.member_group_ids(member_id)));

-- INSERT用ポリシー（本番には元々存在するが、一度もマイグレーション化・schema.sql化されず
-- ドリフトしていた項目。migrations/20260807_add_guest_ai_quota.sqlで是正）。
DROP POLICY IF EXISTS "authenticated users can insert" ON ai_usage_logs;
DROP POLICY IF EXISTS "ai_usage_logs_insert_authenticated" ON ai_usage_logs;
CREATE POLICY "ai_usage_logs_insert_authenticated" ON ai_usage_logs
  FOR INSERT TO authenticated
  WITH CHECK (true);

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

-- 【2026-08-18・v3.75・migration 20260818_harden_invite_related_rls.sql】
-- projects.group_ids のガードトリガー。projects のRLSはgroup_idsが自分のアクセス部署と
-- 1つでも重なれば通るため、自部署のPJに他PJの招待用部署を後から足すことができ、
-- visible_invite_group_ids()の戻り値を任意に膨らませられた（groups_selectがUSING(true)
-- のため招待用部署のidは全員が列挙できる）。非super-adminのみ、group_idsに置ける
-- 招待用部署を「そのPJ自身の招待用部署／変更前から入っていたもの／実行者が既に
-- アクセス権を持っているもの」に限り、それ以外は静かに取り除く（既存要素の削除も
-- 静かに元へ戻す）。ホーム部署(group_id)にも同じ判定をかける。エラーを投げず静かに
-- 戻す理由はguard_member_privilege_columnsと同じ（クライアントは全列まとめてupsertする
-- ため、例外にすると悪意のない普通の保存まで失敗しうる）。
-- トリガー実行順序（重要）：同じタイミング（BEFORE INSERT OR UPDATE）のトリガーは
-- 名前の昇順に実行される。normalize（trg_projects_normalize_group_ids）が先、verify
-- （trg_projects_verify_group_ids）が後（v > n）に走る必要がある（先に走ると、normalize
-- が後から不正なgroup_idをgroup_idsへ書き戻すため）。
CREATE OR REPLACE FUNCTION public.verify_project_group_ids()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_verify_pj_group_ids$
DECLARE
  own_invite_group text;
  old_ids          text[];
  actor_ids        text[];
BEGIN
  IF public.current_member_is_super_admin() THEN
    RETURN NEW;
  END IF;

  own_invite_group := 'grp-invite-' || NEW.id;
  old_ids   := CASE WHEN TG_OP = 'UPDATE' THEN coalesce(OLD.group_ids, '{}'::text[]) ELSE '{}'::text[] END;
  actor_ids := coalesce(public.current_member_group_ids(), '{}'::text[]);

  -- ③（先に判定する）ホーム部署が「許されない招待用部署」なら元に戻す。
  -- INSERTの場合は戻す先が無いのでNULLにする（結果として group_ids が空になれば
  -- projects のRLS WITH CHECK が拒否する＝素通りしない）。
  IF NEW.group_id IS NOT NULL
     AND NEW.group_id <> own_invite_group
     AND NOT (NEW.group_id = ANY(old_ids))
     AND NOT (NEW.group_id = ANY(actor_ids))
     AND EXISTS (
       SELECT 1 FROM public.groups g
       WHERE g.id = NEW.group_id AND g.is_invite_group = true
     ) THEN
    NEW.group_id := CASE WHEN TG_OP = 'UPDATE' THEN OLD.group_id ELSE NULL END;
  END IF;

  -- ① 許されない招待用部署を取り除く（通常部署には触れない）
  NEW.group_ids := ARRAY(
    SELECT gid
    FROM unnest(coalesce(NEW.group_ids, '{}'::text[])) AS gid
    WHERE gid = own_invite_group
       OR gid = ANY(old_ids)
       OR gid = ANY(actor_ids)
       OR NOT EXISTS (
            SELECT 1 FROM public.groups g
            WHERE g.id = gid AND g.is_invite_group = true
          )
  );

  -- ② 既存要素の削除を元に戻す
  IF TG_OP = 'UPDATE' THEN
    NEW.group_ids := NEW.group_ids || ARRAY(
      SELECT gid FROM unnest(old_ids) AS gid
      WHERE NOT (gid = ANY(NEW.group_ids))
    );
  END IF;

  -- CHECK制約 projects_group_id_in_group_ids を満たすための最終正規化
  -- （ここで復活しうる group_id は上の③で既に妥当性を確認済み）
  IF NEW.group_id IS NOT NULL AND NOT (NEW.group_id = ANY(NEW.group_ids)) THEN
    NEW.group_ids := array_append(NEW.group_ids, NEW.group_id);
  END IF;

  RETURN NEW;
END;
$fn_verify_pj_group_ids$;

DROP TRIGGER IF EXISTS trg_projects_verify_group_ids ON projects;
CREATE TRIGGER trg_projects_verify_group_ids
  BEFORE INSERT OR UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION public.verify_project_group_ids();

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

-- members：is_admin / group_id / is_super_admin / group_ids / email / is_deleted の
-- 自己昇格・成り代わり防止（列単位のガードは RLS では書けないためトリガーで実装。
-- INSERT/UPDATE 両方に適用＝INSERT時に他人のメールアドレスで先回りis_admin/
-- is_super_admin行を作られる穴を防ぐ。migration 20260702c で INSERT にも拡張）
--
-- 【2026-08-18・v3.75・migration 20260818_harden_invite_related_rls.sql で拡張】
-- 変更点は4つ：(a) 部署ブートストラップ猶予から招待用部署を除外（招待用部署には
-- adminを作る経路が無く、この猶予が恒久的に開いた窓になっていた） (b) email
-- （ログイン中の人とmembers行を結びつける同一性判定キー）の保護を新設
-- (c) is_deleted の false→true（論理削除）の保護を新設（有効な管理者を消せると
-- ブートストラップ猶予を人為的に開けられるため） (d) will_be_super_admin
-- （NEW.is_super_adminが真でありさえすれば真になり、「対象行が元々super-adminで
-- 今回は無変更」でも誰でもis_admin/group_id/group_ids/email/is_deletedを書き換え
-- られてしまっていた＝認可を操作される側の属性で判定していた誤り）を
-- self_bootstrap_super_admin（フェーズ1の自己ブートストラップ分岐を実際に通った
-- 時だけtrueになるdefault falseの変数）に置き換えて正す。詳細はCLAUDE.md Section 33参照。
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
  self_bootstrap_super_admin boolean := false;
  old_is_admin        boolean;
  old_is_super_admin  boolean;
  old_group_id        text;
  check_group_id      text;
  old_group_ids       text[];
  old_email           text;
  old_is_deleted      boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    old_is_admin       := false;
    old_is_super_admin := false;
    old_group_id       := NEW.group_id;
    check_group_id     := NEW.group_id;
    old_group_ids      := NULL; -- INSERTには「以前の行」が存在しない
    old_email          := NEW.email;
    old_is_deleted     := NEW.is_deleted;
  ELSE
    old_is_admin       := OLD.is_admin;
    old_is_super_admin := OLD.is_super_admin;
    old_group_id       := OLD.group_id;
    check_group_id     := OLD.group_id;
    old_group_ids      := OLD.group_ids;
    old_email          := OLD.email;
    old_is_deleted     := OLD.is_deleted;
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
        self_bootstrap_super_admin := true;
      ELSE
        NEW.is_super_admin := old_is_super_admin;
      END IF;
    END IF;
  END IF;

  -- フェーズ2: is_admin / group_id（部署内権限・所属）
  IF NEW.is_admin IS DISTINCT FROM old_is_admin
     OR NEW.group_id IS DISTINCT FROM old_group_id THEN

    IF acting_super_admin OR self_bootstrap_super_admin THEN
      NULL; -- super-admin（既存 or フェーズ1で自己昇格した本人）は自由に変更可
    ELSIF public.current_member_is_admin() THEN
      NULL; -- 部署管理者は変更可（部署越境はRLSが別途ブロック）
    ELSE
      SELECT count(*) INTO dept_admin_count
      FROM public.members
      WHERE group_id = check_group_id
        AND is_admin = true
        AND is_deleted = false;

      -- 【2026-08-18・v3.75】部署ブートストラップ猶予から招待用部署を除外する。
      -- 招待用部署（is_invite_group=true）には admin を作る経路が設計上存在せず、
      -- dept_admin_count が永久に0のままになるため、この猶予が恒久的に開いた
      -- 窓になっていた（招待受諾者が自分の行を is_admin=true にできた）。
      IF dept_admin_count = 0
         AND NOT EXISTS (
           SELECT 1 FROM public.groups g
           WHERE g.id = check_group_id AND g.is_invite_group = true
         ) THEN
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
  --
  -- 【2026-08-10・migration 20260810_add_project_invites.sql で追加】プロジェクト招待機能の
  -- 「発行権限は全メンバー」（決定事項）により、create_project_invite() が発行者本人と
  -- PJオーナーに招待用部署（is_invite_group=true）への兼務をこのトリガー経由のUPDATEで
  -- 付与する。既存ルールのままだと非super-adminによるこのUPDATEは静かに差し戻されてしまう
  -- ため、以下の3条件を全て満たす場合に限り例外的に許可する：
  --   ① create_project_invite() がトランザクションローカルで明示的に立てたセッション変数
  --      （app.allow_invite_group_grant='on'）が立っている（PostgREST経由のクライアントは
  --      生SQL実行手段が無いため直接この変数を立てられない＝この関数の内部でしか到達しない）
  --   ② 既存の所属を1件も失っていない（NEW.group_ids @> old_group_ids）
  --   ③ 追加された要素が全て is_invite_group=true のグループである
  -- coalesce(...,'')='on' は「NULL（未設定）なら安全側＝許可しない」に倒すためのもので、
  -- 認可チェックをNULLで素通りさせる猶予条項ではない（Section 1.6の教訓とは別種の判定）。
  IF acting_super_admin OR self_bootstrap_super_admin THEN
    NULL; -- super-adminは自由に付与・剥奪可（末尾の正規化で group_id 包含だけ保証する）
  ELSIF TG_OP = 'INSERT' OR NEW.group_id IS DISTINCT FROM old_group_id THEN
    NEW.group_ids := CASE WHEN NEW.group_id IS NULL THEN '{}'::text[] ELSE ARRAY[NEW.group_id] END;
  ELSIF coalesce(current_setting('app.allow_invite_group_grant', true), '') = 'on'
        AND NEW.group_ids @> old_group_ids
        AND NOT EXISTS (
          SELECT 1 FROM unnest(NEW.group_ids) AS gid
          WHERE gid <> ALL(old_group_ids)
            AND NOT EXISTS (
              SELECT 1 FROM public.groups g WHERE g.id = gid AND g.is_invite_group = true
            )
        )
  THEN
    NULL; -- 招待用部署への兼務追加のみを許可（追加分が全てis_invite_group=trueであることを検証済み）
  ELSE
    NEW.group_ids := old_group_ids; -- 非super-adminによるgroup_ids自体の直接変更は差し戻す
  END IF;

  -- 【2026-08-18・v3.75】フェーズ4: email（同一性判定キー）
  -- email は「ログイン中の人がどの members 行か」を決める唯一のキーであり
  -- （App.tsx の autoMatch() / current_member_is_admin() / current_member_id() 等）、
  -- 他人の行の email を自分のアドレスに書き換えられると、その人の権限で
  -- ログインしたのと同じ状態になる。他の特権列と同じく静かに差し戻す
  -- （表示名など他フィールドの保存は妨げない）。
  -- 許可するのは次の3つだけ：実行者がsuper-admin／実行者が部署管理者
  -- （部署越境はRLSが別途ブロック）／対象が実行者自身の行。
  -- 自分自身の行の判定は IS NOT DISTINCT FROM（email が NULL の行を
  -- 「誰の行でもある」と誤判定しないため）。
  IF TG_OP = 'UPDATE' AND NEW.email IS DISTINCT FROM old_email THEN
    IF acting_super_admin
       OR self_bootstrap_super_admin
       OR public.current_member_is_admin()
       OR old_email IS NOT DISTINCT FROM auth.email() THEN
      NULL;
    ELSE
      NEW.email := old_email;
    END IF;
  END IF;

  -- 【2026-08-18・v3.75】フェーズ5: is_deleted の false→true（論理削除）
  -- 有効な管理者を論理削除できると、フェーズ1（全社super-adminが0人なら自己昇格可）
  -- ・フェーズ2（部署adminが0人なら自己昇格可）のブートストラップ猶予を
  -- 人為的に開けられる。削除はadmin以上に限る。復元（true→false）は
  -- 誰かの権限が増える操作ではないため対象にしない。
  IF TG_OP = 'UPDATE'
     AND coalesce(NEW.is_deleted, false) = true
     AND coalesce(old_is_deleted, false) = false THEN
    IF acting_super_admin
       OR self_bootstrap_super_admin
       OR public.current_member_is_admin() THEN
      NULL;
    ELSE
      NEW.is_deleted := old_is_deleted;
      NEW.deleted_at := OLD.deleted_at;
      NEW.deleted_by := OLD.deleted_by;
    END IF;
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
-- プロジェクト招待（部署外メンバーの受け入れ。migrations/20260810_add_project_invites.sql）
-- 正本：docs/dev/project-invite-plan.md。CLAUDE.md新セクション参照。
-- ============================================================

-- 招待を発行する。🔴 全メンバーが呼べるため、関数内部の検証が実質の権限制御になる
-- （呼び出し者が対象PJにアクセスできるかの検証＋メールドメイン許可リスト）。
CREATE OR REPLACE FUNCTION public.create_project_invite(
  p_project_id text,
  p_email text
)
RETURNS TABLE(invite_id uuid, code text, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_create_project_invite$
DECLARE
  -- 🔒 許可メールドメイン。追加・変更する場合はこの配列に列挙するだけでよい（複数指定可）。
  -- 変更時はマイグレーションの再適用が必要（値がSQL内にハードコードされているため）。
  v_allowed_domains   text[] := ARRAY['amita-net.co.jp'];
  v_caller_id         text;
  v_project_name      text;
  v_project_group_ids text[];
  v_owner_member_id   text;
  v_invite_group_id   text;
  v_email_norm        text;
  v_domain            text;
  v_code              text;
  v_code_hash         text;
  v_invite_id         uuid;
  v_expires_at        timestamptz;
BEGIN
  v_caller_id := public.current_member_id();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION '招待の発行にはメンバー登録が必要です' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT p.name, p.group_ids, p.owner_member_id
    INTO v_project_name, v_project_group_ids, v_owner_member_id
  FROM public.projects p
  WHERE p.id = p_project_id AND p.is_deleted = false;

  IF v_project_name IS NULL THEN
    RAISE EXCEPTION '対象のプロジェクトが見つかりません' USING ERRCODE = 'no_data_found';
  END IF;

  -- 🔴🔴🔴 最重要：呼び出し者が対象PJにアクセスできるかを検証する。
  -- この関数はSECURITY DEFINERのためRLSを迂回する。この検証を欠くと、
  -- ログインしている全メンバーが任意のPJへのアクセスを誰にでも配れてしまう
  -- （設計書§4-4・「発行権限は全メンバー」の代償として必ず入れる安全弁の1点目）。
  IF NOT public.can_access_group_ids(v_project_group_ids) THEN
    RAISE EXCEPTION 'このプロジェクトを招待する権限がありません' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 🔴 メールドメインの許可リスト検証。「@より後ろ（最後の@以降）」を取り出し、
  -- 許可リストの要素と完全一致するかだけを見る（部分一致・前方一致・後方一致は使わない。
  -- 例："user@amita-net.co.jp.evil.com" は末尾一致だと通ってしまうため完全一致にする）。
  v_email_norm := lower(trim(coalesce(p_email, '')));
  v_domain := substring(v_email_norm from '@([^@]+)$');
  IF v_domain IS NULL OR v_domain = '' THEN
    RAISE EXCEPTION 'メールアドレスの形式が正しくありません' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT (v_domain = ANY(v_allowed_domains)) THEN
    RAISE EXCEPTION '許可されていないメールドメインです（%）', v_domain USING ERRCODE = 'check_violation';
  END IF;

  -- 招待用部署：PJごとに1つ。idをPJから決定的に導出することで、同じPJに何度招待しても
  -- 同じ部署を再利用する（設計書§4-1）。
  v_invite_group_id := 'grp-invite-' || p_project_id;

  INSERT INTO public.groups (id, name, is_invite_group, updated_by)
  VALUES (v_invite_group_id, '招待用部署: ' || v_project_name, true, v_caller_id)
  ON CONFLICT (id) DO NOTHING;

  -- 対象PJのgroup_idsに招待用部署を追加（既に含まれていれば何もしない）
  UPDATE public.projects
  SET group_ids = array_append(group_ids, v_invite_group_id)
  WHERE id = p_project_id AND NOT (v_invite_group_id = ANY(group_ids));

  -- 発行者本人・PJオーナーに招待用部署を兼務付与（担当者の氏名を招待者から見せるため。
  -- 設計書§4-2）。guard_member_privilege_columns()のフェーズ3拡張参照。
  PERFORM set_config('app.allow_invite_group_grant', 'on', true); -- トランザクションローカル

  UPDATE public.members
  SET group_ids = array_append(group_ids, v_invite_group_id)
  WHERE id = v_caller_id
    AND is_deleted = false
    AND NOT (v_invite_group_id = ANY(group_ids));

  IF v_owner_member_id IS NOT NULL AND v_owner_member_id <> v_caller_id THEN
    UPDATE public.members
    SET group_ids = array_append(group_ids, v_invite_group_id)
    WHERE id = v_owner_member_id
      AND is_deleted = false
      AND NOT (v_invite_group_id = ANY(group_ids));
  END IF;

  -- コード生成：pgcryptoに依存せず、コア組み込みのgen_random_uuid()を2回連結して
  -- 64桁の16進文字列（推測不能な値）を作る。
  v_code := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  -- ハッシュ化：pgcryptoのdigest()ではなく、pg_catalogに組み込みのsha256()を使う。
  -- 平文コードはDBに一切保存しない（戻り値として1度だけ返す）。
  v_code_hash := encode(sha256(convert_to(v_code, 'UTF8')), 'hex');
  v_expires_at := now() + interval '24 hours';

  INSERT INTO public.project_invites (
    project_id, invite_group_id, invited_email, code_hash, invited_by, expires_at
  ) VALUES (
    p_project_id, v_invite_group_id, v_email_norm, v_code_hash, v_caller_id, v_expires_at
  )
  RETURNING id INTO v_invite_id;

  RETURN QUERY SELECT v_invite_id, v_code, v_expires_at;
END;
$fn_create_project_invite$;

GRANT EXECUTE ON FUNCTION public.create_project_invite(text, text) TO authenticated;

-- 招待を受諾してmembersを作成する。🔴 検証条件は必ず全て満たす（存在/未使用/未取消・
-- 24時間以内・メール完全一致(入力値とauth.email()の両方)・コードのハッシュ照合）。
CREATE OR REPLACE FUNCTION public.accept_project_invite(
  p_code text,
  p_email text,
  p_display_name text,
  p_short_name text,
  p_initials text,
  p_color_bg text,
  p_color_text text
)
RETURNS TABLE(member_id text, group_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_accept_project_invite$
DECLARE
  v_code_hash  text;
  v_email_norm text;
  v_auth_email text;
  v_invite     record;
  v_member_id  text;
BEGIN
  v_code_hash  := encode(sha256(convert_to(coalesce(p_code, ''), 'UTF8')), 'hex');
  v_email_norm := lower(trim(coalesce(p_email, '')));
  v_auth_email := lower(trim(coalesce(auth.email(), '')));

  IF v_auth_email = '' THEN
    RAISE EXCEPTION '認証されたメールアドレスが取得できません' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 同時実行のTOCTOU対策：同じ招待コードに対する同時受諾を直列化する
  -- （bootstrap_first_group_and_member()と同じ pg_advisory_xact_lock の流儀）。
  PERFORM pg_advisory_xact_lock(hashtext(v_code_hash));

  SELECT * INTO v_invite
  FROM public.project_invites
  WHERE code_hash = v_code_hash;

  -- 🔴 検証条件1：コードが存在し、未使用・未取消であること
  IF v_invite.id IS NULL THEN
    RAISE EXCEPTION '招待コードが無効です' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_invite.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'この招待は取り消されています' USING ERRCODE = 'check_violation';
  END IF;
  IF v_invite.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'この招待は既に使用されています' USING ERRCODE = 'check_violation';
  END IF;

  -- 🔴 検証条件2：発行から24時間以内であること
  IF v_invite.expires_at <= now() THEN
    RAISE EXCEPTION '招待の有効期限が切れています' USING ERRCODE = 'check_violation';
  END IF;

  -- 🔴 検証条件3：入力メールが招待時のメールと完全一致、かつauth.email()とも一致する
  -- （なりすまし防止。bootstrap_first_group_and_member()がauth.email()を使う先例に倣う）。
  IF v_invite.invited_email IS DISTINCT FROM v_email_norm
     OR v_invite.invited_email IS DISTINCT FROM v_auth_email THEN
    RAISE EXCEPTION 'メールアドレスが招待時の宛先と一致しません' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- （検証条件4：コードのハッシュ照合は、上のSELECTのWHERE code_hash = v_code_hashに
  --  折り込まれている。ハッシュが一致しなければv_invite.idがNULLになり条件1で弾かれる）

  IF coalesce(trim(p_display_name), '') = '' OR coalesce(trim(p_short_name), '') = '' THEN
    RAISE EXCEPTION '表示名・略称を入力してください' USING ERRCODE = 'check_violation';
  END IF;

  v_member_id := gen_random_uuid()::text;

  -- 🔴 is_admin / is_super_admin は必ずfalse（ここを間違えると権限昇格の穴になる）。
  -- ホーム部署は招待用部署。フェーズ3（group_ids）はINSERTのため無条件でgroup_id込みに
  -- 正規化される（guard_member_privilege_columns()参照。招待固有のセッション変数は不要）。
  INSERT INTO public.members (
    id, display_name, short_name, initials, teams_account, email,
    is_admin, is_super_admin, group_id, color_bg, color_text,
    is_deleted, updated_by
  ) VALUES (
    v_member_id, trim(p_display_name), trim(p_short_name), coalesce(p_initials, ''), '', v_auth_email,
    false, false, v_invite.invite_group_id, coalesce(p_color_bg, '#7F77DD'), coalesce(p_color_text, '#FFFFFF'),
    false, v_member_id
  );

  -- 使用済みへの確定はWHERE句で「まだ未使用・未取消・期限内」を再確認しながら行う
  -- （advisory lockに加えた二重の安全網。ここで0行なら例外を投げ、直前のmembers INSERTも
  -- 含めてこの関数呼び出し全体がロールバックされる＝孤立行は残らない）。
  UPDATE public.project_invites
  SET accepted_at = now(), accepted_member_id = v_member_id
  WHERE id = v_invite.id
    AND accepted_at IS NULL
    AND revoked_at IS NULL
    AND expires_at > now();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'この招待は他の操作により使用済みになりました。もう一度お試しください'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN QUERY SELECT v_member_id, v_invite.invite_group_id;
END;
$fn_accept_project_invite$;

GRANT EXECUTE ON FUNCTION public.accept_project_invite(text, text, text, text, text, text, text) TO authenticated;

-- プロジェクト招待：取り消し（migrations/20260810b_add_revoke_project_invite.sql）。
-- create_project_invite()と同じ考え方で、呼び出し者が対象PJにアクセスできるかを検証する。
-- 既にaccepted_atが入っている招待は取り消せない（明示的なエラー）。
CREATE OR REPLACE FUNCTION public.revoke_project_invite(
  p_invite_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_revoke_project_invite$
DECLARE
  v_caller_id         text;
  v_project_id        text;
  v_project_group_ids text[];
  v_accepted_at       timestamptz;
  v_revoked_at        timestamptz;
BEGIN
  v_caller_id := public.current_member_id();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION '招待の取り消しにはメンバー登録が必要です' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT pi.project_id, pi.accepted_at, pi.revoked_at
    INTO v_project_id, v_accepted_at, v_revoked_at
  FROM public.project_invites pi
  WHERE pi.id = p_invite_id;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION '対象の招待が見つかりません' USING ERRCODE = 'no_data_found';
  END IF;

  SELECT p.group_ids INTO v_project_group_ids
  FROM public.projects p
  WHERE p.id = v_project_id;

  IF v_project_group_ids IS NULL OR NOT public.can_access_group_ids(v_project_group_ids) THEN
    RAISE EXCEPTION 'この招待を取り消す権限がありません' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'この招待は既に使用されているため取り消せません' USING ERRCODE = 'check_violation';
  END IF;

  IF v_revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'この招待は既に取り消されています' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.project_invites
  SET revoked_at = now(), revoked_by = v_caller_id
  WHERE id = p_invite_id
    AND accepted_at IS NULL
    AND revoked_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'この招待は他の操作により状態が変わりました。もう一度お試しください'
      USING ERRCODE = 'check_violation';
  END IF;
END;
$fn_revoke_project_invite$;

GRANT EXECUTE ON FUNCTION public.revoke_project_invite(uuid) TO authenticated;

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

-- 個人OKR層（migrations/20260807b_add_personal_okr.sql）
CREATE INDEX IF NOT EXISTS idx_personal_krs_member_id            ON personal_krs(member_id)           WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_personal_kr_months_personal_kr_id ON personal_kr_months(personal_kr_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_personal_kr_weeks_personal_kr_id  ON personal_kr_weeks(personal_kr_id)  WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_personal_kr_week_tasks_task_id    ON personal_kr_week_tasks(task_id);
CREATE INDEX IF NOT EXISTS idx_personal_kr_memos_personal_kr_id  ON personal_kr_memos(personal_kr_id) WHERE is_deleted = false;

-- AI解析の結果とキャッシュ（migrations/20260811_add_personal_kr_outlooks.sql）
CREATE INDEX IF NOT EXISTS idx_personal_kr_outlooks_kr_month_created
  ON personal_kr_outlooks(personal_kr_id, month, created_at DESC);

-- 月末の振り返り下書き（migrations/20260820_add_personal_kr_review_drafts.sql）
CREATE INDEX IF NOT EXISTS idx_personal_kr_review_drafts_kr_month_created
  ON personal_kr_review_drafts(personal_kr_id, month, created_at DESC);

-- クォーター計画（migrations/20260807c_add_kr_quarter_plans.sql）
CREATE INDEX IF NOT EXISTS idx_kr_quarter_plans_kr_id ON kr_quarter_plans(kr_id) WHERE is_deleted = false;

-- プロジェクト招待（migrations/20260810_add_project_invites.sql。テーブル定義側でも作成済みだが
-- 新規環境構築時にこのブロックの一覧性のためここにも明記する）
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_invites_code_hash ON project_invites(code_hash);
CREATE INDEX IF NOT EXISTS idx_project_invites_project_id ON project_invites(project_id);
CREATE INDEX IF NOT EXISTS idx_project_invites_invited_by ON project_invites(invited_by);

-- task_dependencies（B1）：同一ペアの重複防止（論理削除は除外し、削除後の再追加を許す）
CREATE UNIQUE INDEX IF NOT EXISTS uq_task_dependencies_pair
  ON task_dependencies(predecessor_task_id, successor_task_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_task_dependencies_successor
  ON task_dependencies(successor_task_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_task_dependencies_predecessor
  ON task_dependencies(predecessor_task_id) WHERE is_deleted = false;

-- loading_tips：表示順で引く（migrations/20260727_add_loading_tips.sql）
CREATE INDEX IF NOT EXISTS idx_loading_tips_sort_order
  ON loading_tips(sort_order) WHERE is_deleted = false;
