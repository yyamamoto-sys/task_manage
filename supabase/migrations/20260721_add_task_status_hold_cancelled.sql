-- タスクステータスに「保留(on_hold)」「中止(cancelled)」を追加
-- 適用方法: Supabase SQL Editor に全文貼って実行（冪等・何度実行してもOK）
--
-- 【背景】過去に登録したタスクが、方針転換で実施しなくなる（中止）・状況変化で一旦保留し
-- 将来また検討する可能性がある（保留）、というケースにステータスを付与できるようにする。
-- 既存の3値（todo/in_progress/done）はそのまま維持し、2値を追加するだけ（データ移行不要）。
--
-- 【このマイグレーションで変更するもの】
-- tasks.status の CHECK 制約を ('todo','in_progress','done') →
--   ('todo','in_progress','done','on_hold','cancelled') に拡張する。
-- 制約名は schema.sql の無名 CHECK 由来の自動生成名（tasks_status_check）。
-- 名前が異なる環境向けに、tasks.status 上の既存 CHECK 制約を動的に探して落とすDOブロックにしている。

-- ============================================================
-- ブロック1: 既存の status CHECK 制約を落とす（制約名がずれていても拾えるように動的検索）
-- ============================================================
DO $mig_drop_status_check$
DECLARE
  con_name text;
BEGIN
  SELECT con.conname INTO con_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY(con.conkey)
  WHERE rel.relname = 'tasks'
    AND con.contype = 'c'
    AND att.attname = 'status'
  LIMIT 1;

  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE tasks DROP CONSTRAINT %I', con_name);
  END IF;
END
$mig_drop_status_check$;

-- ============================================================
-- ブロック2: 拡張後の CHECK 制約を追加
-- ============================================================
ALTER TABLE tasks
  ADD CONSTRAINT tasks_status_check
  CHECK (status IN ('todo', 'in_progress', 'done', 'on_hold', 'cancelled'));
