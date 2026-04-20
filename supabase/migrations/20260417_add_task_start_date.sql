-- tasks テーブルに start_date カラムを追加（期間登録対応）
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS start_date date;
