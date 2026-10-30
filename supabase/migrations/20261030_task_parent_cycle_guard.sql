-- 想定クエリ名：タスク階層の下回り（親IDの索引＋親子の循環を拒否するトリガー）
-- ============================================================
-- 2026-10-30（v3.195）タスクの親子を任意の深さにするための下回り
--
-- 【何をするか】
--   1. tasks.parent_task_id の部分索引（子を引く・祖先をたどる再帰クエリを速くする）。
--   2. 親の付け替えで循環（自分が自分の祖先になる）が起きるのを DB 側でも拒否するトリガー。
--      再帰 CTE で新しい親から祖先をたどり、自分の id が出たら RAISE。たどる段数は最大 32。
--      SECURITY DEFINER（RLS で見えない祖先も判定に使うため）・search_path は空に固定・テーブルはスキーマ修飾。
--   既存データは変えない。新しいテーブルは作らないので GRANT は不要。
--   この版のアプリは、このマイグレーションが未適用でも今まで通り動く（適用は任意のタイミングでよい）。
-- 冪等：何度流しても安全。
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_tasks_parent
  ON public.tasks (parent_task_id)
  WHERE parent_task_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.prevent_task_parent_cycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_prevent_task_parent_cycle$
DECLARE
  v_cycle boolean;
BEGIN
  IF NEW.parent_task_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.parent_task_id = NEW.id THEN
    RAISE EXCEPTION 'task parent cycle: a task cannot be its own parent (%)', NEW.id
      USING ERRCODE = '23514';
  END IF;

  WITH RECURSIVE anc(id, parent_task_id, depth) AS (
    SELECT t.id, t.parent_task_id, 1
      FROM public.tasks t
     WHERE t.id = NEW.parent_task_id
    UNION ALL
    SELECT t.id, t.parent_task_id, a.depth + 1
      FROM public.tasks t
      JOIN anc a ON t.id = a.parent_task_id
     WHERE a.depth < 32
  )
  SELECT EXISTS (SELECT 1 FROM anc WHERE anc.id = NEW.id) INTO v_cycle;

  IF v_cycle THEN
    RAISE EXCEPTION 'task parent cycle: setting parent % on task % would create a cycle', NEW.parent_task_id, NEW.id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$fn_prevent_task_parent_cycle$;

DROP TRIGGER IF EXISTS trg_tasks_parent_cycle ON public.tasks;
CREATE TRIGGER trg_tasks_parent_cycle
  BEFORE INSERT OR UPDATE OF parent_task_id ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.prevent_task_parent_cycle();

-- ---- 適用後の確認（別クエリとして実行。想定クエリ名：親子循環ガードの適用確認）----
-- SELECT
--   (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_tasks_parent') AS idx_ok,
--   (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--     WHERE n.nspname = 'public' AND p.proname = 'prevent_task_parent_cycle') AS fn_ok,
--   (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_tasks_parent_cycle' AND NOT tgisinternal) AS trg_ok;
-- → idx_ok=1, fn_ok=1, trg_ok=1 なら適用済み
