-- ============================================================
-- AI分析を「TF単位」→「KR単位」へ再構成（OKR循環ワークフロー Phase B 改）
-- ============================================================
-- 分析はKR単位（そのKRに紐づく全TFのノート＋KRのセッション・宣言＋TFのタスクをまとめてAIが分析）で行う。
-- 旧 okr_tf_analyses は作りたて・実データ少のため作り直す。
-- 詳細設計：docs/okr-cycle-design.md（Phase B）

DROP TABLE IF EXISTS okr_tf_analyses CASCADE;

CREATE TABLE IF NOT EXISTS okr_analyses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kr_id       text NOT NULL REFERENCES key_results(id),
  content     text NOT NULL,                    -- AI生成→人が手修正したマークダウン
  edited      boolean NOT NULL DEFAULT false,   -- 人が手修正したか
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text NOT NULL DEFAULT '',
  is_deleted  boolean NOT NULL DEFAULT false
);

COMMENT ON TABLE okr_analyses IS 'KR単位のAI分析の蓄積。過去分も残す（遡って分析できるように）。レポート作成の素材にもなる。';

CREATE INDEX IF NOT EXISTS idx_okr_analyses_kr_id_created ON okr_analyses(kr_id, created_at DESC) WHERE is_deleted = false;

ALTER TABLE okr_analyses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated full access" ON okr_analyses;
CREATE POLICY "authenticated full access" ON okr_analyses FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_okr_analyses_updated_at ON okr_analyses;
CREATE TRIGGER trg_okr_analyses_updated_at BEFORE UPDATE ON okr_analyses FOR EACH ROW EXECUTE FUNCTION update_updated_at();
