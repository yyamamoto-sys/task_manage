-- 部署拡大に向けたオンボーディング経路の是正（M25対応）
-- 適用方法: Supabase SQL Editor に全文貼って実行
--
-- 【背景】
-- RLS（20260702b/20260702cで導入）は「自分の所属group_idと一致するか、super-adminか」
-- でmembers/projects/tasksの可視性を絞る。このため、まだmembersに登録されていない
-- 認証ユーザーには何も見えない（current_member_group_id()がNULLを返し、比較がNULL＝偽になる）。
--
-- ところがApp.tsx側は「DBにmembersが1件も見えない＝初回セットアップ（システムが空）」と
-- 誤認し、SetupWizardを表示してしまう（既知課題M25。docs/dev診断は
-- memory/projects/project_task_manage.md 第12回巡回参照）。
-- これは「システムに他の誰かが既にいるが、自分がまだ登録されていないだけ」のケースと
-- 区別がつかない、というクライアント側だけでは解決不能な問題のため、
-- RLSを迂回してサーバー側で判定する仕組みが必要になる。
--
-- このマイグレーションで追加するもの：
-- 1. is_system_bootstrapped() — 「membersが1件でも存在するか」だけを返すSECURITY DEFINER関数。
--    未登録の認証ユーザーからも呼べる（GRANT EXECUTE TO authenticated）。真偽値1個だけを返し、
--    件数や中身は一切返さない（情報漏洩の最小化）。
-- 2. bootstrap_first_group_and_member(...) — 「membersが0件のときに限り」部署（groups）と
--    最初のメンバー（is_admin=true かつ is_super_admin=true）を作成するSECURITY DEFINER関数。
--    通常のクライアントINSERTはgroups_insert_adminポリシー（super-admin限定のWITH CHECK）に
--    阻まれるため、真の初回セットアップ専用の抜け道としてこの関数を用意する。
--    「membersが0件」ガードを関数内で必ず検証すること（このガードが、2回目以降の悪用
--    ＝誰でもsuper_adminになれてしまう穴を防ぐ唯一の防波堤）。emailはクライアントから
--    渡させず、必ずauth.email()から取得する（なりすまし防止）。
--
-- 【重要】このファイルは2ブロックに分かれています。一括実行で失敗する場合はブロックごとに
-- 区切って実行し、失敗箇所を特定してください（過去に共有の $$ を使って事故が起きたため、
-- このファイルは関数ごとに固有のドル引用タグを使っています）。

-- ============================================================
-- ブロック1: is_system_bootstrapped()
--   RLSを迂回して「システムにアクティブなmembersが1件でも存在するか」だけを返す。
--   App.tsx が「本当に空（SetupWizardを見せてよい）」か「自分に権限が無いだけ
--   （アクセス拒否画面を見せるべき）」かを判定するために使う。
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_system_bootstrapped()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER STABLE
SET search_path = ''
AS $fn_is_bootstrapped$
  SELECT EXISTS (SELECT 1 FROM public.members WHERE is_deleted = false)
$fn_is_bootstrapped$;

GRANT EXECUTE ON FUNCTION public.is_system_bootstrapped() TO authenticated;

-- ============================================================
-- ブロック2: bootstrap_first_group_and_member(...)
--   「membersが0件のときに限り」部署＋最初のメンバー（super-admin）を作成する。
-- ============================================================
CREATE OR REPLACE FUNCTION public.bootstrap_first_group_and_member(
  p_group_name   text,
  p_display_name text,
  p_short_name   text,
  p_initials     text,
  p_color_bg     text,
  p_color_text   text
)
RETURNS TABLE(group_id text, member_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_bootstrap$
DECLARE
  v_email        text;
  v_group_id     text;
  v_member_id    text;
  v_active_count integer;
BEGIN
  -- 同時に2つのブートストラップ呼び出しが走り、どちらも「0件」を見てしまう
  -- TOCTOUレースを防ぐため、トランザクション内でアドバイザリロックを取る
  -- （真の初回セットアップは通常1人しか行わないため実運用上のボトルネックにはならない）。
  PERFORM pg_advisory_xact_lock(hashtext('bootstrap_first_group_and_member'));

  -- 【安全性の要】システムに1人でもアクティブなメンバーがいれば即座に拒否する。
  -- この関数はSECURITY DEFINERのためRLS・権限昇格ガードトリガーの一部チェックを
  -- 迂回して部署管理者/全社スーパー管理者を作成できてしまう。「membersが0件のときに
  -- 限り実行できる」というこのガードだけが、2回目以降にこの関数が呼ばれて
  -- 誰でもsuper_adminになれてしまう穴を防ぐ唯一の防波堤。
  SELECT count(*) INTO v_active_count FROM public.members WHERE is_deleted = false;
  IF v_active_count > 0 THEN
    RAISE EXCEPTION 'システムは既に初期化済みのため、ブートストラップは実行できません'
      USING ERRCODE = 'check_violation';
  END IF;

  -- なりすまし防止：emailはクライアントの引数から受け取らず、必ずサーバー側の
  -- JWT（auth.email()）から取得したものを使う。
  v_email := auth.email();
  IF v_email IS NULL THEN
    RAISE EXCEPTION '認証されたメールアドレスが取得できません' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF coalesce(trim(p_group_name), '') = '' THEN
    RAISE EXCEPTION '部署名を入力してください' USING ERRCODE = 'check_violation';
  END IF;
  IF coalesce(trim(p_display_name), '') = '' OR coalesce(trim(p_short_name), '') = '' THEN
    RAISE EXCEPTION '表示名・略称を入力してください' USING ERRCODE = 'check_violation';
  END IF;

  v_group_id  := 'grp-' || replace(gen_random_uuid()::text, '-', '');
  v_member_id := gen_random_uuid()::text;

  INSERT INTO public.groups (id, name, updated_by)
  VALUES (v_group_id, trim(p_group_name), v_member_id);

  INSERT INTO public.members (
    id, display_name, short_name, initials, teams_account, email,
    is_admin, is_super_admin, group_id, color_bg, color_text,
    is_deleted, updated_by
  ) VALUES (
    v_member_id, trim(p_display_name), trim(p_short_name), p_initials, '', v_email,
    true, true, v_group_id, p_color_bg, p_color_text,
    false, v_member_id
  );

  RETURN QUERY SELECT v_group_id, v_member_id;
END;
$fn_bootstrap$;

GRANT EXECUTE ON FUNCTION public.bootstrap_first_group_and_member(text, text, text, text, text, text) TO authenticated;

-- ============================================================
-- 適用後の確認（このファイルの一部ではないが確認しておくこと）：
-- 1. 既存EGG環境では members が既に1件以上あるため is_system_bootstrapped() は
--    true を返し、bootstrap_first_group_and_member() は誰が呼んでも
--    「システムは既に初期化済み」で弾かれる（既存ユーザーへの影響なし）。
-- 2. 真に新しい環境（members 0件）でのみ、認証済みユーザーがSetupWizard経由で
--    1回だけ部署＋最初のsuper-admin作成に成功する。
-- ============================================================
