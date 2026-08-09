-- ============================================================
-- OKRモード再設計 Phase 1 Step C：クォーター計画のSupabase移行
-- 2026-08-07（v3.38）
--
-- 【正本】docs/dev/okr-redesign-plan.md §9（既存の整理）
--
-- 【背景】src/lib/supabase/quarterPlanStore.ts は「Phase 1: localStorageで実装
-- （IT部門のSupabase承認後にDB移行予定）」というコメントのまま2026-06-01頃から
-- 取り残されていた。2026-08-07に山本さんが「Supabase保存は問題ない」と確認済み
-- （CLAUDE.md Section 1・是正済み）。個人のブラウザにしか残らずチームで共有できない
-- 状態を解消する。
--
-- 【テーブル名・列は現行localStorageの保存形をそのまま素直にテーブル化する】
-- quarterPlanStore.ts の QuarterPlan / ProposedTF 型どおり。tfs は元々1本のJSON配列と
-- してlocalStorageに丸ごと保存されていた（docs/migrations/20260601_quarter_plans.sqlの
-- ドラフトはproposed_tfsを別テーブルに正規化していたが、これは「そのまま素直に」の指示に
-- 反する新しい概念のため採用しない。ドラフトのまま未実行だったファイルであり、今回は
-- 参照のみで別物として書き直す）。
--   id / kr_id / quarter / status / summary / tfs（jsonb配列） / overall_risk
--   ＋ 標準の audit列（is_deleted/deleted_at/deleted_by/created_at/updated_at/updated_by）
--
-- 【RLS：部署スコープにした理由（個人OKR＝本人のみ、とは異なる判断）】
-- クォーター計画（KrQuarterPlanPanel）はマネージャー（GM/AGM/OM）が翌クォーターの
-- Task Force計画を立てる機能で、対象は特定個人ではなく「KRに紐づくチームの資産」。
-- 複数のマネージャーが同じKRの計画を見る・引き継ぐ可能性がある（例：GMが起案し
-- AGMが引き継ぐ）。personal_krs等（本人のみ・docs/dev/okr-redesign-plan.md §4）とは
-- 性質が違うため、既存の部署スコープの流儀（20260724_scope_okr_core_tables.sql）を
-- そのまま踏襲する：
--   ・自前のgroup_id列を持たせ、BEFORE INSERT/UPDATEトリガー
--     （sync_kr_quarter_plan_group_id）で親（key_results.group_id）から自動注入する。
--     フロントはgroup_idを一切送らない。
--   ・RLSは `group_id = ANY(current_member_group_ids()) OR current_member_is_super_admin()`。
--   ・NULL猶予条項は一切書かない（2026-06-26の事故の教訓。CLAUDE.md Section 1.6）。
--   ・親のkey_resultsのgroup_idが将来変わる（部署異動）場合のカスケードは今回実装しない
--     （personal_kr系と同じ割り切り。kr_quarter_plansは葉テーブルで、既存のカスケード
--     関数〈cascade_kr_group_id_to_tfs等〉はtask_forcesしか更新しないため、既存関数を
--     変更せずに済むこの割り切りを優先した。将来必要になれば個別に追加すればよい）。
--
-- 【「保存」は常に1本のアクティブ計画を上書きする（localStorageの挙動を保つ）】
-- 元のquarterPlanStore.saveQuarterPlanは呼ぶたびに新しいidでlocalStorageの同じキーを
-- 上書きしていた（＝1つの(kr_id, quarter)につき常に「今のもの」が1つだけ存在する）。
-- 物理削除禁止（CLAUDE.md Section 4）とこの「1本だけ」という原則を両立させるため、
-- (kr_id, quarter) に「is_deleted=falseの行は最大1件」という部分UNIQUE制約を張る。
-- ストア側（quarterPlanStore.ts）は保存前に既存のアクティブ行を検索し、あれば同じidを
-- 再利用してsaveWithLock（楽観ロック）で更新、無ければ新しいidでINSERTする——これにより
-- チーム内の同時編集も他の全テーブルと同じ楽観ロックで検出できる（元のlocalStorage実装には
-- 無かった安全性で、部署スコープ化した以上必要になったもの）。
-- 削除（deleteQuarterPlan）はis_deleted=trueにする論理削除に変更した（元はlocalStorage.
-- removeItemという物理削除だったが、Section 4に合わせて変更する）。
--
-- 【適用】Supabase SQL Editor に全文を貼って実行する（dev → prod の順）。
--   ⚠️ このファイルは山本さんが手動で適用します。エージェントは適用しないこと。
--   ⚠️ 適用するまでコードは本番で機能しない（schemaChecksの警告バナーが管理者に出る。
--      テーブル未適用時はエラーメッセージで明示表示する設計にしてある。CLAUDE.md Section 22）。
-- ============================================================

-- ============================================================
-- ブロック1: kr_quarter_plans テーブル
-- ============================================================
CREATE TABLE IF NOT EXISTS kr_quarter_plans (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kr_id         text NOT NULL REFERENCES key_results(id),
  group_id      text REFERENCES groups(id),  -- key_results経由でトリガーが自動注入。フロントは送らない
  quarter       text NOT NULL,                -- 例: "2026-3Q"（krQuarterPlanPrompt.tsの表現をそのまま）
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'finalized')),
  summary       text NOT NULL DEFAULT '',
  tfs           jsonb NOT NULL DEFAULT '[]'::jsonb,  -- ProposedTF[]をそのまま丸ごと保存（正規化しない）
  overall_risk  text,
  is_deleted    boolean NOT NULL DEFAULT false,
  deleted_at    timestamptz,
  deleted_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text NOT NULL DEFAULT ''
);

-- 「1つの(kr_id, quarter)につきアクティブな計画は最大1件」（localStorageの単一キー上書きと同じ制約）
CREATE UNIQUE INDEX IF NOT EXISTS kr_quarter_plans_active_unique
  ON kr_quarter_plans (kr_id, quarter)
  WHERE is_deleted = false;

-- ============================================================
-- ブロック2: updated_at トリガー（既存のupdate_updated_at()を使う。新設しない）
-- ============================================================
DROP TRIGGER IF EXISTS trg_kr_quarter_plans_updated_at ON kr_quarter_plans;
CREATE TRIGGER trg_kr_quarter_plans_updated_at
  BEFORE UPDATE ON kr_quarter_plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- ブロック3: group_id 自動注入トリガー（親=key_results経由。20260724のsync_tf_group_idと同型）
-- ============================================================
CREATE OR REPLACE FUNCTION sync_kr_quarter_plan_group_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_sync_kr_quarter_plan_group_id$
BEGIN
  SELECT kr.group_id INTO NEW.group_id
  FROM public.key_results kr
  WHERE kr.id = NEW.kr_id;
  RETURN NEW;
END;
$fn_sync_kr_quarter_plan_group_id$;

DROP TRIGGER IF EXISTS trg_kr_quarter_plans_sync_group_id ON kr_quarter_plans;
CREATE TRIGGER trg_kr_quarter_plans_sync_group_id
  BEFORE INSERT OR UPDATE ON kr_quarter_plans
  FOR EACH ROW EXECUTE FUNCTION sync_kr_quarter_plan_group_id();

-- ============================================================
-- ブロック4: RLS（部署スコープ。NULL猶予条項は一切書かない）
-- ============================================================
ALTER TABLE kr_quarter_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated full access" ON kr_quarter_plans;
DROP POLICY IF EXISTS "kr_quarter_plans_group" ON kr_quarter_plans;
CREATE POLICY "kr_quarter_plans_group" ON kr_quarter_plans FOR ALL TO authenticated
  USING (group_id = ANY(current_member_group_ids()) OR current_member_is_super_admin())
  WITH CHECK (group_id = ANY(current_member_group_ids()) OR current_member_is_super_admin());

-- ============================================================
-- ブロック5: インデックス
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_kr_quarter_plans_kr_id ON kr_quarter_plans(kr_id) WHERE is_deleted = false;

-- ============================================================
-- ブロック6: 適用後の確認クエリ（山本さんへ：以下を実行し、期待どおりであることを確認してください）
-- ============================================================

-- 1) テーブルが作成されたか
-- SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public' AND table_name = 'kr_quarter_plans';

-- 2) RLSが有効化されているか（relrowsecurity = true であること）
-- SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'kr_quarter_plans';

-- 3) 緩いポリシー（部署チェックを含まない USING(true) 等）が残っていないか（0件であること）
-- SELECT tablename, policyname, qual, with_check
-- FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'kr_quarter_plans'
--   AND coalesce(qual, '') NOT ILIKE '%current_member_group_ids%'
--   AND coalesce(with_check, '') NOT ILIKE '%current_member_group_ids%';
-- → 0行であること

-- 4) NULL猶予条項（IS NULLでの抜け穴）が無いか（0件であること）
-- SELECT tablename, policyname FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'kr_quarter_plans'
--   AND (coalesce(qual, '') ILIKE '%is null%' OR coalesce(with_check, '') ILIKE '%is null%');
-- → 0行であること

-- 5) 保存後、対象KRの部署が正しくgroup_idに入っているか
-- SELECT id, kr_id, quarter, group_id, status FROM kr_quarter_plans ORDER BY created_at DESC LIMIT 5;
