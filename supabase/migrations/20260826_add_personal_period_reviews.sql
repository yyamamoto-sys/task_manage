-- ============================================================
-- 個人OKR：月全体・四半期全体の振り返りを記録する「全体」タブ
-- 2026-08-26（v3.101）
--
-- 【正本】CLAUDE.md Section 24（Step Q）／統括作成の仕様書
--   （okr_overall_tab_spec.md。§0-1に山本さんが確定した設計判断の表あり）
--
-- 【今回作る1テーブル】personal_period_reviews
--   月全体・四半期全体を1テーブルで持つ（2テーブルに割るとRLS・ストア・UIが二重になり、
--   同じ処理のコピペが生まれるため。§2山本さんの依頼原文＝月次面談で受け取る
--   「その月全体の自己評価とGM評価・コメント」を記録する場所が無い、を埋めるもの）。
--
-- 【記録項目（山本さんが選んだ設計判断・変更禁止）】
-- 全体の自己評価% / GM評価% / 全体の振り返り本文（本人） / GMコメント の4つ。
-- 面談日・来月への申し送りは選ばれなかったので作らない（列を持たせない）。
--
-- 【🔴 一意制約は部分ユニークインデックス2本で張る（最重要）】
-- UNIQUE(member_id, period_kind, fiscal_year, quarter, month) は使わない。Postgresでは
-- NULL同士は相異なると扱われるため、period_kind='quarter'（month は常にNULL）の行が
-- 何行あってもこの制約は重複を検出できない。月の一意性と四半期の一意性を、
-- 別々の部分インデックス（WHERE句で行を絞り込む）で個別に保証する。
--
-- 【RLSは本人のみ。既存の作法（personal_krs_own）をそのまま踏襲】
-- 🔴 新しいヘルパー関数を作らない。この表はmember_idを直接持つため1ホップ不要
-- （20260807b_add_personal_okr.sqlの personal_krs と同じ「列としてmember_idを持つ場合は
-- 直接比較」の判断。他の4テーブルのような「親を辿るポリシー」は不要）。
-- 🔴 NULL猶予条項（`OR ... IS NULL` での抜け穴）は一切書かない（2026-06-26の事故の教訓。
-- CLAUDE.md Section 1.6）。
--
-- 【member_id は text（groups/personal_krs と同じ）】
-- personal_krs.member_id / current_member_id() はどちらも text を返す（members.id が text）。
--
-- 【personal_krs同様、fiscal_year/quarterを冗長に持つ理由】
-- 月全体の行（period_kind='month'）にもfiscal_year/quarterを持たせているのは、
-- 「対象期」の四半期セレクタから月全体の行を辿る際に、月の日付から四半期を逆算する
-- 計算をUI側に持たせず、保存時点の対象期をそのまま記録として残すため（personal_krsが
-- fiscal_year/quarterを直接列として持つのと同じ考え方）。
--
-- 【適用】Supabase SQL Editor に全文を貼って実行する（dev → prod の順）。
--   ⚠️ このファイルは山本さんが手動で適用します。エージェントは適用しないこと。
-- ============================================================

-- ============================================================
-- ブロック1: personal_period_reviews（月全体・四半期全体の振り返り）
-- ============================================================
CREATE TABLE IF NOT EXISTS personal_period_reviews (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id      text NOT NULL REFERENCES members(id),
  period_kind    text NOT NULL CHECK (period_kind IN ('month','quarter')),
  fiscal_year    integer NOT NULL,
  quarter        text NOT NULL CHECK (quarter IN ('1Q','2Q','3Q','4Q')),
  month          date,                                   -- 月初(YYYY-MM-01)。period_kind='quarter'のときはNULL
  self_eval_pct  numeric,
  gm_eval_pct    numeric,
  review_text    text,
  gm_comment     text,
  is_deleted     boolean NOT NULL DEFAULT false,
  deleted_at     timestamptz,
  deleted_by     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     text NOT NULL DEFAULT '',
  CONSTRAINT personal_period_reviews_month_shape CHECK (
    (period_kind = 'month'   AND month IS NOT NULL) OR
    (period_kind = 'quarter' AND month IS NULL)
  )
);

-- ============================================================
-- ブロック2: 一意制約（部分ユニークインデックス2本。UNIQUE(...,month)は使わない）
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_personal_period_reviews_month_unique
  ON personal_period_reviews(member_id, month)
  WHERE period_kind = 'month' AND is_deleted = false;

CREATE UNIQUE INDEX IF NOT EXISTS idx_personal_period_reviews_quarter_unique
  ON personal_period_reviews(member_id, fiscal_year, quarter)
  WHERE period_kind = 'quarter' AND is_deleted = false;

-- 一覧・突合用の補助インデックス（一意制約とは別。「自分の全行」を1回で取る問い合わせ用）
CREATE INDEX IF NOT EXISTS idx_personal_period_reviews_member_id
  ON personal_period_reviews(member_id) WHERE is_deleted = false;

-- ============================================================
-- ブロック3: updated_at トリガー（既存のupdate_updated_at()を再利用。新規関数は作らない）
-- ============================================================
DROP TRIGGER IF EXISTS trg_personal_period_reviews_updated_at ON personal_period_reviews;
CREATE TRIGGER trg_personal_period_reviews_updated_at
  BEFORE UPDATE ON personal_period_reviews
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- ブロック4: RLS有効化＋ポリシー（本人のみ。member_idを直接持つため1ホップ不要）
-- ============================================================
ALTER TABLE personal_period_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "personal_period_reviews_own" ON personal_period_reviews;
CREATE POLICY "personal_period_reviews_own" ON personal_period_reviews
  FOR ALL TO authenticated
  USING (member_id = current_member_id())
  WITH CHECK (member_id = current_member_id());

-- ============================================================
-- ブロック5: 適用後の確認クエリ（山本さんへ：以下を実行し、期待どおりであることを確認してください）
-- ============================================================

-- 1) テーブルが作成されたか
-- SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public' AND table_name = 'personal_period_reviews';
-- → 1件であること

-- 2) RLSが有効化されているか（relrowsecurity = true であること）
-- SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'personal_period_reviews';

-- 3) 緩いポリシー（本人チェックを含まない USING(true) 等）が残っていないか（0件であること）
-- SELECT tablename, policyname, qual, with_check
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename = 'personal_period_reviews'
--   AND coalesce(qual, '') NOT ILIKE '%current_member_id%'
--   AND coalesce(with_check, '') NOT ILIKE '%current_member_id%';
-- → 0行であること

-- 4) NULL猶予条項（IS NULLでの抜け穴）が無いか（0件であること）
-- SELECT tablename, policyname FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'personal_period_reviews'
--   AND (coalesce(qual, '') ILIKE '%is null%' OR coalesce(with_check, '') ILIKE '%is null%');
-- → 0行であること

-- 5) 部分ユニークインデックスが2本とも存在するか
-- SELECT indexname FROM pg_indexes
-- WHERE schemaname = 'public' AND tablename = 'personal_period_reviews'
--   AND indexname IN ('idx_personal_period_reviews_month_unique', 'idx_personal_period_reviews_quarter_unique');
-- → 2件であること

-- 6) 四半期行（monthがNULL）を2回保存しても重複しないか（実際にアプリから四半期全体の
--    振り返りを1件保存した状態で以下を実行し、1件のみであることを確認）
-- SELECT member_id, fiscal_year, quarter, count(*) FROM personal_period_reviews
-- WHERE period_kind = 'quarter' AND is_deleted = false
-- GROUP BY member_id, fiscal_year, quarter HAVING count(*) > 1;
-- → 0行であること
