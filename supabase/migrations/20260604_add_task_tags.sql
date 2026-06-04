-- 20260604_add_task_tags.sql
-- タスクに自由入力タグ（text配列）を追加する。
-- 例：「懇親会」「レイアウト」。同一PJ内でのグルーピング/ソートに使う。
-- 冪等：既に列があっても安全（IF NOT EXISTS）。
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';
