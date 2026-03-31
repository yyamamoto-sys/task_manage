-- ============================================================
-- マイグレーション: task_forces に background カラムを追加
-- 実行日: 2026-03-31
-- Supabase SQL Editorで実行してください
-- ============================================================

alter table task_forces
  add column if not exists background text;
