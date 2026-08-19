-- ============================================================
-- members のRLSポリシー：SECURITY DEFINER関数呼び出しをInitPlan化する（性能是正）
-- 2026-08-19（v3.80）
--
-- 【背景・実測（本番・招待受諾者アカウントでRLSを効かせた状態）】
-- 山本さんが本番で EXPLAIN (ANALYZE, BUFFERS) を実測した結果：
--
--   Seq Scan on members  (cost=0.00..34.88 rows=21 width=279) (actual time=8.093..76.053 rows=16 loops=1)
--     Filter: ((group_ids && current_member_group_ids()) OR current_member_is_super_admin()
--              OR (group_ids && visible_invite_group_ids()) OR (id = ANY (visible_project_member_ids())))
--     Rows Removed by Filter: 5
--     Buffers: shared hit=6504
--   Planning Time: 48.270 ms
--   Execution Time: 76.085 ms
--
-- members は21行＝実体は1ページで足りるはずが、shared hit=6504という異常値が出た。
-- これは、フィルタ内のSECURITY DEFINER関数（current_member_group_ids() /
-- current_member_is_super_admin() / visible_invite_group_ids() /
-- visible_project_member_ids()）が行ごとに再実行されていることを示す
-- （1行あたり約310バッファ＝visible_project_member_ids()がprojects×tasksを毎回舐める
-- コストと整合する）。
--
-- 【v3.75（20260818_harden_invite_related_rls.sql）のコメントの誤りを訂正する】
-- 同ファイルの「性能：id = ANY(...) を選んだ理由」のコメントに書いた
-- 「members の各行と相関を持たないため、PostgreSQLはクエリ全体で1回だけ評価する
-- uncorrelated subplanとして実行できる」という記述は誤りだった（2026-08-19・実測で判明。
-- 引数無しのSTABLE/SECURITY DEFINER関数であっても、RLSポリシーのWHERE句に直接書くと
-- PostgreSQLは行ごとに評価する。本ファイルの末尾のコメントに訂正記録を追記した）。
--
-- 【対応：呼び出しを (SELECT ...) で包む】PostgreSQLは (SELECT 関数呼び出し()) の形を
-- InitPlanとして認識し、クエリ全体で1回だけ評価してその結果をキャッシュする。
-- Supabaseが公式にRLSの性能改善として推奨している定石（auth.uid() を
-- (SELECT auth.uid()) と書く）と同じ手法。式の意味・条項の順序・キャストは
-- 一切変えず、関数呼び出しを (SELECT ...) で包むことだけを行う。
--
-- 【変えないこと】
-- - members_select（SELECT用・4条項目まで含む）／members_write_insert／
--   members_write_update／members_write_delete のポリシー分割はそのまま維持する
--   （v3.75で塞いだFOR ALL + WITH CHECK省略の穴を再度開けない）。
-- - members_write_* には visible_project_member_ids() を足さない（元々存在しない。
--   書き込み権限を広げる今回のスコープ外の変更はしない）。
-- - 条項の数・論理・順序は1つも変えていない（members_selectは4条項目のまま、
--   members_write_*は3条項目のまま）。
--
-- 【今回のマイグレーションで触るのはmembersだけ】projects_group／tasks_group／
-- task_dependencies_group等、SECURITY DEFINER関数を直接呼んでいる他のポリシーも
-- 同型の性能問題を抱えている可能性が高いが、実測で問題を確認できたのはmembersのみ
-- のため、今回はmembersだけを直す。他は「同型の問題がある」という調査結果として
-- CLAUDE.mdに記録するにとどめ、実装はしない（一度に触る範囲を広げないため）。
--
-- 【NULL猶予条項は書かない】CLAUDE.md Section 1.6の2026-06-26事故の教訓を厳守。
-- 【SET search_path=''】既存の流儀（本ファイルはポリシーの再作成のみで新規関数は
-- 定義しないため対象外）。
--
-- 適用方法: Supabase SQL Editor に全文貼って実行（dev → prod の順）。
--   ⚠️ このファイルは山本さんが手動で適用します。エージェントは適用しないこと。
-- ============================================================

DROP POLICY IF EXISTS "members_select" ON members;
DROP POLICY IF EXISTS "members_write_insert" ON members;
DROP POLICY IF EXISTS "members_write_update" ON members;
DROP POLICY IF EXISTS "members_write_delete" ON members;

CREATE POLICY "members_select" ON members
  FOR SELECT TO authenticated
  USING (
    group_ids && (SELECT public.current_member_group_ids())
    OR (SELECT public.current_member_is_super_admin())
    OR group_ids && (SELECT public.visible_invite_group_ids())
    -- 🔴 ここは (SELECT ...) を裸で ANY() に渡さないこと。PostgreSQLは
    --    `x = ANY (副問い合わせ)` と `x = ANY (配列式)` を別の構文として解釈するため、
    --    裸で渡すと副問い合わせ形式になり text と text[] の比較になって
    --    `operator does not exist: text = text[]` で落ちる（2026-08-19に実際に踏んだ）。
    --    ::text[] のキャストを付けて「配列式」であることを明示する。キャスト自体は
    --    型を変えないが、これがあることで配列形式として解釈され、かつ副問い合わせは
    --    引き続き相関を持たないためInitPlanとして1回だけ評価される。
    OR id::text = ANY ((SELECT public.visible_project_member_ids())::text[])
  );

CREATE POLICY "members_write_insert" ON members
  FOR INSERT TO authenticated
  WITH CHECK (
    group_ids && (SELECT public.current_member_group_ids())
    OR (SELECT public.current_member_is_super_admin())
    OR (
      group_ids && (SELECT public.visible_invite_group_ids())
      AND ((SELECT public.current_member_is_admin()) OR (SELECT public.current_member_is_super_admin()))
    )
  );

CREATE POLICY "members_write_update" ON members
  FOR UPDATE TO authenticated
  USING (
    group_ids && (SELECT public.current_member_group_ids())
    OR (SELECT public.current_member_is_super_admin())
    OR (
      group_ids && (SELECT public.visible_invite_group_ids())
      AND ((SELECT public.current_member_is_admin()) OR (SELECT public.current_member_is_super_admin()))
    )
  )
  WITH CHECK (
    group_ids && (SELECT public.current_member_group_ids())
    OR (SELECT public.current_member_is_super_admin())
    OR (
      group_ids && (SELECT public.visible_invite_group_ids())
      AND ((SELECT public.current_member_is_admin()) OR (SELECT public.current_member_is_super_admin()))
    )
  );

CREATE POLICY "members_write_delete" ON members
  FOR DELETE TO authenticated
  USING (
    group_ids && (SELECT public.current_member_group_ids())
    OR (SELECT public.current_member_is_super_admin())
    OR (
      group_ids && (SELECT public.visible_invite_group_ids())
      AND ((SELECT public.current_member_is_admin()) OR (SELECT public.current_member_is_super_admin()))
    )
  );

-- ============================================================
-- 適用後の確認（山本さんへ：以下を実行し、期待どおりであることを確認してください）
-- ============================================================

-- 1) ポリシーが4本のまま、SELECT用が可視性を狭めていないこと（4条項目のまま）：
-- SELECT policyname, cmd, qual, with_check
-- FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'members'
--   AND policyname IN ('members_select','members_write_insert','members_write_update','members_write_delete')
-- ORDER BY policyname;
-- -- members_select の qual に4つの OR 条項（current_member_group_ids / is_super_admin /
-- -- visible_invite_group_ids / visible_project_member_ids）が全て残っていること
-- -- （v3.75の監査クエリ3と同じ趣旨。可視性を狭めていないことの確認）。

-- 2) 書き込み系ポリシーに visible_project_member_ids が現れないこと（書き込みスコープを
--    広げていないことの確認。v3.75の監査クエリ10と同じ趣旨）：
-- SELECT policyname, qual, with_check
-- FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'members'
--   AND policyname IN ('members_write_insert','members_write_update','members_write_delete');
-- -- qual・with_check のどちらにも visible_project_member_ids という文字列が
-- -- 含まれていないことを目視確認する。

-- 3) 性能改善の確認（招待受諾者アカウントで、適用前と同じ条件を再現する）：
--    <auth_user_id> と <auth_user_email> は招待受諾者の実際のauth.usersのuidとemailに
--    置き換えること。
--
-- BEGIN;
-- SELECT set_config(
--   'request.jwt.claims',
--   json_build_object('sub', '<auth_user_id>', 'email', '<auth_user_email>', 'role', 'authenticated')::text,
--   true
-- );
-- SET LOCAL ROLE authenticated;
-- EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM members;
-- ROLLBACK;
--
-- 期待する変化（適用前の実測値との比較）：
--   適用前：Buffers: shared hit=6504 ／ Execution Time: 76.085 ms
--   適用後：shared hit が数十〜百程度まで大幅に減り、Execution Time も
--           一桁ms〜数ms程度まで短縮されること（members本体が21行＝1ページ分＋
--           SECURITY DEFINER関数4つがそれぞれ1回ずつ評価される分のコストのみになる）。
--   EXPLAINの出力に「InitPlan」という語が現れ、Filter句の関数呼び出しが
--   "(InitPlan 1).col1" のような参照に置き換わっていることを確認する
--   （関数がクエリ全体で1回だけ評価されている証拠）。
-- ============================================================
