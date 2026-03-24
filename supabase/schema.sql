-- ============================================================
-- グループ計画管理アプリ スキーマ定義
-- Supabase SQL エディタで実行してください
-- ============================================================

-- ===== メンバーマスタ =====
create table if not exists members (
  id            text primary key,
  display_name  text not null,
  short_name    text not null,
  initials      text not null,
  teams_account text not null default '',
  color_bg      text not null,
  color_text    text not null,
  is_deleted    boolean not null default false,
  deleted_at    timestamptz,
  deleted_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    text not null default ''
);

-- ===== Objective =====
create table if not exists objectives (
  id          text primary key,
  title       text not null,
  period      text not null,
  is_current  boolean not null default true,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  text not null default ''
);

-- ===== Key Results =====
create table if not exists key_results (
  id           text primary key,
  objective_id text not null references objectives(id),
  title        text not null,
  is_deleted   boolean not null default false,
  deleted_at   timestamptz,
  deleted_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   text not null default ''
);

-- ===== Quarterly Objectives =====
create table if not exists quarterly_objectives (
  id           text primary key,
  objective_id text not null references objectives(id),
  quarter      text not null check (quarter in ('1Q','2Q','3Q','4Q')),
  title        text not null,
  is_deleted   boolean not null default false,
  deleted_at   timestamptz,
  deleted_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   text not null default ''
);

-- ===== Quarterly Key Results =====
create table if not exists quarterly_key_results (
  id                     text primary key,
  quarterly_objective_id text not null references quarterly_objectives(id),
  title                  text not null,
  is_deleted             boolean not null default false,
  deleted_at             timestamptz,
  deleted_by             text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  updated_by             text not null default ''
);

-- ===== Task Forces =====
create table if not exists task_forces (
  id               text primary key,
  kr_id            text not null references key_results(id),
  tf_number        text not null default '',
  name             text not null,
  leader_member_id text references members(id),
  is_deleted       boolean not null default false,
  deleted_at       timestamptz,
  deleted_by       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  updated_by       text not null default ''
);

-- ===== Projects =====
create table if not exists projects (
  id                text primary key,
  name              text not null,
  purpose           text not null default '',
  contribution_memo text not null default '',
  owner_member_id   text references members(id),
  status            text not null default 'active' check (status in ('active','completed','archived')),
  color_tag         text not null default '#7F77DD',
  start_date        date,
  end_date          date,
  is_deleted        boolean not null default false,
  deleted_at        timestamptz,
  deleted_by        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  updated_by        text not null default ''
);

-- ===== Project ↔ TaskForce（多対多）=====
create table if not exists project_task_forces (
  project_id text not null references projects(id),
  tf_id      text not null references task_forces(id),
  created_at timestamptz not null default now(),
  primary key (project_id, tf_id)
);

-- ===== Tasks =====
create table if not exists tasks (
  id                  text primary key,
  name                text not null,
  project_id          text not null references projects(id),
  assignee_member_id  text references members(id),
  status              text not null default 'todo' check (status in ('todo','in_progress','done')),
  priority            text check (priority in ('high','mid','low')),
  due_date            date,
  estimated_hours     numeric,
  comment             text not null default '',
  is_deleted          boolean not null default false,
  deleted_at          timestamptz,
  deleted_by          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  updated_by          text not null default ''
);

-- ===== 変更履歴 =====
create table if not exists admin_change_logs (
  id                  uuid primary key default gen_random_uuid(),
  layer               text not null check (layer in ('objective','kr','tf','project','member')),
  action              text not null check (action in ('create','update','delete','restore','period_switch')),
  target_id           text not null,
  target_name         text not null,
  diff                jsonb not null default '{}',
  performed_by        text not null,
  performed_at        timestamptz not null default now(),
  is_conflict_override boolean not null default false
);

-- 2週間より古い履歴は自動削除（定期実行 or pg_cron）
-- delete from admin_change_logs where performed_at < now() - interval '14 days';

-- ============================================================
-- RLS（行レベルセキュリティ）
-- 全テーブルで有効化し、認証済みユーザーのみアクセス可能にする
-- ============================================================

alter table members                enable row level security;
alter table objectives             enable row level security;
alter table key_results            enable row level security;
alter table quarterly_objectives   enable row level security;
alter table quarterly_key_results  enable row level security;
alter table task_forces            enable row level security;
alter table projects               enable row level security;
alter table project_task_forces    enable row level security;
alter table tasks                  enable row level security;
alter table admin_change_logs      enable row level security;

-- 認証済みユーザーに全操作を許可
create policy "authenticated full access" on members               for all to authenticated using (true) with check (true);
create policy "authenticated full access" on objectives            for all to authenticated using (true) with check (true);
create policy "authenticated full access" on key_results           for all to authenticated using (true) with check (true);
create policy "authenticated full access" on quarterly_objectives  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on quarterly_key_results for all to authenticated using (true) with check (true);
create policy "authenticated full access" on task_forces           for all to authenticated using (true) with check (true);
create policy "authenticated full access" on projects              for all to authenticated using (true) with check (true);
create policy "authenticated full access" on project_task_forces   for all to authenticated using (true) with check (true);
create policy "authenticated full access" on tasks                 for all to authenticated using (true) with check (true);
create policy "authenticated full access" on admin_change_logs     for all to authenticated using (true) with check (true);

-- ============================================================
-- updated_at 自動更新トリガー
-- ============================================================

create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_members_updated_at
  before update on members for each row execute function update_updated_at();
create trigger trg_objectives_updated_at
  before update on objectives for each row execute function update_updated_at();
create trigger trg_key_results_updated_at
  before update on key_results for each row execute function update_updated_at();
create trigger trg_task_forces_updated_at
  before update on task_forces for each row execute function update_updated_at();
create trigger trg_projects_updated_at
  before update on projects for each row execute function update_updated_at();
create trigger trg_tasks_updated_at
  before update on tasks for each row execute function update_updated_at();
create trigger trg_quarterly_objectives_updated_at
  before update on quarterly_objectives for each row execute function update_updated_at();
create trigger trg_quarterly_key_results_updated_at
  before update on quarterly_key_results for each row execute function update_updated_at();
