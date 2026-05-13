-- ============================================================
-- tf_meeting_notes テーブルの追加（TF会議ノート：OKR循環ワークフロー Phase A）
-- ============================================================
-- 背景：チェックイン前のTF会議で更新している OneNote の内容（必達定義・評価観点・
-- 先週動かした仮説／起きたこと／次の一手／現在のプロセス状態(%)／ToDo・タスク状況）を
-- アプリ内に移す。TF × 週（月曜起点）で1レコード。前週のノートから内容を「下書き」として
-- 引き継いで次週分を作成できる（carried_from_note_id）。
-- 詳細設計：docs/okr-cycle-design.md

CREATE TABLE IF NOT EXISTS tf_meeting_notes (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tf_id                text NOT NULL REFERENCES task_forces(id),
  week_start           date NOT NULL,                  -- 月曜日（kr_sessions と同じ規約）
  target_definition    text NOT NULL DEFAULT '',       -- 必達の定義（「○月-必達(60%相当)」本文）
  eval_criteria        text NOT NULL DEFAULT '',       -- 評価観点
  hypotheses           text NOT NULL DEFAULT '',       -- ① 先週動かした前提・仮説
  facts                text NOT NULL DEFAULT '',       -- ② 実際に起きたこと（事実・反応）
  next_actions         text NOT NULL DEFAULT '',       -- ③ 次にやる一手（判断）
  progress_pct         int,                            -- ④ 現在のプロセス状態（%）
  progress_reason      text NOT NULL DEFAULT '',       -- ④ その理由
  todo_status          text NOT NULL DEFAULT '',       -- ToDo / タスクの状況メモ
  status               text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready')),
  carried_from_note_id uuid REFERENCES tf_meeting_notes(id),
  created_by           text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           text NOT NULL DEFAULT '',
  is_deleted           boolean NOT NULL DEFAULT false
);

COMMENT ON TABLE  tf_meeting_notes IS 'TF会議ノート（TF×週で1件）。OneNoteの内容をアプリ化。前週から下書き引き継ぎ可。';

CREATE UNIQUE INDEX IF NOT EXISTS uq_tf_meeting_notes_tf_week ON tf_meeting_notes(tf_id, week_start) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_tf_meeting_notes_tf_id_week  ON tf_meeting_notes(tf_id, week_start DESC) WHERE is_deleted = false;

ALTER TABLE tf_meeting_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated full access" ON tf_meeting_notes;
CREATE POLICY "authenticated full access" ON tf_meeting_notes
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- updated_at トリガー（update_updated_at 関数は既存）
DROP TRIGGER IF EXISTS trg_tf_meeting_notes_updated_at ON tf_meeting_notes;
CREATE TRIGGER trg_tf_meeting_notes_updated_at
  BEFORE UPDATE ON tf_meeting_notes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
