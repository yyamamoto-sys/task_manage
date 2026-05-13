-- ============================================================
-- kr_meeting_notes に carry_memo 列を追加（Phase D：④③→①の自動引き継ぎ）
-- ============================================================
-- 「前週の確定レポートの要点」＋「最新の③分析の示唆」を自動生成して入れるテキスト欄。
-- ユーザーは編集可能。ノートの上部にエディタとして表示する。
-- 詳細：docs/okr-cycle-design.md（Phase D）

ALTER TABLE kr_meeting_notes ADD COLUMN IF NOT EXISTS carry_memo text NOT NULL DEFAULT '';
COMMENT ON COLUMN kr_meeting_notes.carry_memo IS '前回からの引き継ぎメモ。前週確定レポートの要点＋最新③分析の示唆を自動生成、編集可';
