-- projects テーブルに役割マップを追加
ALTER TABLE projects ADD COLUMN IF NOT EXISTS member_roles JSONB DEFAULT '{}';
COMMENT ON COLUMN projects.member_roles IS '各メンバーの役割。キー=member_id、値=役割テキスト（例：{"uuid1": "PJリーダー", "uuid2": "配信"}）';
