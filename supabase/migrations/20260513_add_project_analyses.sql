-- ============================================================
-- project_analyses テーブルの追加（PJごとのAI分析結果を全員で共有）
-- ============================================================
-- 背景：プロジェクトカルテの「AI分析」結果を端末ローカル（localStorage）ではなく
-- サーバーに保存し、最新の分析を全メンバーが見られるようにする。
-- 履歴は 1 プロジェクトにつき最新 2 件まで（古いものはアプリ側で削除）。
-- レコードは作成後に変更しないため updated_at / is_deleted は持たない。

CREATE TABLE IF NOT EXISTS project_analyses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  text NOT NULL REFERENCES projects(id),
  content     text NOT NULL,                       -- AIが返したマークダウン本文
  created_by  text NOT NULL,                       -- 実行した member_id
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  project_analyses            IS 'PJごとのAI分析結果。1PJにつき最新2件まで保持（古い分はアプリ側で削除）。';
COMMENT ON COLUMN project_analyses.content    IS 'AIが返した分析レポート（マークダウン）';
COMMENT ON COLUMN project_analyses.created_by IS '分析を実行したメンバーの member_id';

CREATE INDEX IF NOT EXISTS idx_project_analyses_project_id_created_at
  ON project_analyses(project_id, created_at DESC);

ALTER TABLE project_analyses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated full access" ON project_analyses;
CREATE POLICY "authenticated full access" ON project_analyses
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
