-- ============================================================
-- OKRモード再設計 Phase 4：personal_kr_review_drafts（月末の振り返り下書き）テーブル追加
-- 2026-08-20（v3.83）
--
-- 【正本】docs/dev/okr-redesign-plan.md §8（段階計画・Phase 4）／CLAUDE.md Section 24 Step M
--
-- 【下書きはDBに残す（山本さんの判断・D1）】
-- AIが生成した振り返りの下書きをpersonal_kr_review_draftsに永続化する。行き先は
-- Kintone「個人OKR_月次振返り記録」の「振り返り」欄の地の文（貼り付け運用。Kintoneへの
-- 自動書き込みはしない）。
--
-- 【🔴 personal_kr_outlooks との違い（同じ「AI生成の履歴テーブル」でも書き込み方が違う）】
-- outlooksはAI生成のたびに毎回INSERTして履歴として積む（UPDATEしない・updated_at列を
-- 持たない）。このテーブルも「AI生成」自体は同じくINSERT専用で履歴として積むが、
-- **人の編集だけは直近行のedited_text/edited_atをUPDATEする**（20260811_add_personal_kr_outlooks.sql
-- とはここが異なる）。理由：下書きは「AIが発行して終わり」ではなく、人がKintoneに貼る前に
-- 文章を仕上げる（言い回しを直す・具体を足す等）ものだから。編集のたびに新しい行を積むと
-- 「今どれが最新の下書きか」が行の乱立で分からなくなり、UI側も複雑になる。AI再生成
-- （force:true）のときだけ新しい行をINSERTし、そのタイミングで編集内容は自然に上書きされる
-- （再生成＝作り直しなので編集の引き継ぎはしない。これも意図的な割り切り）。
-- updated_at列・updated_atトリガーは持たせない（他5テーブルとは異なる。edited_atはコードから
-- 明示的に書く。src/lib/supabase/personalOkrStore.tsのupdatePersonalKrReviewDraftEdit参照）。
--
-- 【RLSは本人のみ。既存の「親を辿るポリシー」をそのまま使う】
-- 🔴 新しいヘルパー関数を増やさない（計画書・CLAUDE.md指示）。personal_kr_id →
-- personal_krs の所有者判定は、20260807b_add_personal_okr.sql で作成済みの
-- personal_kr_owner_member_id(uuid) をそのまま使う（personal_kr_outlooksと同じ関数）。
-- personal_kr_outlooks_own と同型のポリシー（FOR ALL TO authenticated・USING と
-- WITH CHECK 同一）にする。FOR ALLでUPDATEも許可されるため、人の編集（UPDATE）は
-- このポリシー1本でそのまま通る（追加の書き込み用ポリシーは不要）。
-- 🔴 NULL猶予条項は一切書かない（2026-06-26の事故の教訓。CLAUDE.md Section 1.6）。
--
-- 【過去月でも生成できる理由（D3・実務上の必須要件）】
-- 8月の振り返りは9月に書くのが実態のため、対象月がclassifyMonth()でpastでも下書きを
-- 生成できる（CLAUDE.md Section 24 Step M参照）。テーブル・RLS側には月の状態（past/
-- current/future）による制約は設けない（アプリ側のUIが「未来月は材料が無いため不可」を
-- 判断する。DB側は月の値をそのまま受け取るだけ）。
--
-- 【自己評価％・達成度バンドの数値をAIに書かせない理由（D2・山本さんの判断）】
-- draft_jsonにはreview_text/evidence/carryoverの3項目のみを格納する（自己評価%・
-- 達成度バンドの数値は含めない）。テーブル制約としては特に列を分けず自由なjsonbのままにするが、
-- 生成側（src/lib/ai/personalOkrReviewDraftExtractor.ts）のシステムプロンプトと
-- バリデーションでこの方針を強制する（計画書§6「バンドは見通しであって評価ではない」の延長）。
--
-- 【ドル引用タグ】既存のpersonal_kr_owner_member_idを再利用するだけで新規関数は作らないため、
-- 本ファイルはCREATE OR REPLACE FUNCTIONを含まない。SET search_path = ''の対象になる
-- 新規関数も無い。
--
-- 【適用】Supabase SQL Editor に全文を貼って実行する（dev → prod の順）。
--   ⚠️ このファイルは山本さんが手動で適用します。エージェントは適用しないこと。
-- ============================================================

-- ============================================================
-- ブロック1: personal_kr_review_drafts（月末の振り返り下書き）
-- ============================================================
CREATE TABLE IF NOT EXISTS personal_kr_review_drafts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  personal_kr_id     uuid NOT NULL REFERENCES personal_krs(id),
  month              date NOT NULL,                          -- 月初（YYYY-MM-01）。過去月でも生成可
  input_fingerprint  text NOT NULL,                           -- 一致したら再生成しない（reviewDraftRunner.ts）
  draft_json         jsonb NOT NULL,                          -- { review_text, evidence, carryover }
  edited_text        text,                                    -- 人が編集して保存した本文（UPDATE対象）
  edited_at          timestamptz,                             -- 編集保存日時（UPDATE対象）
  model              text,                                    -- 使用したモデル名（例：claude-sonnet-4-6）
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- ブロック2: RLS有効化＋ポリシー（本人のみ。既存の personal_kr_owner_member_id を再利用）
-- ============================================================
ALTER TABLE personal_kr_review_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "personal_kr_review_drafts_own" ON personal_kr_review_drafts;
CREATE POLICY "personal_kr_review_drafts_own" ON personal_kr_review_drafts
  FOR ALL TO authenticated
  USING (personal_kr_owner_member_id(personal_kr_id) = current_member_id())
  WITH CHECK (personal_kr_owner_member_id(personal_kr_id) = current_member_id());

-- ============================================================
-- ブロック3: インデックス
-- ============================================================
-- 「このKR・この月の最新の下書きを1件取る」問い合わせを想定した並び順
CREATE INDEX IF NOT EXISTS idx_personal_kr_review_drafts_kr_month_created
  ON personal_kr_review_drafts(personal_kr_id, month, created_at DESC);

-- ============================================================
-- ブロック4: 適用後の確認クエリ（山本さんへ：以下を実行し、期待どおりであることを確認してください）
-- ============================================================

-- 1) テーブルが作成されたか
-- SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public' AND table_name = 'personal_kr_review_drafts';
-- → 1件であること

-- 2) RLSが有効化されているか（relrowsecurity = true であること）
-- SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'personal_kr_review_drafts';

-- 3) 緩いポリシー（本人チェックを含まない USING(true) 等）が残っていないか（0件であること）
-- SELECT tablename, policyname, qual, with_check
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename = 'personal_kr_review_drafts'
--   AND coalesce(qual, '') NOT ILIKE '%personal_kr_owner_member_id%'
--   AND coalesce(with_check, '') NOT ILIKE '%personal_kr_owner_member_id%';
-- → 0行であること

-- 4) NULL猶予条項（IS NULLでの抜け穴）が無いか（0件であること）
-- SELECT tablename, policyname FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'personal_kr_review_drafts'
--   AND (coalesce(qual, '') ILIKE '%is null%' OR coalesce(with_check, '') ILIKE '%is null%');
-- → 0行であること
