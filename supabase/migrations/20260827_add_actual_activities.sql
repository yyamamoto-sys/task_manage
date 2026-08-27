-- 想定クエリ名（Supabase SQL Editorで保存する場合の名前）: add_actual_activities

-- ============================================================
-- 個人OKR：実施記録（月の途中で生じた緊急対応・方針転換・計画外の追加業務の自由記述）
-- 2026-08-27（v3.105）
--
-- 【正本】CLAUDE.md Section 24（本バージョンで追記）
--
-- 【山本さんの依頼原文】
-- 振返りを下書きする際に、現在はアプリに載っている「計画」と「毎週の目標」だけが
-- 参考材料になっており、実際に何をやったかという事後の記録が無い。そのため当初の計画に
-- 対する遵守は加味されるが、途中で生じた緊急対応や方針転換、プラスアルファで実施した
-- 業務が反映されない。この情報を自由記述できるようにする。
--
-- 【今回の変更】既存2テーブルに1列ずつ追加するのみ（新テーブルは作らない）。
--   personal_kr_months.actual_activities      text  -- KR×月の実施記録
--   personal_period_reviews.actual_activities text  -- 月全体・四半期全体の実施記録
--                                                    （period_kindがmonth/quarterの
--                                                     両方を持つ既存テーブルのため、
--                                                     この1列で両方をまかなえる）
--
-- 【列名の由来】計画欄の既存列 personal_kr_months.activities（「当月に取り組む内容」＝
-- 計画）と対になる名前として actual_activities（実際に行ったこと）にした。
--
-- 【RLSは新設しない】両テーブルとも既存ポリシー（personal_kr_months・personal_period_reviews
-- の本人限定ポリシー）が列追加後もそのまま効く（RLSは行単位のフィルタであり、列の追加
-- によって変わらない）。
--
-- 【🔴 未適用時の安全対策はフロント側で実施（本ファイルの対象外）】
-- actual_activities を保存ペイロードに含めた状態でこのマイグレーション未適用だと、
-- PostgRESTが PGRST204（column not found）を返し、その保存だけが失敗する
-- （2026-08-12のupsertTask全滅事故・2026-08-26のactive_month_indexes事故と同型）。
-- 今回はこの列を「計画欄・振り返り欄・バンド決定の保存」とは完全に別の保存経路
-- （実施記録専用の保存ボタン）に隔離しており、未適用でも他の保存は一切壊れない設計に
-- している（src/components/okr/personal/ActualActivitiesBlock.tsx参照）。加えて、
-- 列の存在を実行時にプローブし（src/lib/supabase/personalOkrStore.ts の
-- probeActualActivitiesColumn）、未適用の間は入力欄自体を出さない。
-- schemaChecks.ts への検査項目追加・PGRST204専用の案内文言もフロント側で対応済み。
--
-- ⚠️ このファイルは山本さんが手動で適用します。エージェントは適用しないこと。
-- 適用方法: Supabase SQL Editor に全文を貼って実行する（dev → prod の順）。
-- ============================================================

ALTER TABLE personal_kr_months     ADD COLUMN IF NOT EXISTS actual_activities text;
ALTER TABLE personal_period_reviews ADD COLUMN IF NOT EXISTS actual_activities text;

-- ============================================================
-- 確認クエリ（Supabase SQL Editorで個別に実行して確認する）
-- ============================================================

-- 1) 両テーブルに列が存在するか
-- SELECT table_name, column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name IN ('personal_kr_months', 'personal_period_reviews')
--   AND column_name = 'actual_activities';
-- → 2行（personal_kr_months・personal_period_reviewsの両方）が返り、
--   data_type = 'text'・is_nullable = 'YES' であること

-- 2) 既存行が壊れていないか（新列はNULL許容のため既存行は全てNULLのままのはず）
-- SELECT count(*) FROM personal_kr_months WHERE actual_activities IS NOT NULL;
-- SELECT count(*) FROM personal_period_reviews WHERE actual_activities IS NOT NULL;
-- → 適用直後はどちらも0件であること
