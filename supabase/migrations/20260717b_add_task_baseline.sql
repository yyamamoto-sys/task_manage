-- B4: タスクのベースライン（当初計画）記録＋ガントのゴーストバー差分表示の土台
-- 適用方法: Supabase SQL Editor に全文貼って実行（冪等・何度実行してもOK）
--
-- 【背景】task_manage をPM特化ツールへ進化させる方針の一部（project_task_manage.md 参照）。
-- 依存ゲート（B1）→ ガント矢印可視化（B2）→ 自動リスケ連鎖（B3、未着手）→
-- ベースライン差分（B4）の段階リリースのうち、今回は B4（当初計画 vs 実際の差分表示）のみ。
--
-- 【捕捉タイミング（アプリ側 appStore.saveTask で判定）】
-- タスクの start_date・due_date の両方が「初めて」揃った時点のスナップショットを凍結する。
-- 一度セットされたら二度と自動上書きしない（純粋関数 src/lib/baseline/baselineCapture.ts
-- の resolveBaselineFields が判定）。
--
-- 【このマイグレーションで追加するもの】
-- 1. tasks.baseline_start_date / tasks.baseline_due_date（nullable date列）
-- 2. 既存タスクのバックフィル：start_date・due_date が両方既に揃っているタスクは、
--    このマイグレーション適用時点の現在値を baseline としてセットする
--    （＝以後の変更だけが「遅延」として計測される。既存タスクは適用時点で遅延0から始まる）

-- ============================================================
-- ブロック1: 列追加
-- ============================================================
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS baseline_start_date date;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS baseline_due_date date;

COMMENT ON COLUMN tasks.baseline_start_date IS
  '当初計画の開始日。start_date・due_date が初めて両方揃った時点で凍結し、以後は自動更新しない（B4）。';
COMMENT ON COLUMN tasks.baseline_due_date IS
  '当初計画の期日。start_date・due_date が初めて両方揃った時点で凍結し、以後は自動更新しない（B4）。';

-- ============================================================
-- ブロック2: 既存タスクのバックフィル（冪等：baseline未設定の行のみ対象）
-- ============================================================
UPDATE tasks
SET baseline_start_date = start_date,
    baseline_due_date   = due_date
WHERE start_date IS NOT NULL
  AND due_date IS NOT NULL
  AND baseline_start_date IS NULL
  AND baseline_due_date IS NULL;
