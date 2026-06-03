-- 20260603_add_milestone_description.sql
-- マイルストーンに「メモ・詳細（description）」列を追加する。
-- 通常のタスク（comment）と同様に、節目に補足説明を後から追記できるようにするため。
-- 冪等：既に列があっても安全（IF NOT EXISTS）。
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS description text;
