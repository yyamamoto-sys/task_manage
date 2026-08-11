-- ============================================================
-- OKRモード再設計 Phase 3 前半：personal_kr_outlooks（AI解析の結果とキャッシュ）テーブルのみ追加
-- 2026-08-11（v3.51）
--
-- 【正本】docs/dev/okr-redesign-plan.md §3-6（データモデル）・§5（AI解析のトリガー設計）・
-- §6（達成度バンドは3値を区別）・§8（段階計画・Phase 3）
--
-- 【今回はテーブルだけ作る。書き込みは無い】
-- Phase 3前半（本マイグレーション時点）はAI呼び出しを実装しない（機械計算のみ）。
-- input_fingerprint の計算（src/lib/personalOkr/outlookFingerprint.ts）・「これから」ブロックの
-- 機械計算部分（src/lib/personalOkr/aheadCompute.ts等）はこのテーブルを一切参照しない。
-- Phase 3後半でAI呼び出しを実装したときに初めてこのテーブルへのINSERTが発生する。
--
-- 【履歴として積む。上書きしない】
-- outlook_json/band_ai は月が進むたびに、あるいは再解析のたびに新しい行としてINSERTする
-- （UPDATEしない）。updated_at列を持たない・updated_atトリガーも貼らない（他5テーブルとは
-- ここが異なる。project_invites と同じ「発行して終わり・以後書き換えない」形の先例に倣った）。
--
-- 【RLSは本人のみ。既存の「親を辿るポリシー」をそのまま使う】
-- 🔴 新しいヘルパー関数を増やさない（計画書§3-6・CLAUDE.md指示）。personal_kr_id →
-- personal_krs の所有者判定は、20260807b_add_personal_okr.sql で作成済みの
-- personal_kr_owner_member_id(uuid) をそのまま使う（personal_kr_months/personal_kr_weeksと
-- 同じ関数）。current_member_id() も新設しない（既存の全社共通ヘルパー）。
-- 🔴 NULL猶予条項は一切書かない（2026-06-26の事故の教訓。CLAUDE.md Section 1.6）。
--
-- 【band_ai は60/70/80/90/100のCHECK（NULL可）】
-- personal_kr_months.band_target/band_override と同じ制約にする（bandOptions.tsのBAND_VALUESと
-- 一致させる）。NULLを許すのは「見立てのJSONは作れたがバンド判定はまだ確信が持てない」ケースを
-- 表現できるようにするため（Phase 3後半の実装判断だが、列の制約としては今のうちに許容しておく）。
--
-- 【ドル引用タグは関数ごとに区別】
-- 既存の personal_kr_owner_member_id を再利用するだけで新規関数は作らないため、本ファイルは
-- CREATE OR REPLACE FUNCTION を含まない。SET search_path = '' の対象になる新規関数も無い。
--
-- 【適用】Supabase SQL Editor に全文を貼って実行する（dev → prod の順）。
--   ⚠️ このファイルは山本さんが手動で適用します。エージェントは適用しないこと。
-- ============================================================

-- ============================================================
-- ブロック1: personal_kr_outlooks（AI解析の結果とキャッシュ・履歴として積む）
-- ============================================================
CREATE TABLE IF NOT EXISTS personal_kr_outlooks (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  personal_kr_id     uuid NOT NULL REFERENCES personal_krs(id),
  month              date NOT NULL,                          -- 月初（YYYY-MM-01）。personal_kr_months.monthと突き合わせる
  input_fingerprint  text NOT NULL,                           -- 一致したら再解析しない（§5-2）。src/lib/personalOkr/outlookFingerprint.ts
  outlook_json       jsonb NOT NULL,                          -- 見立て・週ごとの一手・捨てる候補（Phase 3後半で書き込み開始）
  band_ai            integer CHECK (band_ai IS NULL OR band_ai IN (60,70,80,90,100)),  -- 月の途中でも出す「見通し」
  band_ai_reason     text,                                    -- 判定の根拠
  model              text,                                    -- 使用したモデル名（例：claude-sonnet-4-6）
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- ブロック2: RLS有効化＋ポリシー（本人のみ。既存の personal_kr_owner_member_id を再利用）
-- ============================================================
ALTER TABLE personal_kr_outlooks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "personal_kr_outlooks_own" ON personal_kr_outlooks;
CREATE POLICY "personal_kr_outlooks_own" ON personal_kr_outlooks
  FOR ALL TO authenticated
  USING (personal_kr_owner_member_id(personal_kr_id) = current_member_id())
  WITH CHECK (personal_kr_owner_member_id(personal_kr_id) = current_member_id());

-- ============================================================
-- ブロック3: インデックス
-- ============================================================
-- 「このKR・この月の最新の解析結果を1件取る」問い合わせを想定した並び順
CREATE INDEX IF NOT EXISTS idx_personal_kr_outlooks_kr_month_created
  ON personal_kr_outlooks(personal_kr_id, month, created_at DESC);

-- ============================================================
-- ブロック4: 適用後の確認クエリ（山本さんへ：以下を実行し、期待どおりであることを確認してください）
-- ============================================================

-- 1) テーブルが作成されたか
-- SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public' AND table_name = 'personal_kr_outlooks';
-- → 1件であること

-- 2) RLSが有効化されているか（relrowsecurity = true であること）
-- SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'personal_kr_outlooks';

-- 3) 緩いポリシー（本人チェックを含まない USING(true) 等）が残っていないか（0件であること）
-- SELECT tablename, policyname, qual, with_check
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename = 'personal_kr_outlooks'
--   AND coalesce(qual, '') NOT ILIKE '%personal_kr_owner_member_id%'
--   AND coalesce(with_check, '') NOT ILIKE '%personal_kr_owner_member_id%';
-- → 0行であること

-- 4) NULL猶予条項（IS NULLでの抜け穴）が無いか（0件であること）
-- SELECT tablename, policyname FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'personal_kr_outlooks'
--   AND (coalesce(qual, '') ILIKE '%is null%' OR coalesce(with_check, '') ILIKE '%is null%');
-- → 0行であること
