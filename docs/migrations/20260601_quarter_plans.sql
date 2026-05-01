-- docs/migrations/20260601_quarter_plans.sql
--
-- 【用途】
-- クォーター計画（KrQuarterPlanPanel）のSupabase移行用テーブル定義。
-- Phase 1はlocalStorageで実装済み（quarterPlanStore.ts）。
-- IT部門のSupabase承認後にこのSQLを実行し、quarterPlanStore.tsをSupabase版に差し替える。
--
-- 移行手順:
--   1. Supabase SQL Editorでこのファイルを実行
--   2. src/lib/supabase/quarterPlanStore.ts を Supabase版に書き換え
--   3. localStorage のデータ移行スクリプトを実行（必要な場合）

-- ===== proposed_tfs（TF計画明細）=====

CREATE TABLE proposed_tfs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id       UUID NOT NULL,              -- quarter_plans.id への外部キー（後で追加）
  tf_number     INTEGER NOT NULL,
  action        TEXT NOT NULL CHECK (action IN ('継続', '変更', '廃止', '新設')),
  name          TEXT NOT NULL,
  objective     TEXT NOT NULL DEFAULT '',
  rationale     TEXT NOT NULL DEFAULT '',
  leader_suggestion TEXT,
  key_todos     TEXT[] NOT NULL DEFAULT '{}',
  success_criteria TEXT NOT NULL DEFAULT '',
  risk          TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ===== quarter_plans（クォーター計画本体）=====

CREATE TABLE quarter_plans (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kr_id         UUID NOT NULL,              -- key_results.id への外部キー
  quarter       TEXT NOT NULL,             -- 例: "2026-3Q"
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'finalized')),
  summary       TEXT NOT NULL DEFAULT '',
  overall_risk  TEXT,
  created_by    TEXT NOT NULL,             -- member.id
  saved_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (kr_id, quarter)                  -- KRとクォーターの組み合わせは1件のみ
);

-- proposed_tfs の外部キー
ALTER TABLE proposed_tfs
  ADD CONSTRAINT fk_proposed_tfs_plan
  FOREIGN KEY (plan_id) REFERENCES quarter_plans(id) ON DELETE CASCADE;

-- ===== インデックス =====

CREATE INDEX idx_quarter_plans_kr_id  ON quarter_plans(kr_id);
CREATE INDEX idx_proposed_tfs_plan_id ON proposed_tfs(plan_id);

-- ===== RLS =====

ALTER TABLE quarter_plans  ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposed_tfs   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_all" ON quarter_plans
  FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "authenticated_all" ON proposed_tfs
  FOR ALL USING (auth.role() = 'authenticated');
