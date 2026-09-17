-- ============================================================
-- 無条件許可のまま残っている9テーブルを「membersに登録された人だけ」に絞る
-- 2026-09-17（rev4。冪等なので何度でも再実行してよい）
--
-- 【なぜ必要になったか】
-- ゲスト（サンプル閲覧）のAI機能を使うため Supabase の Anonymous Sign-Ins を有効化した
-- （v3.29で実装されていたが、Supabase側の設定が漏れており約1.5か月ずっと
--   422 anonymous_provider_disabled で失敗していた）。
--
-- 🔴 有効化した瞬間、別の場所にあった既知の弱点が危険になる。
-- 下記9テーブルはマルチテナント未対応のまま「認証さえ通れば誰でも読み書き可」で残っていた
-- （CLAUDE.md Section 1.6・Section 9のG）。これまでは「authenticated になれるのは社内の
-- 正規アカウントだけ」だったため実害が無かったが、匿名サインインを有効にすると
-- 【誰でも authenticated になれる】。anonキーはクライアントに埋め込まれる公開情報なので、
-- URLさえ知っていれば誰でも匿名JWTを取得し、これら9テーブルを読み書きできてしまう。
--
-- ============================================================
-- 🔴 rev1〜rev3はなぜ失敗したか（2026-09-17・実機で確認した3つの失敗）
-- ============================================================
-- 【失敗1（rev1）】is_anonymous_session() で匿名を判定しようとした：
--     coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
--   → **JWTに is_anonymous クレームが入るかを確認せずに書いた。** 入っていなければ
--     NULL → coalesce で false → 「NOT false = true」で全員を通す。
--     **弾くつもりの条件が、全員を通す条件になっていた。**
--
-- 【失敗2（rev2）】新しいポリシーを足したのに kr_declarations が読めたまま：
--   pg_policies を見たところ **"authenticated_all"（auth.role() = 'authenticated'）という
--   別名のポリシーが残っていた。** PERMISSIVEポリシーは**OR**で評価されるため、
--   こちらが全員を通していた。原因は **DROP POLICY を名前決め打ちで書いたこと**。
--   schema.sql に載っている "authenticated full access" しか消していなかった。
--   **コードだけを見てDBの実体を確認しなかったのが誤り。**
--
-- 【失敗3（rev3）】ポリシーを動的に列挙して消そうとしてネストしたDOブロックを書いたら、
--   SQL Editor で 42601 syntax error at or near "FOR" になった。
--   → rev4では**ネストをやめ、DROPは1段のループ、CREATEは9本を明示的に書く**。
--     読みにくくても、確実に通る形を選ぶ。
--
-- 【rev4の方針】
-- - DROPは**ポリシー名に一切依存しない**（pg_policiesから実体を引いて全部消す）
-- - CREATEは9本を展開して書く（動的SQLのネストを避ける）
-- - 判定は current_member_id() を使う。この関数は
--     SELECT id FROM members WHERE email = auth.email() AND is_deleted = false
--   であり、匿名ユーザーは auth.email() が NULL のため**必ず NULL を返す**。
--   JWTのクレームに依存しない。
-- ============================================================
--
-- 【影響範囲】
-- - 社内の登録済みユーザー：影響なし（current_member_id() が id を返す）
-- - ゲスト（サンプル閲覧）：影響なし。ゲストはSupabaseに接続しない設計であり、
--   AI機能は Edge Function 経由＝service_role で動くため対象外
-- - 匿名ユーザー・members未登録ユーザー：これら9テーブルへのアクセスができなくなる ← 目的
--
-- 【この修正の対象外（別途判断・本ファイルでは触らない）】
-- - groups.groups_select（qual=true）… 全部署の一覧が誰でも読める。部署一覧はアプリ全体が
--   参照しており、締めると招待受諾フロー等への影響が読みにくい
-- - loading_tips.loading_tips_read（qual=true）… ヒント文のみ。機密性は低い
-- - INSERT系（ai_usage_logs / entity_change_logs / groups / members）… WITH CHECK で判定
--
-- 【適用方法】Supabase SQL Editor に全文を貼って実行する（dev → prod の順）。
-- ============================================================


-- ============================================================
-- ブロック1/4：9テーブルの既存ポリシーを名前を問わず全部落とす
--
-- 🔴 名前決め打ちをやめる（rev2の失敗の原因）。ネストも避ける（rev3の失敗の原因）。
-- pg_policies から「テーブル名＋ポリシー名」の組を1段のループで引いて消す。
-- ============================================================

DO $drop_open_policies$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT tablename, policyname
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN (
         'quarterly_objectives', 'quarterly_kr_task_forces',
         'kr_sessions', 'kr_declarations',
         'member_tags',
         'kr_meeting_notes', 'kr_note_tf_entries', 'okr_analyses', 'kr_reports'
       )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', r.policyname, r.tablename);
  END LOOP;
END
$drop_open_policies$;


-- ============================================================
-- ブロック2/4：登録済みメンバーだけを通すポリシーを1本ずつ作る
--
-- 🔴 関数呼び出しは (SELECT ...) で包む（CLAUDE.md Section 39）。
-- 包まないとRLSのWHERE句で行ごとに再評価され性能が劣化する（v3.80で実測済み）。
-- 🔴 動的SQLを使わず9本を展開して書く（rev3の構文エラーを避けるため）。
-- ============================================================

CREATE POLICY "quarterly_objectives_registered_members_only" ON public.quarterly_objectives
  FOR ALL TO authenticated
  USING ((SELECT public.current_member_id()) IS NOT NULL)
  WITH CHECK ((SELECT public.current_member_id()) IS NOT NULL);

CREATE POLICY "quarterly_kr_task_forces_registered_members_only" ON public.quarterly_kr_task_forces
  FOR ALL TO authenticated
  USING ((SELECT public.current_member_id()) IS NOT NULL)
  WITH CHECK ((SELECT public.current_member_id()) IS NOT NULL);

CREATE POLICY "kr_sessions_registered_members_only" ON public.kr_sessions
  FOR ALL TO authenticated
  USING ((SELECT public.current_member_id()) IS NOT NULL)
  WITH CHECK ((SELECT public.current_member_id()) IS NOT NULL);

CREATE POLICY "kr_declarations_registered_members_only" ON public.kr_declarations
  FOR ALL TO authenticated
  USING ((SELECT public.current_member_id()) IS NOT NULL)
  WITH CHECK ((SELECT public.current_member_id()) IS NOT NULL);

CREATE POLICY "member_tags_registered_members_only" ON public.member_tags
  FOR ALL TO authenticated
  USING ((SELECT public.current_member_id()) IS NOT NULL)
  WITH CHECK ((SELECT public.current_member_id()) IS NOT NULL);

CREATE POLICY "kr_meeting_notes_registered_members_only" ON public.kr_meeting_notes
  FOR ALL TO authenticated
  USING ((SELECT public.current_member_id()) IS NOT NULL)
  WITH CHECK ((SELECT public.current_member_id()) IS NOT NULL);

CREATE POLICY "kr_note_tf_entries_registered_members_only" ON public.kr_note_tf_entries
  FOR ALL TO authenticated
  USING ((SELECT public.current_member_id()) IS NOT NULL)
  WITH CHECK ((SELECT public.current_member_id()) IS NOT NULL);

CREATE POLICY "okr_analyses_registered_members_only" ON public.okr_analyses
  FOR ALL TO authenticated
  USING ((SELECT public.current_member_id()) IS NOT NULL)
  WITH CHECK ((SELECT public.current_member_id()) IS NOT NULL);

CREATE POLICY "kr_reports_registered_members_only" ON public.kr_reports
  FOR ALL TO authenticated
  USING ((SELECT public.current_member_id()) IS NOT NULL)
  WITH CHECK ((SELECT public.current_member_id()) IS NOT NULL);


-- ============================================================
-- ブロック3/4：rev1で作ったヘルパーを撤去する
--
-- is_anonymous_session() は使わない（クレームが無いと全員を通してしまう）。
-- ブロック1でポリシーを落とした後なので依存は残っていない。
-- ============================================================

DROP FUNCTION IF EXISTS public.is_anonymous_session();


-- ============================================================
-- ブロック4/4：RLSが有効であることの再確認（既に有効なら no-op）
--
-- 🔴 RLSが無効だとポリシーは一切評価されず素通しになる。
-- ============================================================

ALTER TABLE public.quarterly_objectives     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quarterly_kr_task_forces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kr_sessions              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kr_declarations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_tags              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kr_meeting_notes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kr_note_tf_entries       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.okr_analyses             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kr_reports               ENABLE ROW LEVEL SECURITY;
