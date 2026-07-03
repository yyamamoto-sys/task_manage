-- 全社スーパー管理者ロール＋部署ガバナンス強化
-- 適用方法: Supabase SQL Editor に全文貼って実行
--
-- 【背景】全社展開（全社環境＞各部署）に向けて、部署をまたぐ権限を持つ
-- 全社スーパー管理者（is_super_admin）を導入する。既存の is_admin（部署内管理者）
-- とは直交するロール。あわせて、部署（groups）の作成・削除に関するガバナンスの
-- 穴（誰でも新規部署を作れる／非空の部署を削除できる）を塞ぐ。
--
-- 【重要】このファイルは6ブロックに分かれています。一括実行で失敗する場合は
-- ブロックごとに区切って実行し、失敗箇所を特定してください（過去に共有の $$ を
-- 使って事故が起きたため、このファイルは関数ごとに固有のドル引用タグを使っています）。
--
-- 【適用後すぐにやること】適用直後は company-wide に is_super_admin=true が
-- 0人の状態（ブートストラップ窓が開いている）。窓を開けたままにせず、
-- 適用したその場でオーナー自身がアプリのMembersSectionから自分の行を
-- is_super_admin=true に更新すること（SQL Editorはservice roleでRLSを
-- 素通りするため、この昇格操作は必ずアプリ経由で行う）。
--
-- 【対象外】OKR系テーブル（objectives/key_results/task_forces/todos等）は
-- 依然として部署分離されていません。新しい部署はPJ/タスク管理機能のみ
-- 使うようにし、OKR機能は使わないでください（別途Phase 2で対応予定）。

-- ============================================================
-- ブロック1: members.is_super_admin 列を追加
-- ============================================================
ALTER TABLE members ADD COLUMN IF NOT EXISTS is_super_admin boolean NOT NULL DEFAULT false;

-- ============================================================
-- ブロック2: 全社スーパー管理者判定関数（新規）
-- ============================================================
CREATE OR REPLACE FUNCTION current_member_is_super_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER STABLE
SET search_path = ''
AS $fn_is_super_admin$
  SELECT COALESCE(is_super_admin, false) FROM public.members
  WHERE email = auth.email()
    AND is_deleted = false
  LIMIT 1
$fn_is_super_admin$;

-- ============================================================
-- ブロック3: members / projects / tasks：super-adminは部署をまたいでアクセス可
-- ============================================================
DROP POLICY IF EXISTS "members_group" ON members;
CREATE POLICY "members_group" ON members FOR ALL TO authenticated
  USING (group_id = current_member_group_id() OR current_member_is_super_admin());

DROP POLICY IF EXISTS "projects_group" ON projects;
CREATE POLICY "projects_group" ON projects FOR ALL TO authenticated
  USING (group_id = current_member_group_id() OR current_member_is_super_admin());

DROP POLICY IF EXISTS "tasks_group" ON tasks;
CREATE POLICY "tasks_group" ON tasks FOR ALL TO authenticated
  USING (group_id = current_member_group_id() OR current_member_is_super_admin());

-- ============================================================
-- ブロック4: groups：新規部署の作成はsuper-admin限定。
--            改名・編集は「super-admin」または「自分の部署のadmin」のみ。
--            物理DELETEはsuper-admin限定（アプリは物理DELETEを使わないが念のため）。
-- ============================================================
DROP POLICY IF EXISTS "groups_insert_admin" ON groups;
CREATE POLICY "groups_insert_admin" ON groups FOR INSERT TO authenticated
  WITH CHECK (current_member_is_super_admin());

DROP POLICY IF EXISTS "groups_update_admin" ON groups;
CREATE POLICY "groups_update_admin" ON groups FOR UPDATE TO authenticated
  USING (
    current_member_is_super_admin()
    OR (current_member_is_admin() AND id = current_member_group_id())
  );

DROP POLICY IF EXISTS "groups_delete_admin" ON groups;
CREATE POLICY "groups_delete_admin" ON groups FOR DELETE TO authenticated
  USING (current_member_is_super_admin());

-- groups_select（全員参照可）は変更なし（20260702bのまま）

-- ============================================================
-- ブロック5: members の権限列ガードを INSERT にも拡張し、is_super_admin も守る
--
-- 【設計】
-- ・is_super_admin（全社ロール）と is_admin/group_id（部署内ロール・所属）を
--   2フェーズで独立に判定する。
-- ・フェーズ1（is_super_admin）：
--     既存super-adminは誰の行でも自由に変更可。
--     それ以外は「company-wide に is_super_admin=true が1人もいない」場合に限り、
--     "自分自身の行"のみ自己昇格を許可する（他人の代理昇格は不可＝部署admin
--     ブートストラップより厳格。全社ロールは波及範囲が大きいため）。
-- ・フェーズ2（is_admin / group_id）：
--     (a) 既存super-admin、または(b)フェーズ1で自分自身が今まさに
--         super-adminになった場合、または(c)自分の所属部署のadminなら許可
--         （部署越境自体はRLSのUSING/WITH CHECKが別途ブロックする）。
--     それ以外は既存どおり「対象部署に is_admin=true が1人もいなければ許可」の
--     部署ブートストラップ。
-- ・INSERTにも同じ関数を適用する（TG_OPで分岐）。理由：RLSのWITH CHECKは
--   members_group では group_id しか見ないため、INSERTは元々このガードの
--   対象外だった＝「同じ部署の誰かが、is_admin=true（今回からis_super_admin=true
--   も）を持つ新規行を、他人のメールアドレスを騙って先回りINSERTする」を防げて
--   いなかった（is_adminについては既存の穴、is_super_adminはこの変更で新規に
--   同じ穴を作らないために必須）。
-- ============================================================
CREATE OR REPLACE FUNCTION guard_member_privilege_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_guard$
DECLARE
  dept_admin_count    integer;
  super_admin_count   integer;
  acting_super_admin  boolean;
  will_be_super_admin boolean;
  old_is_admin        boolean;
  old_is_super_admin  boolean;
  old_group_id        text;
  check_group_id      text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    old_is_admin       := false;
    old_is_super_admin := false;
    old_group_id       := NEW.group_id;
    check_group_id     := NEW.group_id;
  ELSE
    old_is_admin       := OLD.is_admin;
    old_is_super_admin := OLD.is_super_admin;
    old_group_id       := OLD.group_id;
    check_group_id     := OLD.group_id;
  END IF;

  acting_super_admin := public.current_member_is_super_admin();

  -- ===== フェーズ1: is_super_admin（全社ロール）=====
  IF NEW.is_super_admin IS DISTINCT FROM old_is_super_admin THEN
    IF acting_super_admin THEN
      NULL; -- 既存super-adminは誰の is_super_admin も自由に変更可
    ELSE
      SELECT count(*) INTO super_admin_count
      FROM public.members
      WHERE is_super_admin = true AND is_deleted = false;

      IF super_admin_count = 0 AND NEW.email = auth.email() THEN
        NULL; -- 全社ブートストラップ：自分自身の行に限り許可（他人の代理昇格は不可）
      ELSE
        NEW.is_super_admin := old_is_super_admin;
      END IF;
    END IF;
  END IF;

  will_be_super_admin := NEW.is_super_admin;

  -- ===== フェーズ2: is_admin / group_id（部署内権限・所属）=====
  IF NEW.is_admin IS DISTINCT FROM old_is_admin
     OR NEW.group_id IS DISTINCT FROM old_group_id THEN

    IF acting_super_admin OR will_be_super_admin THEN
      NULL; -- super-admin（既存 or フェーズ1で自己昇格した本人）は自由に変更可
    ELSIF public.current_member_is_admin() THEN
      NULL; -- 部署管理者は変更可（部署越境はRLSが別途ブロック）
    ELSE
      SELECT count(*) INTO dept_admin_count
      FROM public.members
      WHERE group_id = check_group_id
        AND is_admin = true
        AND is_deleted = false;

      IF dept_admin_count = 0 THEN
        NULL; -- 部署ブートストラップ：その部署にis_admin=trueが1人もいなければ許可
      ELSE
        NEW.is_admin  := old_is_admin;
        NEW.group_id  := old_group_id;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$fn_guard$;

DROP TRIGGER IF EXISTS trg_members_guard_privilege ON members;
CREATE TRIGGER trg_members_guard_privilege
  BEFORE INSERT OR UPDATE ON members
  FOR EACH ROW EXECUTE FUNCTION guard_member_privilege_columns();

-- ============================================================
-- ブロック6: groups：非空の部署はsuper-admin以外は論理削除できないようにする
--
-- 【設計】RLSは「行の可視性」しか表現できず、「is_deletedがfalse→trueへの
-- 遷移かどうか」「そのグループのアクティブメンバー数」といったOLD/NEW比較・
-- 集計は素直に書けないため、BEFORE UPDATEトリガーで実装する
-- （guard_member_privilege_columnsと同じ理由・同じ設計方針）。
-- ============================================================
CREATE OR REPLACE FUNCTION guard_group_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_guard_group_del$
DECLARE
  active_member_count integer;
BEGIN
  IF NEW.is_deleted = true AND OLD.is_deleted = false THEN
    IF public.current_member_is_super_admin() THEN
      RETURN NEW; -- super-adminは非空の部署でも強制削除可（統廃合用途）
    END IF;

    SELECT count(*) INTO active_member_count
    FROM public.members
    WHERE group_id = OLD.id
      AND is_deleted = false;

    IF active_member_count > 0 THEN
      RAISE EXCEPTION
        'このグループには % 名のアクティブなメンバーがいるため削除できません（全社スーパー管理者のみ強制削除可）',
        active_member_count
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn_guard_group_del$;

DROP TRIGGER IF EXISTS trg_groups_guard_deletion ON groups;
CREATE TRIGGER trg_groups_guard_deletion
  BEFORE UPDATE ON groups
  FOR EACH ROW EXECUTE FUNCTION guard_group_deletion();

-- ============================================================
-- 適用後の手順（このファイルの一部ではないが必ず直後にやること）：
-- 1. Supabaseにオーナー自身のアカウントでログインした状態で、管理画面 >
--    メンバー > 自分の行を編集 > 「全社スーパー管理者」をON > 保存。
--    （company-wide に is_super_admin=true が0人の間だけ自己昇格できる
--     ブートストラップ窓を、他の誰かに使われる前に閉じる）
-- ============================================================
