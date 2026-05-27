-- tasks テーブルに階層化（PJ > 大タスク > 小タスク・2階層固定）の列を追加する。
-- parent_task_id: null=大タスク（最上位）/ 値あり=小タスク。自己参照FK。
-- display_order: 同一親（またはPJ直下）内での手動並び順。DnD・上下移動で更新する。
-- 既存データの display_order は created_at 順で PJ 単位の連番にバックフィルする。
-- （未適用でも parent_task_id=undefined / display_order=undefined で安全に動作する。）
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS parent_task_id text REFERENCES tasks(id);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 0;
WITH ordered AS (
  SELECT id, row_number() OVER (PARTITION BY project_id ORDER BY created_at) AS rn
  FROM tasks WHERE is_deleted = false
)
UPDATE tasks t SET display_order = ordered.rn FROM ordered WHERE ordered.id = t.id;
