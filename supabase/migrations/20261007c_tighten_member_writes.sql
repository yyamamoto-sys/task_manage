-- ============================================================
-- 想定クエリ名：members の書き込み権限を「本人」と「ホーム部署の管理者」に締める（v3.137）
-- 2026-10-07（冪等。何度流しても同じ状態になる）
--
-- 正本：CLAUDE.md Section 70
-- 前提：20260819c_optimize_members_rls_initplan.sql・20260818_harden_invite_related_rls.sql を適用済み
--       （本番の現行定義を pg_policies／pg_get_functiondef で 2026-10-07 に取得し、schema.sql と
--        ロジックが一致することを確認した。本番の関数本体はコメントが無いだけ）
--
-- 【背景】members の UPDATE／INSERT／DELETE は
--   group_ids && current_member_group_ids() OR super_admin OR（招待用部署 AND 管理者）
--   だった。①同じ部署の一般メンバーが、他人の表示名・略称・色・teams_account・notify_pref を
--   書き換え・追加・物理削除できた（特権列はトリガーが差し戻すが、それ以外は守られない）。
--   ②current_member_is_admin() は部署を見ないため、兼務管理者が兼務先でも管理者として振る舞えた。
--
-- 【山本さんの決定（2026-10-07）】
--   1. 他人の行の更新・追加・削除は「その人のホーム部署（members.group_id）の管理者」と
--      super_admin だけ。一般メンバーは自分の行（email = auth.email()）だけ更新できる。
--   2. 管理者の権限はホーム部署だけに効く。兼務先では一般メンバー扱い。
--      招待用部署（is_invite_group）の管理の扱いは今のまま。
--
-- 【このマイグレでやること】
--   (1) current_member_admin_group_id() を新設：管理者ならホーム部署の id、そうでなければ NULL。
--   (2) members_write_update／insert／delete を書き換え。
--   (3) groups_update_admin を新関数で書き直す（意味は同じ＝元からホーム部署限定だった）。
--   (4) guard_member_privilege_columns() の「管理者なら許可」を、対象行のホーム部署の管理者に限定。
--
-- 【判断した境界】
--   - 部署移動（group_id の変更）：「旧部署と新部署の両方の管理者」であることを要求する。
--     管理者のホーム部署は1つしかないため、これは実質 super_admin だけになる（＋初回の
--     自己ブートストラップ）。旧ガードは「どこかの管理者」なら許可し、RLS 側の
--     group_ids && current_member_group_ids() と合わせて、兼務管理者が自分の兼務先へ他人を
--     移せた。片側の管理者だけで移せると、自部署の人を他部署へ押し付ける・他部署の人を
--     引き抜く、のどちらかが一方的にできてしまう。
--   - 部署の管理者不在時の自己昇格（部署ブートストラップ猶予）：is_admin の自己昇格だけを残し、
--     group_id の付け替えは猶予の対象から外す。今回 RLS に「自分の行」の条項が増えたため、
--     旧来の猶予（group_id が NULL の行は「管理者0人の部署」とみなされ何でも通る）を残すと、
--     group_id が NULL の本人が任意の部署へ自分を移し管理者になれる。本番の group_id NULL 行は
--     0件（2026-10-07 確認）なので、実害の出る正規経路は無い。猶予は group_id が NULL の行には効かない。
--   - 招待用部署：RLS の招待条項は「対象行のホーム部署が、自分に見えている招待用部署であり、
--     自分が管理者（どの部署でも）」とする。旧条項は group_ids の重なりで判定していたため、
--     招待を受けて兼務している「別部署の通常メンバー」まで、無関係な部署の管理者が更新・削除
--     できた。ゲスト（ホーム部署が招待用部署そのもの）の扱いは旧条項と同じ結果になる
--     （ゲストの group_ids は招待用部署だけ）。visible_invite_group_ids() 自体は変えていない
--     （兼務先のプロジェクト経由で見える招待用部署も今までどおり対象）。
--   - 自分の行：USING・WITH CHECK とも email = auth.email() AND is_deleted = false。
--     WITH CHECK を email で見るので、一般メンバーは自分の email を変えられない
--     （変えると別人の未登録アドレスに行を明け渡せるため。管理者はホーム部署の条項で通る）。
--     自分の行の物理削除・新規追加はできない（決定1）。
--   - 初回セットアップ：bootstrap_first_group_and_member() は SECURITY DEFINER（所有者 postgres は
--     RLS を迂回）なので RLS の変更は影響しない。トリガーの自己ブートストラップ分岐も変えていない。
--     その後の saveMember は super_admin として通る。招待の RPC（create_project_invite／
--     accept_project_invite）も同じく SECURITY DEFINER で、触る列（group_ids）の判定は変えていない。
--   - current_member_is_admin() は残す：招待条項・check_schema_health（管理者に検査を見せるだけ）・
--     ガードの招待用部署の分岐で、今までどおり「どこかの管理者か」の意味で使う。
--
-- 【適用方法】Supabase SQL Editor に全文を貼って実行する（dev → prod の順）。末尾の確認クエリで結果を見る。
--   検証は docs/dev/verify_20261007c_member_writes.sql（ROLLBACK で終わる）。
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- (1) 管理者として扱う部署（ホーム部署のみ）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_member_admin_group_id()
RETURNS text
LANGUAGE sql
SECURITY DEFINER STABLE
SET search_path = ''
AS $fn_admin_group_id$
  SELECT CASE WHEN is_admin THEN group_id END
  FROM public.members
  WHERE email = auth.email()
    AND is_deleted = false
  LIMIT 1
$fn_admin_group_id$;

GRANT EXECUTE ON FUNCTION public.current_member_admin_group_id() TO authenticated;

-- ------------------------------------------------------------
-- (2) members の書き込みポリシー（SELECT は変えない）
--     関数呼び出しは (SELECT ...) で包む（Section 39）。単数列 group_id と配列の比較は @>（Section 39 但し書き）。
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "members_write_insert" ON public.members;
DROP POLICY IF EXISTS "members_write_update" ON public.members;
DROP POLICY IF EXISTS "members_write_delete" ON public.members;

CREATE POLICY "members_write_insert" ON public.members
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.current_member_is_super_admin())
    OR group_id = (SELECT public.current_member_admin_group_id())
    OR (
      group_id IS NOT NULL
      AND (SELECT public.visible_invite_group_ids()) @> ARRAY[group_id]
      AND (SELECT public.current_member_is_admin())
    )
  );

CREATE POLICY "members_write_update" ON public.members
  FOR UPDATE TO authenticated
  USING (
    (email = (SELECT auth.email()) AND is_deleted = false)
    OR (SELECT public.current_member_is_super_admin())
    OR group_id = (SELECT public.current_member_admin_group_id())
    OR (
      group_id IS NOT NULL
      AND (SELECT public.visible_invite_group_ids()) @> ARRAY[group_id]
      AND (SELECT public.current_member_is_admin())
    )
  )
  WITH CHECK (
    (email = (SELECT auth.email()) AND is_deleted = false)
    OR (SELECT public.current_member_is_super_admin())
    OR group_id = (SELECT public.current_member_admin_group_id())
    OR (
      group_id IS NOT NULL
      AND (SELECT public.visible_invite_group_ids()) @> ARRAY[group_id]
      AND (SELECT public.current_member_is_admin())
    )
  );

CREATE POLICY "members_write_delete" ON public.members
  FOR DELETE TO authenticated
  USING (
    (SELECT public.current_member_is_super_admin())
    OR group_id = (SELECT public.current_member_admin_group_id())
    OR (
      group_id IS NOT NULL
      AND (SELECT public.visible_invite_group_ids()) @> ARRAY[group_id]
      AND (SELECT public.current_member_is_admin())
    )
  );

-- ------------------------------------------------------------
-- (3) groups の改名（元から「管理者 AND 自分のホーム部署」＝意味は変えない）
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "groups_update_admin" ON public.groups;
CREATE POLICY "groups_update_admin" ON public.groups
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.current_member_is_super_admin())
    OR id = (SELECT public.current_member_admin_group_id())
  );

-- ------------------------------------------------------------
-- (4) 特権列ガード。変えたのはフェーズ2（group_id と is_admin を分離）と、
--     フェーズ4・5の「管理者なら許可」を v_can_manage（対象行のホーム部署の管理者）にした点だけ。
--     フェーズ1（is_super_admin）・フェーズ3（group_ids）・末尾の正規化は1文字も変えていない。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_member_privilege_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_guard$
DECLARE
  dept_admin_count    integer;
  super_admin_count   integer;
  acting_super_admin  boolean;
  self_bootstrap_super_admin boolean := false;
  v_can_manage        boolean;
  old_is_admin        boolean;
  old_is_super_admin  boolean;
  old_group_id        text;
  check_group_id      text;
  old_group_ids       text[];
  old_email           text;
  old_is_deleted      boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    old_is_admin       := false;
    old_is_super_admin := false;
    old_group_id       := NEW.group_id;
    check_group_id     := NEW.group_id;
    old_group_ids      := NULL; -- INSERTには「以前の行」が存在しない
    old_email          := NEW.email;
    old_is_deleted     := NEW.is_deleted;
  ELSE
    old_is_admin       := OLD.is_admin;
    old_is_super_admin := OLD.is_super_admin;
    old_group_id       := OLD.group_id;
    check_group_id     := OLD.group_id;
    old_group_ids      := OLD.group_ids;
    old_email          := OLD.email;
    old_is_deleted     := OLD.is_deleted;
  END IF;

  acting_super_admin := public.current_member_is_super_admin();

  -- フェーズ1: is_super_admin（全社ロール。他人の代理昇格は不可、自分自身のみブートストラップ可）
  IF NEW.is_super_admin IS DISTINCT FROM old_is_super_admin THEN
    IF acting_super_admin THEN
      NULL;
    ELSE
      SELECT count(*) INTO super_admin_count
      FROM public.members
      WHERE is_super_admin = true AND is_deleted = false;

      IF super_admin_count = 0 AND NEW.email = auth.email() THEN
        self_bootstrap_super_admin := true;
      ELSE
        NEW.is_super_admin := old_is_super_admin;
      END IF;
    END IF;
  END IF;

  -- 【2026-10-07・v3.137】対象行のホーム部署を管理できるか。管理者の権限はホーム部署だけに効く
  -- （兼務先では一般メンバー扱い）。招待用部署がホームの行（ゲスト）は今までどおり
  -- 「どこかの管理者」なら可（RLS の招待条項が、見えている招待用部署に限っている）。
  v_can_manage := acting_super_admin
    OR self_bootstrap_super_admin
    OR (check_group_id IS NOT NULL
        AND check_group_id IS NOT DISTINCT FROM public.current_member_admin_group_id())
    OR (public.current_member_is_admin()
        AND EXISTS (
          SELECT 1 FROM public.groups g
          WHERE g.id = check_group_id AND g.is_invite_group = true
        ));

  -- フェーズ2a: group_id（ホーム部署の付け替え）。旧部署と新部署の両方の管理者であることを要求する。
  -- 管理者のホーム部署は1つなので実質 super_admin だけ（片側の管理者だけで移せると、押し付け・
  -- 引き抜きが一方的にできるため）。部署ブートストラップ猶予の対象にもしない。
  IF NEW.group_id IS DISTINCT FROM old_group_id THEN
    IF acting_super_admin OR self_bootstrap_super_admin THEN
      NULL;
    ELSE
      NEW.group_id := old_group_id;
    END IF;
  END IF;

  -- フェーズ2b: is_admin（部署内権限）
  IF NEW.is_admin IS DISTINCT FROM old_is_admin THEN
    IF v_can_manage THEN
      NULL;
    ELSE
      SELECT count(*) INTO dept_admin_count
      FROM public.members
      WHERE group_id = check_group_id
        AND is_admin = true
        AND is_deleted = false;

      -- 部署ブートストラップ：その部署に is_admin=true が1人もいなければ許可。
      -- 招待用部署は除外（v3.75。admin を作る経路が無く恒久的な窓になるため）。
      -- group_id が NULL の行も除外（v3.137。自分の行を更新できるようになったため、
      -- 「NULL＝管理者0人の部署」とみなすと誰でも管理者になれてしまう）。
      IF check_group_id IS NOT NULL
         AND dept_admin_count = 0
         AND NOT EXISTS (
           SELECT 1 FROM public.groups g
           WHERE g.id = check_group_id AND g.is_invite_group = true
         ) THEN
        NULL;
      ELSE
        NEW.is_admin := old_is_admin;
      END IF;
    END IF;
  END IF;

  -- フェーズ3（複数部署アクセス。migration 20260722b／招待 20260810）: group_ids
  IF acting_super_admin OR self_bootstrap_super_admin THEN
    NULL;
  ELSIF TG_OP = 'INSERT' OR NEW.group_id IS DISTINCT FROM old_group_id THEN
    NEW.group_ids := CASE WHEN NEW.group_id IS NULL THEN '{}'::text[] ELSE ARRAY[NEW.group_id] END;
  ELSIF coalesce(current_setting('app.allow_invite_group_grant', true), '') = 'on'
        AND NEW.group_ids @> old_group_ids
        AND NOT EXISTS (
          SELECT 1 FROM unnest(NEW.group_ids) AS gid
          WHERE gid <> ALL(old_group_ids)
            AND NOT EXISTS (
              SELECT 1 FROM public.groups g WHERE g.id = gid AND g.is_invite_group = true
            )
        )
  THEN
    NULL;
  ELSE
    NEW.group_ids := old_group_ids;
  END IF;

  -- フェーズ4: email（同一性判定キー）。許可は「対象行のホーム部署を管理できる」か「本人の行」。
  IF TG_OP = 'UPDATE' AND NEW.email IS DISTINCT FROM old_email THEN
    IF v_can_manage
       OR old_email IS NOT DISTINCT FROM auth.email() THEN
      NULL;
    ELSE
      NEW.email := old_email;
    END IF;
  END IF;

  -- フェーズ5: is_deleted の false→true（論理削除）。対象行のホーム部署を管理できる人だけ。
  IF TG_OP = 'UPDATE'
     AND coalesce(NEW.is_deleted, false) = true
     AND coalesce(old_is_deleted, false) = false THEN
    IF v_can_manage THEN
      NULL;
    ELSE
      NEW.is_deleted := old_is_deleted;
      NEW.deleted_at := OLD.deleted_at;
      NEW.deleted_by := OLD.deleted_by;
    END IF;
  END IF;

  -- 常に NEW.group_id が NEW.group_ids に含まれるよう最終正規化する（安全網）
  IF NEW.group_id IS NOT NULL AND NOT (NEW.group_id = ANY(COALESCE(NEW.group_ids, '{}'::text[]))) THEN
    NEW.group_ids := array_append(COALESCE(NEW.group_ids, '{}'::text[]), NEW.group_id);
  END IF;

  RETURN NEW;
END;
$fn_guard$;

-- トリガー本体（trg_members_guard_privilege：BEFORE INSERT OR UPDATE）は変えない。

COMMIT;

-- ------------------------------------------------------------
-- 確認クエリ（読み取りのみ）
-- ------------------------------------------------------------
SELECT tablename, policyname, cmd,
       position('current_member_admin_group_id' IN coalesce(qual, '') || coalesce(with_check, '')) > 0 AS uses_home_admin
FROM pg_policies
WHERE (tablename = 'members' AND policyname LIKE 'members_write_%')
   OR (tablename = 'groups' AND policyname = 'groups_update_admin')
ORDER BY 1, 2;
-- 期待：4行すべて uses_home_admin = true

SELECT position('NEW.group_id := old_group_id;' IN pg_get_functiondef('public.guard_member_privilege_columns'::regproc)) > 0 AS guard_has_group_revert,
       position('v_can_manage' IN pg_get_functiondef('public.guard_member_privilege_columns'::regproc)) > 0 AS guard_has_can_manage;
-- 期待：どちらも true
