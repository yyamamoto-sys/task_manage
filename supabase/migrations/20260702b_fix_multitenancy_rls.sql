-- RLSの穴を塞ぐ（セキュリティ調査 2026-07-02 で発見）
-- 適用方法: Supabase SQL Editor に全文貼って実行
--
-- 【背景】20260626_add_multitenancy.sql の "OR current_member_group_id() IS NULL" は
-- 移行期間の猶予のつもりだったが、実際には「新規サインアップしただけで members に
-- まだ登録されていないユーザー」全員に対して、全グループの members/projects/tasks を
-- 無制限に公開してしまう抜け穴になっていた（current_member_group_id() が NULL を返すと
-- 猶予条項が true になり、group_id の一致チェックが素通りする）。
--
-- このマイグレーションで直すもの：
-- 1. members/projects/tasks の RLS から NULL 抜け穴を除去
-- 2. groups テーブルの書き込み（作成・改名・削除）を管理者限定に縮小（従来は全員可）
-- 3. members.is_admin / members.group_id をクライアントから自己昇格できないようにガード
--    （ブートストラップ＝そのグループに管理者が1人もいない間だけは自己昇格を許可）
-- 4. current_member_group_id() の search_path を固定（関数ハイジャック対策のハードニング）
--
-- 【適用前提】既存メンバー全員に email・group_id が設定済みであること
--（20260626_add_multitenancy.sql / 20260626_add_member_email.sql 適用済みなら OK）。
--
-- 【一括実行でエラーが出る場合】このファイルは 5 ブロック（===== 区切り）に分かれています。
-- 一括で失敗する場合は、ブロックごとに区切ってひとつずつ実行すると失敗箇所を特定できます。

-- ============================================================
-- ブロック1: current_member_group_id()：search_path 固定
-- ============================================================
CREATE OR REPLACE FUNCTION current_member_group_id()
RETURNS text
LANGUAGE sql
SECURITY DEFINER STABLE
SET search_path = ''
AS $fn_group_id$
  SELECT group_id FROM public.members
  WHERE email = auth.email()
    AND is_deleted = false
  LIMIT 1
$fn_group_id$;

-- ============================================================
-- ブロック2: 管理者判定関数（新規）
-- ============================================================
CREATE OR REPLACE FUNCTION current_member_is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER STABLE
SET search_path = ''
AS $fn_is_admin$
  SELECT COALESCE(is_admin, false) FROM public.members
  WHERE email = auth.email()
    AND is_deleted = false
  LIMIT 1
$fn_is_admin$;

-- ============================================================
-- ブロック3: members / projects / tasks：NULL 抜け穴を閉じる
-- ============================================================
DROP POLICY IF EXISTS "members_group" ON members;
CREATE POLICY "members_group" ON members FOR ALL TO authenticated
  USING (group_id = current_member_group_id());

DROP POLICY IF EXISTS "projects_group" ON projects;
CREATE POLICY "projects_group" ON projects FOR ALL TO authenticated
  USING (group_id = current_member_group_id());

DROP POLICY IF EXISTS "tasks_group" ON tasks;
CREATE POLICY "tasks_group" ON tasks FOR ALL TO authenticated
  USING (group_id = current_member_group_id());

-- ============================================================
-- ブロック4: groups：参照は全員可、書き込みは管理者のみ
-- ============================================================
DROP POLICY IF EXISTS "groups_auth" ON groups;
DROP POLICY IF EXISTS "groups_select" ON groups;
CREATE POLICY "groups_select" ON groups FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "groups_insert_admin" ON groups;
CREATE POLICY "groups_insert_admin" ON groups FOR INSERT TO authenticated
  WITH CHECK (current_member_is_admin());

DROP POLICY IF EXISTS "groups_update_admin" ON groups;
CREATE POLICY "groups_update_admin" ON groups FOR UPDATE TO authenticated
  USING (current_member_is_admin());

DROP POLICY IF EXISTS "groups_delete_admin" ON groups;
CREATE POLICY "groups_delete_admin" ON groups FOR DELETE TO authenticated
  USING (current_member_is_admin());

-- ============================================================
-- ブロック5: members：is_admin / group_id の自己昇格防止
-- ============================================================
-- RLS は行単位の可視性しか制御できないため（「自分の行だが is_admin 列だけは
-- 変更禁止」は書けない）、BEFORE UPDATE トリガーで列単位のガードを行う。
CREATE OR REPLACE FUNCTION guard_member_privilege_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_guard$
DECLARE
  admin_count integer;
BEGIN
  IF NEW.is_admin IS DISTINCT FROM OLD.is_admin
     OR NEW.group_id IS DISTINCT FROM OLD.group_id THEN

    -- 既に管理者なら何でも変更可（他メンバーの昇格・降格・グループ移動含む）
    IF public.current_member_is_admin() THEN
      RETURN NEW;
    END IF;

    -- ブートストラップ：そのグループに is_admin=true が1人もいなければ自己昇格を許可
    -- （AdminView.tsx のクライアント側ブートストラップロジックと整合させるため）
    SELECT count(*) INTO admin_count
    FROM public.members
    WHERE group_id = OLD.group_id
      AND is_admin = true
      AND is_deleted = false;

    IF admin_count = 0 THEN
      RETURN NEW;
    END IF;

    -- 権限昇格・テナント越境を試みた場合は該当列だけ元の値に戻す
    -- （他のフィールド＝表示名や連絡先の保存は妨げない）
    NEW.is_admin := OLD.is_admin;
    NEW.group_id := OLD.group_id;
  END IF;

  RETURN NEW;
END;
$fn_guard$;

DROP TRIGGER IF EXISTS trg_members_guard_privilege ON members;
CREATE TRIGGER trg_members_guard_privilege
  BEFORE UPDATE ON members
  FOR EACH ROW EXECUTE FUNCTION guard_member_privilege_columns();
