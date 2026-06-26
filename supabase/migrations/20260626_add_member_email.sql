-- メンバーにメールアドレスを追加し、Supabase Auth ユーザーとの自動連携を可能にする。
-- ログイン時に auth.users.email と members.email を突き合わせて自動マッチングする。
ALTER TABLE members ADD COLUMN IF NOT EXISTS email text;

-- 同一メールを複数の（未削除）メンバーに割り当てないための一意制約
CREATE UNIQUE INDEX IF NOT EXISTS members_email_unique
  ON members(email)
  WHERE email IS NOT NULL AND is_deleted = false;
