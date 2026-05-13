-- ============================================================
-- okr_tf_analyses テーブル（OKR循環ワークフロー Phase B：TF単位のAI分析の蓄積）
-- ============================================================
-- 背景：会議ノート＋セッション履歴＋タスクをまとめてAIが分析した結果を、TFごとに
-- 履歴として残し、過去に遡って読める／手修正できるようにする。
-- 詳細設計：docs/okr-cycle-design.md（Phase B）

CREATE TABLE IF NOT EXISTS okr_tf_analyses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tf_id       text NOT NULL REFERENCES task_forces(id),
  content     text NOT NULL,                    -- AI生成→人が手修正したマークダウン
  edited      boolean NOT NULL DEFAULT false,   -- 人が手修正したか
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text NOT NULL DEFAULT '',
  is_deleted  boolean NOT NULL DEFAULT false
);

COMMENT ON TABLE okr_tf_analyses IS 'TF単位のAI分析の蓄積。過去分も残す（遡って分析できるように）。';

CREATE INDEX IF NOT EXISTS idx_okr_tf_analyses_tf_id_created ON okr_tf_analyses(tf_id, created_at DESC) WHERE is_deleted = false;

ALTER TABLE okr_tf_analyses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated full access" ON okr_tf_analyses;
CREATE POLICY "authenticated full access" ON okr_tf_analyses FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_okr_tf_analyses_updated_at ON okr_tf_analyses;
CREATE TRIGGER trg_okr_tf_analyses_updated_at BEFORE UPDATE ON okr_tf_analyses FOR EACH ROW EXECUTE FUNCTION update_updated_at();
