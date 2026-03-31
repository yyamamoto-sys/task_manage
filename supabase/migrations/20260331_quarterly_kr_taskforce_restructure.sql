-- ============================================================
-- マイグレーション: quarterly_kr_task_forces テーブル再構成
-- 実行日: 2026-03-31
-- Supabase SQL Editorで実行してください
-- ============================================================
--
-- 【変更内容】
-- 旧構造: quarterly_kr_id（QuarterlyKeyResultのID）+ tf_id
-- 新構造: quarterly_objective_id（QuarterlyObjectiveのID）+ kr_id（通期KRのID）+ tf_id
--
-- KRは通期（年間）固定。四半期ごとに変わるのはTF割り当てのみ。
-- quarterly_key_results テーブルは不要になるため削除する。
-- ============================================================

-- ① quarterly_kr_task_forces テーブルを再作成
-- 既存データは互換性がないため一旦全削除して作り直す
truncate table quarterly_kr_task_forces;

alter table quarterly_kr_task_forces
  drop column if exists quarterly_kr_id;

alter table quarterly_kr_task_forces
  add column if not exists quarterly_objective_id uuid not null references quarterly_objectives(id),
  add column if not exists kr_id uuid not null references key_results(id);

-- ② 旧 quarterly_key_results テーブルを削除（存在する場合）
drop table if exists quarterly_key_results;
