-- 想定クエリ名：milestones に color 列を追加
-- ============================================================
-- 2026-10-29（v3.190）マイルストーンの色を選べるようにする
--
-- 【何をするか】
--   milestones.color（text・NULL可）を足す。NULL は「既定の色（アンバー）」を意味し、既存の行は変えない。
--   値は "#RRGGBB"（6桁16進）に限る。クライアントでも正規化して送るが、DB側でも CHECK で守る。
-- 冪等：何度流しても安全。
-- ============================================================

ALTER TABLE milestones ADD COLUMN IF NOT EXISTS color text;

ALTER TABLE milestones DROP CONSTRAINT IF EXISTS milestones_color_hex_check;
ALTER TABLE milestones ADD CONSTRAINT milestones_color_hex_check
  CHECK (color IS NULL OR color ~ '^#[0-9a-fA-F]{6}$');

-- ---- 適用後の確認（別クエリとして実行。想定クエリ名：milestones.color 列の適用確認）----
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'milestones' AND column_name = 'color';
-- → 1行（color / text / YES）返れば適用済み
