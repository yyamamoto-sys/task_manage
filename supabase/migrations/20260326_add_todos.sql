-- ============================================================
-- マイグレーション: ToDoテーブル追加 & tasksにtodo_idカラム追加
-- 実行日: 2026-03-26
-- Supabase SQL Editorで実行してください
-- ============================================================

-- ① todos テーブルを新規作成
create table if not exists todos (
  id         text primary key,
  tf_id      text not null references task_forces(id),
  title      text not null,
  due_date   date,
  memo       text not null default '',
  is_deleted boolean not null default false,
  deleted_at timestamptz,
  deleted_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text not null default ''
);

-- ② RLS（行レベルセキュリティ）を有効化
alter table todos enable row level security;

-- ③ 認証済みユーザーに全操作を許可
create policy "authenticated full access" on todos
  for all to authenticated using (true) with check (true);

-- ④ updated_at 自動更新トリガー
create trigger trg_todos_updated_at
  before update on todos
  for each row execute function update_updated_at();

-- ⑤ tasks テーブルに todo_id カラムを追加
alter table tasks
  add column if not exists todo_id text references todos(id);

-- ⑥ tasks の project_id を NOT NULL → NULL 許可に変更
--    （ToDoからのみ紐づくタスクはproject_idがnullになるため）
alter table tasks
  alter column project_id drop not null;
