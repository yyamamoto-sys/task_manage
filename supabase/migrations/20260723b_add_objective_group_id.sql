-- OKR/TFの部署別表示：objectives.group_id 追加＋既存Objectiveのバックフィル
-- 適用方法: Supabase SQL Editor に全文貼って実行（dev→prod の順）
--
-- 【背景】山本さんの要望「設定画面で表示部署を変えても、TFやOKRが違う部署のものが
-- 表示される。その部署の情報しか表示されないようにしてほしい」。OKR系テーブル
-- （objectives/key_results/task_forces）はgroup_idを持たず全社共通のため、部署で
-- 絞れなかった（CLAUDE.md Section 1.6・v2.86で既知の制約として記録済み）。
--
-- 【今回のスコープ】表示の絞り込みのみ。RLSは今回変更しない（objectives/key_results/
-- task_forces は引き続き「authenticated full access」＝USING(true)のまま。OKR全面
-- 刷新時にまとめて部署分離する）。KR/TFにはgroup_id列を追加しない。KRはobjective_id、
-- TFはkr_id→KRを辿ってObjectiveの部署を継承する（src/lib/okr/deptScope.ts参照）。
--
-- 【データモデル】既存Objectiveは全てEGG（grp-egg）へバックフィルする。AID等の
-- 他部署のOKRはPDF取込・手入力で入れ直す（山本さんと合意済みの方針）。

-- ============================================================
-- ブロック1: objectives に group_id 列を追加
-- ============================================================
ALTER TABLE objectives ADD COLUMN IF NOT EXISTS group_id text REFERENCES groups(id);

-- ============================================================
-- ブロック2: 既存Objectiveをバックフィル（group_id = 'grp-egg'）
--
-- 【注意】このUPDATEが trg_objectives_updated_at（BEFORE UPDATE、無条件で
-- updated_at=NOW()にする既存トリガー）を再発火させ、既存の全Objectiveの
-- updated_atが一律で「今」になってしまう副作用があるため、バックフィルの間だけ
-- 一時的に無効化する（20260722bのバックフィル手法に倣う）。
-- ============================================================
ALTER TABLE objectives DISABLE TRIGGER trg_objectives_updated_at;

UPDATE objectives SET group_id = 'grp-egg' WHERE group_id IS NULL;

ALTER TABLE objectives ENABLE TRIGGER trg_objectives_updated_at;

-- ============================================================
-- ブロック3: 適用後、必ず実行して確認するクエリ
--
-- 山本さんへ：以下を SQL Editor で実行し、①が 0 件であることを確認してください。
-- ============================================================

-- ① バックフィル漏れが無いこと（0件であること）
SELECT count(*) AS objectives_without_group_id
FROM objectives
WHERE group_id IS NULL;

-- ② 参考：部署別のObjective件数・現在Objectiveの内訳
SELECT group_id, is_current, count(*) AS objective_count
FROM objectives
GROUP BY group_id, is_current
ORDER BY group_id, is_current DESC;
