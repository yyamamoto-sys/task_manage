-- ============================================================
-- groups の参照・loading_tips の参照・ai_usage_logs の INSERT を「登録済み本人」に締める
-- 2026-09-28（冪等。20260928_scope_okr_peripheral_tables.sql とは独立して適用できる）
--
-- 【なぜ】匿名サインイン有効化（v3.112・Section 58）で「authenticated ＝ 社内の人」の前提が
-- 崩れた。以下3点は TO authenticated の USING(true)／WITH CHECK(true) のまま残っていた。
--   B1 groups_select      … 匿名JWTでも全部署の行（teams_webhook_url を含む）が読める
--   C2 loading_tips_read  … 匿名JWTでもヒント文が読める（機密性は低い）
--   D-INS ai_usage_logs の INSERT … 匿名JWTで任意の member_id・is_guest の行を捏造できる
--
-- 【判定】current_member_id()（members を auth.email() で引く）。匿名は必ず NULL。
--
-- 【影響の確認結果】docs/dev/rls-phase2-investigation.md §2・§3・§4
--   - groups を未登録の状態で読む経路は無い（招待受諾・初回セットアップは SECURITY DEFINER の
--     RPC、受諾後は reload。LoginScreen は anon ロール。ゲストは from() を遮断。
--     notify-deadlines は service_role）
--   - loading_tips はゲスト・ログイン前は DB を読まない（既定値と localStorage キャッシュ）
--   - ai_usage_logs の INSERT：クライアントの member_id は currentUser.id（App.tsx:106 で
--     setCurrentUser(member.id)）。email 一致でログインした人は current_member_id() と同値。
--     Edge Function のゲスト行は service_role クライアント（ai-consult/index.ts:169）で
--     RLS を迂回するため影響しない
--   - 🔴 email 未設定で UserSelectScreen から選んでログインした人は current_member_id() が
--     NULL のため記録できなくなる（その人は他の部署スコープRLSでも既に何も見えていない）
--
-- 🔴 groups は SELECT ポリシーだけ、ai_usage_logs は INSERT ポリシーだけを落とす
--   （cmd で絞る。groups_insert_admin / groups_update_admin / groups_delete_admin と
--   ai_usage_logs_select_group は巻き込まない）。
--   cmd='ALL' のポリシーが実体にあった場合は落とさず、末尾の確認クエリで検出する
--   （ALL を落とすと書き込み権限まで変わるため、見つかったら個別に判断する）。
--
-- 【適用方法】Supabase SQL Editor に全文を貼って実行する（dev → prod の順）。
-- ============================================================

BEGIN;

-- ============================================================
-- ブロック1/3：groups の SELECT ポリシーを差し替える（B1）
-- ============================================================

DO $drop_groups_select$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT policyname FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'groups' AND cmd = 'SELECT'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.groups;', r.policyname);
  END LOOP;
END
$drop_groups_select$;

CREATE POLICY "groups_select" ON public.groups
  FOR SELECT TO authenticated
  USING ((SELECT public.current_member_id()) IS NOT NULL);


-- ============================================================
-- ブロック2/3：loading_tips の SELECT ポリシーを差し替える（C2）
-- 書き込みは loading_tips_write（FOR ALL・super_admin のみ）のまま。
-- ============================================================

DO $drop_loading_tips_select$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT policyname FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'loading_tips' AND cmd = 'SELECT'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.loading_tips;', r.policyname);
  END LOOP;
END
$drop_loading_tips_select$;

CREATE POLICY "loading_tips_read" ON public.loading_tips
  FOR SELECT TO authenticated
  USING ((SELECT public.current_member_id()) IS NOT NULL);


-- ============================================================
-- ブロック3/3：ai_usage_logs の INSERT ポリシーを差し替える（D-INS）
-- 本人の member_id でしか書けない。is_guest=true はサービスロール（Edge Function）専用。
-- ============================================================

DO $drop_ai_usage_logs_insert$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT policyname FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'ai_usage_logs' AND cmd = 'INSERT'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.ai_usage_logs;', r.policyname);
  END LOOP;
END
$drop_ai_usage_logs_insert$;

CREATE POLICY "ai_usage_logs_insert_own" ON public.ai_usage_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    member_id = (SELECT public.current_member_id())
    AND is_guest = false
  );

ALTER TABLE public.groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loading_tips  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_usage_logs ENABLE ROW LEVEL SECURITY;

COMMIT;

-- 適用後の確認：cmd='ALL' が残っていると上の締め付けが OR で無効になる。0行であること。
SELECT tablename, policyname, cmd, qual, with_check
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename IN ('groups', 'loading_tips', 'ai_usage_logs')
   AND (cmd = 'ALL' AND tablename <> 'loading_tips'
        OR (tablename = 'loading_tips' AND cmd = 'ALL' AND policyname <> 'loading_tips_write'))
 ORDER BY tablename, policyname;
