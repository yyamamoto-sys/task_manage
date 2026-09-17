-- ============================================================
-- マイグレーション: entity_change_logs（タスク・PJの変更履歴＋Undo）
-- 実行日: 2026-09-17
-- Supabase SQL Editor で実行してください（dev → prod の順）
-- ============================================================
--
-- 【背景】CLAUDE.md Section 57（v3.111）参照。
-- 利用者から「Excelのように、いつ誰が何を編集したかを確認し、自分でUndoできるように
-- してほしい」という要望を受け、タスク・プロジェクトの変更履歴を記録し、利用者自身が
-- Undoできる仕組みを新設する。
--
-- 【admin_change_logs（Section 7）との違い】
-- schema.sql には既に admin_change_logs というテーブルがあるが、コード上一度も
-- 読み書きされていない死蔵テーブル（`grep -rn "admin_change_logs" src` で0件）。
-- 14日削除のpg_cronの書き方（20260501_admin_logs_cleanup.sql）は参考にしたが、
-- テーブル自体は流用せず新設する（対象がタスク・PJに限定される・保持期間が90日と
-- 異なる・group_idを直接列として持つ設計にするため）。
--
-- 【前提】
-- Supabase Dashboard → Database → Extensions で `pg_cron` を有効化しておくこと。
-- 拡張未有効の場合は CREATE EXTENSION でエラーになるので Dashboard で先に enable する。
-- ============================================================

CREATE TABLE IF NOT EXISTS entity_change_logs (
  id           bigserial PRIMARY KEY,
  entity_type  text NOT NULL CHECK (entity_type IN ('task','project')),
  entity_id    text NOT NULL,
  entity_name  text NOT NULL,          -- 削除後も何だったか分かるように名前を控える
  action       text NOT NULL CHECK (action IN ('create','update','delete','restore')),
  diff         jsonb NOT NULL DEFAULT '{}'::jsonb,  -- { field: {before, after} }
  changed_by   text NOT NULL,
  changed_at   timestamptz NOT NULL DEFAULT now(),
  group_id     text REFERENCES groups(id),          -- 部署スコープ（RLS用）
  undone_at    timestamptz,
  undone_by    text
);

-- インデックス：タスク/PJ単位の表示（直近N件）と、90日削除ジョブの両方に効かせる
CREATE INDEX IF NOT EXISTS idx_entity_change_logs_entity
  ON entity_change_logs(entity_type, entity_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_entity_change_logs_changed_at
  ON entity_change_logs(changed_at);

ALTER TABLE entity_change_logs ENABLE ROW LEVEL SECURITY;

-- SELECT：自分がアクセスできる部署のログ、または全社スーパー管理者。
-- 🔴 CLAUDE.md Section 39のグランドルールに従い、SECURITY DEFINER関数呼び出しは
-- (SELECT ...) で包む（InitPlan化して1回だけ評価させるため。式の意味は変えていない）。
DROP POLICY IF EXISTS "entity_change_logs_select" ON entity_change_logs;
CREATE POLICY "entity_change_logs_select" ON entity_change_logs
  FOR SELECT TO authenticated
  USING (
    group_id = ANY((SELECT current_member_group_ids()))
    OR (SELECT current_member_is_super_admin())
  );

-- INSERT：クライアント（appStoreのchoke point経由）が直接書く。書き込み対象を絞る
-- 追加条件は付けない（記録の失敗を保存の失敗にしないため、appStore側のtry/catchが
-- 実質的な安全弁になっている。CLAUDE.md Section 57参照）。
DROP POLICY IF EXISTS "entity_change_logs_insert" ON entity_change_logs;
CREATE POLICY "entity_change_logs_insert" ON entity_change_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    group_id = ANY((SELECT current_member_group_ids()))
    OR (SELECT current_member_is_super_admin())
  );

-- UPDATE：Undo実行後に undone_at/undone_by を書き込むために許可する。
-- 🔴 SELECT と同じ部署スコープで絞る（2026-09-17・統括レビューで是正）。
-- 当初は USING (true) / WITH CHECK (true) で authenticated 全員に開けていた。
-- undone_at の誤更新は実害が小さい（表示が「取り消し済み」になるだけでデータは変わらない）が、
-- 「見えない履歴を書き換えられる」状態をわざわざ残す理由が無いため、閲覧できる範囲と揃えた。
-- v3.109（PJ編集権限）で「UIだけの制限は防御にならない」ことが実際に分かったばかりであり、
-- DB側で絞れるものはDB側で絞る。
DROP POLICY IF EXISTS "entity_change_logs_update" ON entity_change_logs;
CREATE POLICY "entity_change_logs_update" ON entity_change_logs
  FOR UPDATE TO authenticated
  USING (
    group_id = ANY((SELECT current_member_group_ids()))
    OR (SELECT current_member_is_super_admin())
  )
  WITH CHECK (
    group_id = ANY((SELECT current_member_group_ids()))
    OR (SELECT current_member_is_super_admin())
  );

-- ============================================================
-- 90日経過削除の自動化（pg_cron）。20260501_admin_logs_cleanup.sqlと同型。
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.unschedule('cleanup-entity-change-logs')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-entity-change-logs');

-- 日次 03:00 UTC（JST 12:00）に 90日より古いログを削除
SELECT cron.schedule(
  'cleanup-entity-change-logs',
  '0 3 * * *',
  $$DELETE FROM entity_change_logs WHERE changed_at < now() - interval '90 days';$$
);

-- 動作確認用クエリ（必要に応じて実行）:
--   SELECT * FROM cron.job WHERE jobname = 'cleanup-entity-change-logs';
--   SELECT * FROM cron.job_run_details WHERE jobname = 'cleanup-entity-change-logs' ORDER BY start_time DESC LIMIT 5;
