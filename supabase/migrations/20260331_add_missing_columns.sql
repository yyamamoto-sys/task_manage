-- ============================================================
-- マイグレーション: 不足カラムの追加
-- 実行日: 2026-03-31
-- Supabase SQL Editorで実行してください
-- ============================================================

-- ① objectives テーブルに purpose / background カラムを追加
alter table objectives
  add column if not exists purpose text,
  add column if not exists background text;

-- ② quarterly_objectives テーブルに purpose / background カラムを追加
alter table quarterly_objectives
  add column if not exists purpose text,
  add column if not exists background text;

-- ③ projects テーブルに owner_member_ids カラムを追加
alter table projects
  add column if not exists owner_member_ids text[] not null default '{}';
