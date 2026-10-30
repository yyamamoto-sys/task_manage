-- 想定クエリ名：task_dependencies に dep_type・lag_days 列を追加
-- ============================================================
-- 2026-10-30（v3.197）タスク依存関係に「種類（FS/SS/FF/SF）」と「ずらし日数（ラグ）」を持たせる
--
-- 【何をするか】
--   task_dependencies.dep_type  text    NOT NULL DEFAULT 'FS'（'FS','SS','FF','SF' のみ）
--   task_dependencies.lag_days  integer NOT NULL DEFAULT 0（暦日。負の値＝リード＝先行の完了／開始より前から始められる）
--   既存の行は FS／0 になる（＝従来の「終了→開始・ずらしなし」と同じ意味。挙動は変わらない）。
--   後で MS Project XML（MSPDI PredecessorLink：Type 0=FF,1=FS,2=SF,3=SS／LinkLag）を取り込むための土台。
-- 新テーブルではないため GRANT／RLS の追加は不要。
-- 冪等：何度流しても安全。
-- ============================================================

ALTER TABLE task_dependencies ADD COLUMN IF NOT EXISTS dep_type text NOT NULL DEFAULT 'FS';
ALTER TABLE task_dependencies ADD COLUMN IF NOT EXISTS lag_days integer NOT NULL DEFAULT 0;

ALTER TABLE task_dependencies DROP CONSTRAINT IF EXISTS task_dependencies_dep_type_check;
ALTER TABLE task_dependencies ADD CONSTRAINT task_dependencies_dep_type_check
  CHECK (dep_type IN ('FS', 'SS', 'FF', 'SF'));

-- ---- 適用後の確認（別クエリとして実行。想定クエリ名：task_dependencies の dep_type・lag_days 列の適用確認）----
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'task_dependencies'
--   AND column_name IN ('dep_type', 'lag_days')
-- ORDER BY column_name;
-- → 2行（dep_type / text / NO / 'FS'::text、lag_days / integer / NO / 0）返れば適用済み
