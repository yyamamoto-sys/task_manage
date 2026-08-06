-- ============================================================
-- スキーマ健全性チェック（マイグレーション適用漏れの起動時検知）
-- 2026-08-06
--
-- 【背景】v2.74（20260721_add_task_status_hold_cancelled.sql）が本番に未適用のまま
-- 約2週間気づかれず、タスクのステータスに「保留(on_hold)」「中止(cancelled)」を選ぶと
-- 保存に失敗する不具合が、タスク編集モーダル・カンバン・リスト・ガント・AI提案の反映の
-- 全経路で発生し続けた。コードは正しくon_holdを送っていたが、DB側のCHECK制約が
-- 3値のままだったために起きた。マイグレの適用が手作業でコードだけ先に本番へ出るため、
-- 適用漏れが「機能が静かに壊れたまま」残る構造になっている。これを構造的に防ぐ。
--
-- 【このマイグレーションで追加するもの】
-- check_schema_health(p_checks jsonb) — 汎用・読み取り専用のスキーマ検査RPC。
-- クライアント（src/lib/schema/checkSchemaHealth.ts）が src/lib/schema/schemaChecks.ts の
-- 検査項目一覧（宣言的な配列。新しいマイグレを足したらここに1行足すだけでよい設計。
-- CLAUDE.md Section 22参照）をJSON配列で渡し、各項目が {id, ok} で返る。
--
-- 【設計上の必須事項】
-- 1. SECURITY DEFINER（pg_catalog / information_schema を確実に見るため）。
--    SET search_path = '' で関数ハイジャック対策を固定（このリポジトリの既存規約）。
-- 2. 動的SQL（EXECUTE）は一切使わない。pg_catalog / information_schema への
--    パラメータ化された参照（= / position(...)）だけで判定する。
-- 3. 呼び出せるのは部署管理者（current_member_is_admin）または全社スーパー管理者
--    （current_member_is_super_admin）のみ。そうでない場合は例外を投げず、
--    静かに空配列を返す（is_system_bootstrapped()等と同じ、情報漏洩を最小化する方針）。
-- 4. 冪等（CREATE OR REPLACE。何度実行してもOK）。
--
-- 【やらないこと】スキーマを自動修正しない（検知して知らせるだけ。Human in the loop）。
--
-- 適用方法: Supabase SQL Editor に全文貼って実行（dev → prod の順）
-- ============================================================

CREATE OR REPLACE FUNCTION public.check_schema_health(p_checks jsonb)
RETURNS TABLE(id text, ok boolean)
LANGUAGE sql
SECURITY DEFINER STABLE
SET search_path = ''
AS $fn_check_schema_health$
  SELECT
    chk->>'id' AS id,
    CASE chk->>'kind'
      -- kind: "table" — テーブルの存在（通常テーブル・パーティション親の両方を許容）
      WHEN 'table' THEN EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = (chk->>'table')
          AND c.relkind IN ('r', 'p')
      )
      -- kind: "column" — 指定テーブルに指定列が存在するか
      WHEN 'column' THEN EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = (chk->>'table')
          AND column_name = (chk->>'column')
      )
      -- kind: "check_contains" — 指定テーブルのCHECK制約の定義文字列にneedleを含むか
      -- （LIKEではなくposition()を使い、needle内の"_"等をワイルドカードとして解釈しない）
      WHEN 'check_contains' THEN EXISTS (
        SELECT 1
        FROM pg_catalog.pg_constraint con
        JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = (chk->>'table')
          AND con.contype = 'c'
          AND position((chk->>'needle') IN pg_catalog.pg_get_constraintdef(con.oid)) > 0
      )
      -- kind: "function" — 指定名の関数（RPC）が存在するか
      WHEN 'function' THEN EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = (chk->>'name')
      )
      ELSE false
    END AS ok
  FROM jsonb_array_elements(
    -- 管理者でなければ検査対象を空配列にすり替える＝結果として0行を返す
    -- （例外を投げるより静かに空を返す方が安全。一般メンバーにスキーマ情報を渡さない）
    CASE
      WHEN public.current_member_is_admin() OR public.current_member_is_super_admin()
        THEN coalesce(p_checks, '[]'::jsonb)
      ELSE '[]'::jsonb
    END
  ) AS chk
$fn_check_schema_health$;

GRANT EXECUTE ON FUNCTION public.check_schema_health(jsonb) TO authenticated;

-- ============================================================
-- 適用後の確認（このファイルの一部ではないが確認しておくこと）：
-- 部署管理者または全社スーパー管理者としてログインし、ブラウザのコンソール等から
--   supabase.rpc('check_schema_health', { p_checks: [{ id: 'x', kind: 'table', table: 'tasks' }] })
-- を呼び、[{ id: 'x', ok: true }] が返ることを確認する。
-- 一般メンバーで同じ呼び出しをすると空配列 [] が返ることを確認する。
-- ============================================================
