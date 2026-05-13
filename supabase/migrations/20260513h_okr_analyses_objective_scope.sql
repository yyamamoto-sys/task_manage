-- ============================================================
-- okr_analyses に Objective スコープを追加（B-1：1テーブルで KR/Objective 両対応）
-- ============================================================
-- これまで okr_analyses は KR 単位の分析だけを保持していた。
-- Phase B 仕上げで、Objective 全体の分析（O＋配下KRのノート・セッション・宣言・タスクを束ねた所感）も
-- 同じテーブルで扱えるようにする。scope で 'kr' / 'objective' を区別、objective_id を追加、
-- kr_id を NULL 許可に変更。データ整合性は CHECK 制約で担保。
-- 詳細：docs/okr-cycle-design.md（Phase B 仕上げ）

ALTER TABLE okr_analyses ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'kr';
ALTER TABLE okr_analyses ADD COLUMN IF NOT EXISTS objective_id text REFERENCES objectives(id);
ALTER TABLE okr_analyses ALTER COLUMN kr_id DROP NOT NULL;

-- scope の値を制約
DO $$
DECLARE c_name text;
BEGIN
  SELECT conname INTO c_name FROM pg_constraint
   WHERE conrelid = 'okr_analyses'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%scope%';
  IF c_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE okr_analyses DROP CONSTRAINT ' || quote_ident(c_name);
  END IF;
END $$;
ALTER TABLE okr_analyses ADD CONSTRAINT okr_analyses_scope_check
  CHECK (scope IN ('kr','objective'));

-- scope と参照キーの整合性
DO $$
DECLARE c_name text;
BEGIN
  SELECT conname INTO c_name FROM pg_constraint
   WHERE conrelid = 'okr_analyses'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%objective_id%';
  IF c_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE okr_analyses DROP CONSTRAINT ' || quote_ident(c_name);
  END IF;
END $$;
ALTER TABLE okr_analyses ADD CONSTRAINT okr_analyses_scope_target_check
  CHECK (
    (scope = 'kr'        AND kr_id        IS NOT NULL AND objective_id IS NULL)
    OR (scope = 'objective' AND objective_id IS NOT NULL AND kr_id        IS NULL)
  );

CREATE INDEX IF NOT EXISTS idx_okr_analyses_objective_id_created
  ON okr_analyses(objective_id, created_at DESC) WHERE is_deleted = false;

COMMENT ON COLUMN okr_analyses.scope        IS 'KR単位（kr）か Objective単位（objective）か';
COMMENT ON COLUMN okr_analyses.objective_id IS 'scope=objective のとき必須。配下の全KRを束ねた分析';
