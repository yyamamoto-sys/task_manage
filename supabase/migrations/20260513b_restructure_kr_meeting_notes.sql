-- ============================================================
-- 会議ノートを「TF単位」から「KR単位（中に各TFのセクション）」へ再構成
-- ============================================================
-- 背景：OneNote は KR ごとに1ドキュメントで、その中に TF1〜TFn のセクション
-- （TF説明・必達定義・評価観点・①〜④・TODO）が並んでいる運用。これに合わせ、
-- ノートは KR×週で1件（kr_meeting_notes）、その配下に TF ごとのエントリ（kr_note_tf_entries）を持つ。
-- 旧 tf_meeting_notes は作りたて・実データなしのため作り直す。
-- 詳細設計：docs/okr-cycle-design.md（Phase A）

DROP TABLE IF EXISTS tf_meeting_notes CASCADE;

-- 親：KR×週で1件
CREATE TABLE IF NOT EXISTS kr_meeting_notes (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kr_id                text NOT NULL REFERENCES key_results(id),
  week_start           date NOT NULL,                  -- 月曜日（kr_sessions と同じ規約）
  status               text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready')),
  carried_from_note_id uuid REFERENCES kr_meeting_notes(id),
  created_by           text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           text NOT NULL DEFAULT '',
  is_deleted           boolean NOT NULL DEFAULT false
);

-- 子：ノート内の TF ごとのエントリ
CREATE TABLE IF NOT EXISTS kr_note_tf_entries (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id            uuid NOT NULL REFERENCES kr_meeting_notes(id) ON DELETE CASCADE,
  tf_id              text NOT NULL REFERENCES task_forces(id),
  tf_theme           text NOT NULL DEFAULT '',        -- TFの説明・その期のテーマ（OneNoteの「★1Q＝…」）
  target_definition  text NOT NULL DEFAULT '',        -- 必達の定義
  eval_criteria      text NOT NULL DEFAULT '',        -- 評価観点
  hypotheses         text NOT NULL DEFAULT '',        -- ① 先週動かした前提・仮説
  facts              text NOT NULL DEFAULT '',        -- ② 実際に起きたこと（事実・反応）
  next_actions       text NOT NULL DEFAULT '',        -- ③ 次にやる一手（判断）
  progress_pct       int,                             -- ④ 現在のプロセス状態（%）
  progress_reason    text NOT NULL DEFAULT '',        -- ④ その理由
  todo               text NOT NULL DEFAULT '',        -- ▶ TODO（その時期のToDo）
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (note_id, tf_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_kr_meeting_notes_kr_week ON kr_meeting_notes(kr_id, week_start) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_kr_meeting_notes_kr_id_week    ON kr_meeting_notes(kr_id, week_start DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_kr_note_tf_entries_note_id     ON kr_note_tf_entries(note_id);

ALTER TABLE kr_meeting_notes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE kr_note_tf_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated full access" ON kr_meeting_notes;
CREATE POLICY "authenticated full access" ON kr_meeting_notes   FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "authenticated full access" ON kr_note_tf_entries;
CREATE POLICY "authenticated full access" ON kr_note_tf_entries FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_kr_meeting_notes_updated_at ON kr_meeting_notes;
CREATE TRIGGER trg_kr_meeting_notes_updated_at BEFORE UPDATE ON kr_meeting_notes FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trg_kr_note_tf_entries_updated_at ON kr_note_tf_entries;
CREATE TRIGGER trg_kr_note_tf_entries_updated_at BEFORE UPDATE ON kr_note_tf_entries FOR EACH ROW EXECUTE FUNCTION update_updated_at();
