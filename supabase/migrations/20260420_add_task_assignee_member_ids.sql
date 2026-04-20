-- tasks テーブルに複数担当者を格納する配列カラムを追加
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assignee_member_ids text[] DEFAULT '{}';

-- 既存レコードのバックフィル：assignee_member_id が設定済みの行に反映
UPDATE tasks
SET assignee_member_ids = ARRAY[assignee_member_id]
WHERE assignee_member_id IS NOT NULL
  AND (assignee_member_ids IS NULL OR assignee_member_ids = '{}');
