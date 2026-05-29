-- 20260529_add_notify_pref.sql
-- 期限通知の受け取り方（ユーザーごと）: none / browser / teams
-- 既存メンバーは 'none'（＝今までどおり受動的リマインダーのみ）で安全。

ALTER TABLE members ADD COLUMN IF NOT EXISTS notify_pref text NOT NULL DEFAULT 'none';
ALTER TABLE members DROP CONSTRAINT IF EXISTS members_notify_pref_check;
ALTER TABLE members ADD CONSTRAINT members_notify_pref_check
  CHECK (notify_pref IN ('none','browser','teams'));
