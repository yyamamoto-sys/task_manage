-- tasks.finalized_mentions: メンション通知の確定スナップショット
-- モーダルを閉じたタイミングでのみ更新される。
-- useMentionNotifications はコメントではなくこの列の変化を監視する。
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS finalized_mentions text[] NOT NULL DEFAULT '{}';
