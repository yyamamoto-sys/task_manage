-- ============================================================
-- 個人OKR：KRの構成とウェイトが月をまたいで変わる運用への対応（対象月列）
-- 2026-08-26（v3.104）
--
-- 【正本】CLAUDE.md Section 24（本バージョンで追記）／統括作成の仕様書
--   （okr_month_scoped_kr_spec.md。§0-1に山本さんが確定した設計判断の表あり）
--
-- 【背景】山本さんの依頼：「全社や部署の環境変化によって、個人OKRのKRそのものや
-- パーセンテージが、月を跨ぐと変わる可能性がある」。7月専用に置いたKRが、8月にも
-- KRとウェイトごと残ってしまう現象への対応。
--
-- 【今回の変更】personal_krs に「対象月」列を1本追加するのみ（新テーブルは作らない）。
--   active_month_indexes integer[]  -- そのKRを対象とする月（1〜3のうち1個以上）
--
-- 【🔴 既存行はDEFAULTで{1,2,3}になる＝従来の挙動（全月対象）がそのまま保たれる。
-- これは意図した後方互換】既存の個人KRは全て「四半期を通して対象」という前提で
-- 運用されてきたため、移行時に何もしなくても壊れない。
--
-- 【月ごとのウェイト変更（weight_override_pct）は今回初めて有効化する】
-- personal_kr_months.weight_override_pct は列・型・Kintone取込処理まで既に存在するが、
-- 表示にも計算にも一度も使われていなかった（20260807b_add_personal_okr.sqlで追加済み）。
-- 本マイグレーションでは列を追加しない（対象外）。フロント側の実効ウェイト解決
-- （src/lib/personalOkr/krMonthScope.ts）で今回初めて使うようになる。
--
-- 【🔴 CHECK制約の罠：array_length('{}',1) はNULLを返す】
-- 空配列に対して array_length(arr, 1) は 0 ではなく NULL を返す。NULL >= 1 も NULL であり、
-- CHECK制約はNULLを「違反ではない」として通過させてしまう（falseのときだけ拒否する）。
-- 必ず coalesce(array_length(active_month_indexes, 1), 0) >= 1 の形にする。
-- 併せて active_month_indexes <@ ARRAY[1,2,3] で1〜3の範囲外の値を弾く。
--
-- 【RLSは新設しない】personal_krs の既存ポリシー（personal_krs_own）が列追加後もそのまま
-- 効く（RLSは行単位のフィルタであり、列の追加によって変わらない）。
--
-- 【🔴 未適用時の安全対策はフロント側で実施（本ファイルの対象外）】
-- 新しい列を保存ペイロードに含めた状態でこのマイグレーション未適用だと、PostgRESTが
-- PGRST204（column not found）を返しKRの保存が全滅する（2026-08-12のupsertTask全滅事故と
-- 同型）。読み取り側の既定値解決（undefinedのとき[1,2,3]として扱う）・schemaChecks.tsへの
-- 検査項目追加・PGRST204専用の案内文言は全てフロント側（TypeScript）で対応済み。
--
-- 【適用】Supabase SQL Editor に全文を貼って実行する（dev → prod の順）。
--   ⚠️ このファイルは山本さんが手動で適用します。エージェントは適用しないこと。
-- ============================================================

-- ============================================================
-- ブロック1: personal_krs に active_month_indexes 列を追加
-- ============================================================
ALTER TABLE personal_krs
  ADD COLUMN IF NOT EXISTS active_month_indexes integer[] NOT NULL DEFAULT ARRAY[1,2,3];

-- ============================================================
-- ブロック2: CHECK制約（空配列と範囲外の値を弾く）
-- ============================================================
ALTER TABLE personal_krs
  DROP CONSTRAINT IF EXISTS personal_krs_active_month_indexes_check;

ALTER TABLE personal_krs
  ADD CONSTRAINT personal_krs_active_month_indexes_check
  CHECK (
    coalesce(array_length(active_month_indexes, 1), 0) >= 1
    AND active_month_indexes <@ ARRAY[1,2,3]
  );

-- ============================================================
-- 確認クエリ（Supabase SQL Editorで個別に実行して確認する）
-- ============================================================

-- 1) 列が存在し、型・デフォルトが正しいか
-- SELECT column_name, data_type, udt_name, column_default, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'personal_krs' AND column_name = 'active_month_indexes';
-- → udt_name = '_int4'（integer[]の内部表記）・column_default に 'ARRAY[1, 2, 3]' を含む・
--   is_nullable = 'NO' であること

-- 2) 既存行が全て {1,2,3} になっているか（バックフィル漏れが無いこと）
-- SELECT count(*) FROM personal_krs
-- WHERE active_month_indexes IS DISTINCT FROM ARRAY[1,2,3];
-- → 0件であること（このマイグレーション適用前から存在する行はすべて全月対象のまま）

-- 3) CHECK制約が存在するか
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
-- WHERE conrelid = 'personal_krs'::regclass AND conname = 'personal_krs_active_month_indexes_check';
-- → 1件であり、定義に array_length と <@ の両方が含まれること

-- 4) CHECK制約が実際に空配列を拒否するか（拒否されることを確認したらROLLBACKする）
-- BEGIN;
--   UPDATE personal_krs SET active_month_indexes = '{}' WHERE id = (SELECT id FROM personal_krs LIMIT 1);
-- → エラー（new row violates check constraint "personal_krs_active_month_indexes_check"）になること
-- ROLLBACK;

-- 5) CHECK制約が範囲外の値（例：4）を拒否するか（拒否されることを確認したらROLLBACKする）
-- BEGIN;
--   UPDATE personal_krs SET active_month_indexes = ARRAY[1,4] WHERE id = (SELECT id FROM personal_krs LIMIT 1);
-- → エラーになること
-- ROLLBACK;
