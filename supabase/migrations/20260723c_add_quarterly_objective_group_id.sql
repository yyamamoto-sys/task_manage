-- 四半期OKR（QuarterlyObjective）の部署別化：quarterly_objectives.group_id 追加＋バックフィル
-- 適用方法: Supabase SQL Editor に全文貼って実行（dev→prod の順）
--
-- 【背景】objectives.group_id（20260723b）と同様に、quarterly_objectives も部署別に
-- 分離する。KR/TFはobjective_id/kr_idを辿ってObjectiveの部署を継承する設計だが、
-- quarterly_objectivesはobjective_id経由の継承に加えて、取込元部署を明示的に
-- 持たせるためgroup_id列を直接追加する（objectivesと同じ形にして
-- lib/okr/deptScope.ts側の絞り込み関数を素直に揃えられるようにするため）。
--
-- 【重要な注意（2026-07-23 developer調査で判明）】quarterly_objectives /
-- quarterly_kr_task_forces は、2026-05-26のTF四半期判定モデル移行
-- （quarterly_kr_task_forcesテーブル→task_forces.quarter列）以降、
-- フロントエンドのどの画面からも参照されない状態になっている
-- （docs/REFACTORING.md M24で既に指摘済み・呼び出し元0件）。
-- 今回のgroup_id追加は将来の再設計に備えた土台のみで、追加した時点では
-- 表示上の挙動は変化しない（表示する画面が存在しないため）。
--
-- 【今回のスコープ】表示の絞り込みのみ。RLSは変更しない（quarterly_objectivesは
-- 引き続き「authenticated full access」のまま。OKR全面刷新時にまとめて対応）。

-- ============================================================
-- ブロック1: quarterly_objectives に group_id 列を追加
-- ============================================================
ALTER TABLE quarterly_objectives
  ADD COLUMN IF NOT EXISTS group_id text REFERENCES groups(id);

-- ============================================================
-- ブロック2: 既存行をバックフィル（objective_id を辿って親Objectiveのgroup_idを継承）
--
-- 【注意】このUPDATEが trg_quarterly_objectives_updated_at（BEFORE UPDATE、無条件で
-- updated_at=NOW()にする既存トリガー）を再発火させ、既存の全QuarterlyObjectiveの
-- updated_atが一律で「今」になってしまう副作用があるため、バックフィルの間だけ
-- 一時的に無効化する（20260723bのバックフィル手法に倣う）。
-- ============================================================
ALTER TABLE quarterly_objectives DISABLE TRIGGER trg_quarterly_objectives_updated_at;

UPDATE quarterly_objectives qo
SET group_id = o.group_id
FROM objectives o
WHERE qo.objective_id = o.id
  AND qo.group_id IS NULL
  AND o.group_id IS NOT NULL;

-- 親Objectiveのgroup_idが（万一）未設定の場合の安全網＝grp-eggへフォールバック
UPDATE quarterly_objectives SET group_id = 'grp-egg' WHERE group_id IS NULL;

ALTER TABLE quarterly_objectives ENABLE TRIGGER trg_quarterly_objectives_updated_at;

-- ============================================================
-- ブロック3: 適用後、必ず実行して確認するクエリ
--
-- 山本さんへ：以下を SQL Editor で実行し、①が 0 件であることを確認してください。
-- ============================================================

-- ① バックフィル漏れが無いこと（0件であること）
SELECT count(*) AS quarterly_objectives_without_group_id
FROM quarterly_objectives
WHERE group_id IS NULL;

-- ② 参考：部署別・四半期別の件数
SELECT group_id, quarter, count(*) AS quarterly_objective_count
FROM quarterly_objectives
GROUP BY group_id, quarter
ORDER BY group_id, quarter;
