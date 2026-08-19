-- ============================================================
-- スキーマ健全性チェック：関数の「本文差し替え型」＋列の「型のずれ」の検知
-- 2026-08-19（v3.80）
--
-- 【背景1：本文差し替え型マイグレーション】check_schema_health() の kind:"function" は
-- pg_proc に同名関数が存在するかしか見ない（20260806_add_schema_health_check.sql参照）。
-- そのため「関数の名前・引数を変えずに本文（中身）だけを差し替える」マイグレーションは、
-- 未適用でも「存在する」と判定され続け、適用漏れを検知できなかった（CLAUDE.md
-- Section 22・25 Phase 5・33に既知の限界として明記済み）。2026-08-17の棚卸しで、この形に
-- 該当するのは accept_project_invite()（20260812_accept_invite_for_existing_member.sql）と
-- guard_member_privilege_columns()（20260818_harden_invite_related_rls.sql）の2件と確定した。
--
-- 【背景2：列の型そのものが宣言とずれる事故】2026-08-18、v3.75
-- （20260818_harden_invite_related_rls.sql）の適用が「UNION types text and uuid cannot be
-- matched」で2回失敗した。原因は projects.owner_member_ids の実DBの型が uuid[] のまま
-- だったこと（宣言は20260331_add_missing_columns.sql・schema.sqlともに一貫してtext[]。
-- 列を作った当時の実際の型がuuid[]で残り、その後の"add column if not exists"は既存列が
-- あるため何もしなかった＝ドキュメントの誤りではなく実DBが宣言から外れていたケース）。
-- members.id はtext のため、uuid[]のままだと将来UUID形式でないメンバーIDが生まれた時点で
-- DBエラーになる潜在リスクがあった（20260819b_fix_owner_member_ids_type.sql で是正）。
-- kind:"column"（列の存在有無）ではこの種の「列はあるが型が違う」を検知できないため、
-- 今回あわせて kind:"column_type" を新設する。
--
-- 【今回追加するもの】check_schema_health(p_checks jsonb) に新しい kind を2つ追加する。
-- 1. "function_body_contains"：pg_get_functiondef() で関数定義全文（本文含む）を取得し、
--    指定した needle（そのマイグレーションでしか登場しない断片）を含むかを判定する。
-- 2. "column_type"：information_schema.columns の udt_name（配列型は"_text"/"_uuid"のように
--    先頭にアンダースコアが付く内部表記）が指定値と一致するかを判定する。
--
-- 【なぜ1ファイルにまとめたか】適用は山本さんの手動作業（Supabase SQL Editorへの
-- 貼り付け・dev→prod）のため、1回の適用で両方のkindが使えるようにする（統括の判断）。
--
-- 【設計上の必須事項（既存方針を継続。20260806_add_schema_health_check.sql参照）】
-- 1. 動的SQL（EXECUTE）は使わない。pg_catalog / information_schema への参照だけで判定する。
-- 2. 呼び出せるのは部署管理者・全社スーパー管理者のみ（既存のCASE分岐で担保済み。
--    今回の変更で緩めていない）。
-- 3. NULL猶予条項は書かない（CLAUDE.md Section 1.6の教訓）。
-- 4. 冪等（CREATE OR REPLACE。既存の他kindの判定ロジックは1文字も変えていない）。
--
-- 【やらないこと】スキーマを自動修正しない（検知して知らせるだけ。Human in the loop）。
--
-- 適用方法: Supabase SQL Editor に全文貼って実行（dev → prod の順）。
-- 🔴 v3.80には本ファイルの他に 20260819b_fix_owner_member_ids_type.sql・
-- 20260819c_optimize_members_rls_initplan.sql の計3ファイルある。適用順は
-- CLAUDE.md・作業報告に明記する（本ファイルは他2ファイルと独立しており、
-- どの順で適用しても安全）。
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
      -- kind: "function_body_contains"（2026-08-19・v3.80で追加）— 指定名の関数の定義全文
      -- （pg_get_functiondef。本文・引数・戻り値を含む）にneedleを含むか。「本文だけを
      -- 差し替える」マイグレーション（名前・引数は変わらないため kind:"function" では
      -- 適用漏れを検知できない）向け。position()を使いLIKEのワイルドカード解釈を避ける
      -- 方針は check_contains と同じ。関数が複数オーバーロードを持つ場合、いずれか1つでも
      -- needleを含めば ok=true（このリポジトリの対象関数はいずれも単一シグネチャのため
      -- 実害はない。既存の kind:"function" も同名関数の存在有無だけを見ておりオーバーロード
      -- を区別しない点は同じ）。
      WHEN 'function_body_contains' THEN EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = (chk->>'name')
          AND position((chk->>'needle') IN pg_catalog.pg_get_functiondef(p.oid)) > 0
      )
      -- kind: "column_type"（2026-08-19・v3.80で追加）— 指定テーブルの指定列の実際の型
      -- （information_schema.columns.udt_name）が期待値と一致するか。列の存在有無だけを
      -- 見る kind:"column" では「列はあるが宣言と違う型のまま」（2026-08-18に実際に
      -- projects.owner_member_ids で起きた事故）を検知できないため新設した。udt には
      -- 配列型の内部表記（例："_text"／"_uuid"）をそのまま渡す（一致判定のみで
      -- LIKE等のワイルドカード解釈はしない）。
      WHEN 'column_type' THEN EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = (chk->>'table')
          AND column_name = (chk->>'column')
          AND udt_name = (chk->>'udt')
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
-- 適用前の確認（このマイグレーションが未適用の状態で以下を実行し、まだ新kindが
-- 使えない＝ELSE分岐でfalseになることを確認しておく。適用前後の比較用）：
--
-- SELECT proname FROM pg_proc WHERE proname = 'check_schema_health';
-- -- 1行返ること（旧版が既に存在する）
--
-- 適用後の確認（山本さんへ：以下を実行し、期待どおりであることを確認してください）：
--
-- 1) 既存kind（table/column/check_contains/function）が今までどおり動くこと：
-- SELECT * FROM check_schema_health('[
--   {"id":"t1","kind":"table","table":"tasks"},
--   {"id":"f1","kind":"function","name":"accept_project_invite"}
-- ]'::jsonb);
-- -- 両方 ok=true が返ること（部署管理者・全社スーパー管理者としてログインした状態で）
--
-- 2) 新kind（function_body_contains）が「本文差し替え済み」を正しく検知すること：
-- SELECT * FROM check_schema_health('[
--   {"id":"accept_invite_existing_member","kind":"function_body_contains",
--    "name":"accept_project_invite",
--    "needle":"v_invite.invite_group_id = ANY(COALESCE(v_existing_group_ids, ''{}''::text[]))"},
--   {"id":"guard_email_protection","kind":"function_body_contains",
--    "name":"guard_member_privilege_columns",
--    "needle":"NEW.email := old_email;"}
-- ]'::jsonb);
-- -- 20260812・20260818の両マイグレーションを適用済みなら両方 ok=true。
-- -- 未適用の環境（旧本文のまま）で試すと ok=false になることも確認しておくこと
-- -- （このRPC自体は関数の存在有無を問わず動くため、20260812/20260818を意図的に
-- -- 未適用のまま試したい場合は別のdev環境等で検証する）。
--
-- 3) 新kind（column_type）が3列とも期待どおりの型であることを確認すること：
-- SELECT * FROM check_schema_health('[
--   {"id":"c1","kind":"column_type","table":"projects","column":"owner_member_ids","udt":"_text"},
--   {"id":"c2","kind":"column_type","table":"projects","column":"member_ids","udt":"_text"},
--   {"id":"c3","kind":"column_type","table":"tasks","column":"assignee_member_ids","udt":"_text"}
-- ]'::jsonb);
-- -- 20260819b_fix_owner_member_ids_type.sql 適用後は c1 も ok=true になること
-- -- （適用前に試すと c1 だけ ok=false になることも確認しておくこと）。
--
-- 4) 一般メンバー（is_admin=false かつ is_super_admin=false）で同じ呼び出しをすると
--    空配列 [] が返ることを確認する。
-- ============================================================
