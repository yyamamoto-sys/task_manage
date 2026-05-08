-- ============================================================
-- メンバータグ：複数メンバーをまとめて担当者として扱う仕組み
-- ============================================================
-- 背景：「請求書PJ」「広報チーム」「全員」などのグループに対してタスクを
-- 紐付けたい。グループに属するメンバー全員の業務として集計される。
--
-- Phase Tag-1（このマイグレーション）：
--   タグ定義 + メンバー紐付けの DB スキーマと管理画面のみ。
--   タスクへの紐付けは Phase Tag-2 で別マイグレーションを足す。

-- 1. メンバータグ本体
CREATE TABLE IF NOT EXISTS member_tags (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  -- kind の使い分け：
  --   'static'      … 手動でメンバーを管理（請求書PJ・広報チーム等）
  --   'all_members' … 全アクティブメンバー（自動同期は Phase Tag-3）
  --   'kr_members'  … 特定 KR の関係メンバー（source_id=KR id・Phase 3）
  --   'tf_members'  … 特定 TF の関係メンバー（source_id=TF id・Phase 3）
  kind        text NOT NULL DEFAULT 'static'
              CHECK (kind IN ('static','all_members','kr_members','tf_members')),
  source_id   text,           -- kr_members/tf_members の参照先
  is_deleted  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text NOT NULL DEFAULT '',
  deleted_at  timestamptz,
  deleted_by  text
);

-- 2. メンバータグ ↔ メンバー（多対多）
CREATE TABLE IF NOT EXISTS member_tag_members (
  tag_id     text NOT NULL REFERENCES member_tags(id) ON DELETE CASCADE,
  member_id  text NOT NULL REFERENCES members(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tag_id, member_id)
);

-- 3. インデックス
CREATE INDEX IF NOT EXISTS idx_member_tag_members_member_id ON member_tag_members(member_id);
CREATE INDEX IF NOT EXISTS idx_member_tags_kind ON member_tags(kind) WHERE is_deleted = false;

-- 4. updated_at 自動更新トリガー
DROP TRIGGER IF EXISTS trg_member_tags_updated_at ON member_tags;
CREATE TRIGGER trg_member_tags_updated_at
  BEFORE UPDATE ON member_tags
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 5. RLS（既存テーブルと同じ authenticated full access ポリシー）
ALTER TABLE member_tags        ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_tag_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated full access" ON member_tags;
CREATE POLICY "authenticated full access" ON member_tags
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated full access" ON member_tag_members;
CREATE POLICY "authenticated full access" ON member_tag_members
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMENT ON TABLE member_tags IS 'メンバーをグループ化するタグ。タスクの担当者として指定可能（Phase Tag-2で tasks に紐づけ）';
