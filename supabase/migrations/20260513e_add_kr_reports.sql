-- ============================================================
-- kr_reports テーブル（OKR循環ワークフロー Phase C：レポートを確認・確定制に）
-- ============================================================
-- レポートは AI が下書き（status='draft'）→ 人が確認・手修正 → 「確定」（status='finalized'、
-- 確定者・確定日時を記録）の流れにする。確定後も再編集可。localStorage から移行。
-- 詳細設計：docs/okr-cycle-design.md（Phase C）

CREATE TABLE IF NOT EXISTS kr_reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kr_id        text NOT NULL REFERENCES key_results(id),
  week_start   date NOT NULL,                  -- 対象週（月曜起点）
  mode         text NOT NULL DEFAULT 'checkin',-- 'checkin' / 'win_session' 等
  content      text NOT NULL DEFAULT '',       -- 本文（AI下書き→人が編集。HTML）
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','finalized')),
  created_by   text NOT NULL,                  -- AI下書きを生成した人
  finalized_by text,                           -- 確定した人（＝内容を確認・編集した人）
  finalized_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   text NOT NULL DEFAULT '',
  is_deleted   boolean NOT NULL DEFAULT false
);

COMMENT ON TABLE kr_reports IS 'KRレポート。AI下書き→人が確認・編集→確定（finalized_by/at記録）。';

CREATE UNIQUE INDEX IF NOT EXISTS uq_kr_reports_kr_week_mode ON kr_reports(kr_id, week_start, mode) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_kr_reports_kr_id_week         ON kr_reports(kr_id, week_start DESC) WHERE is_deleted = false;

ALTER TABLE kr_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated full access" ON kr_reports;
CREATE POLICY "authenticated full access" ON kr_reports FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_kr_reports_updated_at ON kr_reports;
CREATE TRIGGER trg_kr_reports_updated_at BEFORE UPDATE ON kr_reports FOR EACH ROW EXECUTE FUNCTION update_updated_at();
