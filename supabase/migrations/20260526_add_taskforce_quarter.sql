-- TaskForce に quarter 列を追加し、QKTF から四半期をバックフィルする
ALTER TABLE task_forces ADD COLUMN IF NOT EXISTS quarter text;

-- 既存の割り当てを QKTF→quarterly_objectives.quarter からバックフィル
UPDATE task_forces tf
SET quarter = qo.quarter
FROM quarterly_kr_task_forces qktf
JOIN quarterly_objectives qo ON qo.id = qktf.quarterly_objective_id
WHERE qktf.tf_id = tf.id AND tf.quarter IS NULL;

-- CHECK制約（任意の四半期文字列のみ許可）
ALTER TABLE task_forces DROP CONSTRAINT IF EXISTS task_forces_quarter_check;
ALTER TABLE task_forces ADD CONSTRAINT task_forces_quarter_check
  CHECK (quarter IS NULL OR quarter IN ('1Q','2Q','3Q','4Q'));
