-- ============================================================
-- プロジェクト招待（部署外メンバーの受け入れ）Phase 1：DB・SECURITY DEFINER関数のみ
-- 2026-08-10（v3.42）
--
-- 【正本】docs/dev/project-invite-plan.md（特に §4 設計・§5 データモデル・§6 SECURITY DEFINER関数）
-- CLAUDE.md Section 1.6（マルチテナンシー・RLS・過去に実際に起きた事故と教訓）も必読。
--
-- 【一行で言うと】新しいアクセス制御の軸を作らない。PJごとに1つ「招待用の部署」
-- （is_invite_group=true）を作り、既存の複数部署アクセス機構（group_ids配列）に乗せる。
-- 既存テーブル（members/projects/tasks等）のRLSは1行も変えない。
--
-- 【今回作るもの】
--   (a) groups.is_invite_group 列
--   (b) project_invites テーブル（SELECTのみRLS。書き込みはSECURITY DEFINER関数経由のみ）
--   (c) create_project_invite(p_project_id, p_email) — 招待を発行
--   (d) accept_project_invite(p_code, p_email, ...) — 招待を受諾しmembersを作成
--   (e) guard_member_privilege_columns() の拡張（下記【重要】参照）
--
-- 【重要：guard_member_privilege_columns() を拡張する理由】
-- 決定事項「発行権限は全メンバー」により、create_project_invite() は発行者本人と
-- projects.owner_member_id に招待用部署への兼務（group_ids への追加）を付与する
-- （設計書§4-2。担当者の氏名を招待者から見せるため）。
-- ところがこの付与も普通の members UPDATE として guard_member_privilege_columns() トリガーを
-- 通過するため、既存ルール「非super-adminがgroup_ids自体を直接変更したら差し戻す」に
-- そのままぶつかり、例外を出さずに静かに元へ戻されてしまう（気づきにくい）。
-- そこで、create_project_invite() が明示的にトランザクションローカルのセッション変数
-- （app.allow_invite_group_grant）を立てた場合に限り、「既存の所属を1件も失わず」
-- 「追加分が全て is_invite_group=true のグループである」ときだけ許可する分岐を追加する。
-- この変数はPostgREST経由のクライアントから直接設定する手段が無い（生SQL実行経路が
-- 公開されていない）ため、create_project_invite() の内部でしか到達できない。
--
-- 【pgcryptoは使わない】
-- コード生成・ハッシュ化のどちらもpgcrypto（gen_random_bytes/digest）に依存させず、
-- PostgreSQL コア組み込み関数だけで実現した：
--   ・コード生成：gen_random_uuid()（PostgreSQL 13+でコアに组み込み）を2回連結・ハイフン除去
--     → 64桁の16進文字列（推測不能な十分な長さ）
--   ・ハッシュ化：sha256()（PostgreSQL 11+でpg_catalogに組み込み。pgcryptoの拡張は不要）
-- SET search_path = '' の環境でも pg_catalog は常に暗黙的に検索されるため問題なく動く。
-- pgcryptoが有効かどうかを事前確認する必要が無い設計にした（このリポジトリのエージェントは
-- Supabase本番への直接クエリ権限を持たないため、確認不能な前提を作らないための判断）。
--
-- 【NULL猶予条項は書かない】2026-06-26の事故の教訓（CLAUDE.md Section 1.6）を厳守。
-- 【SET search_path = ''】新設する2関数（create_project_invite/accept_project_invite）と
-- 拡張するguard_member_privilege_columns()のいずれも既存の流儀を維持する。
--
-- 【適用】Supabase SQL Editor に全文を貼って実行する（dev → prod の順）。
--   ⚠️ このファイルは山本さんが手動で適用します。エージェントは適用しないこと。
-- ============================================================

-- ============================================================
-- ブロック1: groups.is_invite_group 列
-- ============================================================
ALTER TABLE groups ADD COLUMN IF NOT EXISTS is_invite_group boolean NOT NULL DEFAULT false;

-- ============================================================
-- ブロック2: project_invites テーブル
-- ============================================================
CREATE TABLE IF NOT EXISTS project_invites (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          text NOT NULL REFERENCES projects(id),
  invite_group_id     text NOT NULL REFERENCES groups(id),
  invited_email       text NOT NULL,  -- 正規化済み（lower/trim）。検証条件3の照合先
  code_hash           text NOT NULL,  -- 平文コードは保存しない。sha256(コード)のhex表現
  invited_by          text NOT NULL REFERENCES members(id),
  expires_at          timestamptz NOT NULL,
  accepted_at         timestamptz,
  accepted_member_id  text REFERENCES members(id),
  revoked_at          timestamptz,   -- Phase 2で取り消し機能を実装する（今回は列のみ）
  revoked_by          text REFERENCES members(id),
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- 平文コードは保存していないが、ハッシュの一意性は保つ（衝突時に事故が起きないようにする安全網）。
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_invites_code_hash ON project_invites(code_hash);
CREATE INDEX IF NOT EXISTS idx_project_invites_project_id ON project_invites(project_id);
CREATE INDEX IF NOT EXISTS idx_project_invites_invited_by ON project_invites(invited_by);

ALTER TABLE project_invites ENABLE ROW LEVEL SECURITY;

-- 🔴 SELECTのみポリシーを作る。INSERT/UPDATE/DELETEのポリシーは意図的に作らない
-- （RLSは「ポリシーが無いコマンドは全否定」——create_project_invite()/accept_project_invite()
-- はテーブル所有者権限で実行されるSECURITY DEFINER関数なのでRLSを迂回して書き込めるが、
-- authenticatedロールからの直接INSERT/UPDATE/DELETEは常に拒否される。これが
-- 「クライアントから直接この表を書き込む経路を一切与えない」という安全弁の要）。
--
-- 可視範囲：発行者（invited_by）と同じ部署のメンバーが参照できる（監査のため。設計書§4-4）。
-- 🔴 code_hash はこのポリシーでは列単位で隠せない（RLSは行単位）。クライアント側
-- （src/lib/supabase/projectInviteStore.ts）のSELECTで明示的に列を指定し、code_hashを
-- 取得しないことで実質的に守る。
DROP POLICY IF EXISTS "project_invites_select_same_dept" ON project_invites;
CREATE POLICY "project_invites_select_same_dept" ON project_invites
  FOR SELECT TO authenticated
  USING (public.can_access_group_ids(public.member_group_ids(invited_by)));

-- ============================================================
-- ブロック3: guard_member_privilege_columns() の拡張
-- 既存の全文をそのまま持ち、フェーズ3（group_ids）に1分岐だけ追加する。
-- CREATE OR REPLACE のため既存トリガー（trg_members_guard_privilege）はそのまま使われる。
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
  old_group_ids       text[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    old_is_admin       := false;
    old_is_super_admin := false;
    old_group_id       := NEW.group_id;
    check_group_id     := NEW.group_id;
    old_group_ids      := NULL; -- INSERTには「以前の行」が存在しない
  ELSE
    old_is_admin       := OLD.is_admin;
    old_is_super_admin := OLD.is_super_admin;
    old_group_id       := OLD.group_id;
    check_group_id     := OLD.group_id;
    old_group_ids      := OLD.group_ids;
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
        NULL;
      ELSE
        NEW.is_super_admin := old_is_super_admin;
      END IF;
    END IF;
  END IF;

  will_be_super_admin := NEW.is_super_admin;

  -- フェーズ2: is_admin / group_id（部署内権限・所属）
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

  -- フェーズ3（複数部署アクセス。migration 20260722b）: group_ids（追加部署アクセス）
  -- 直接付与・剥奪はsuper-admin限定。非super-adminがホーム部署(group_id)を付け替えた場合
  -- （部署ブートストラップ含む）・新規作成時は、group_idsを新ホーム部署のみにリセットする
  -- （追記のまま残すと部署admin経由で複数部署アクセスを迂回的に付与できる抜け穴になるため）。
  -- NEW.group_id はフェーズ2で既に最終確定済み（差し戻された場合は old_group_id と一致）。
  --
  -- 【2026-08-10・migration 20260810_add_project_invites.sql で追加】プロジェクト招待機能の
  -- 「発行権限は全メンバー」（決定事項）により、create_project_invite() が発行者本人と
  -- PJオーナーに招待用部署（is_invite_group=true）への兼務をこのトリガー経由のUPDATEで
  -- 付与する。既存ルールのままだと非super-adminによるこのUPDATEは静かに差し戻されてしまう
  -- ため、以下の3条件を全て満たす場合に限り例外的に許可する：
  --   ① create_project_invite() がトランザクションローカルで明示的に立てたセッション変数
  --      （app.allow_invite_group_grant='on'）が立っている（PostgREST経由のクライアントは
  --      生SQL実行手段が無いため直接この変数を立てられない＝この関数の内部でしか到達しない）
  --   ② 既存の所属を1件も失っていない（NEW.group_ids @> old_group_ids）
  --   ③ 追加された要素が全て is_invite_group=true のグループである
  -- coalesce(...,'')='on' は「NULL（未設定）なら安全側＝許可しない」に倒すためのもので、
  -- 認可チェックをNULLで素通りさせる猶予条項ではない（Section 1.6の教訓とは別種の判定）。
  IF acting_super_admin OR will_be_super_admin THEN
    NULL; -- super-adminは自由に付与・剥奪可（末尾の正規化で group_id 包含だけ保証する）
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
    NULL; -- 招待用部署への兼務追加のみを許可（追加分が全てis_invite_group=trueであることを検証済み）
  ELSE
    NEW.group_ids := old_group_ids; -- 非super-adminによるgroup_ids自体の直接変更は差し戻す
  END IF;

  -- 常に NEW.group_id が NEW.group_ids に含まれるよう最終正規化する（安全網）
  IF NEW.group_id IS NOT NULL AND NOT (NEW.group_id = ANY(COALESCE(NEW.group_ids, '{}'::text[]))) THEN
    NEW.group_ids := array_append(COALESCE(NEW.group_ids, '{}'::text[]), NEW.group_id);
  END IF;

  RETURN NEW;
END;
$fn_guard$;

-- ============================================================
-- ブロック4: create_project_invite(p_project_id, p_email)
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_project_invite(
  p_project_id text,
  p_email text
)
RETURNS TABLE(invite_id uuid, code text, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_create_project_invite$
DECLARE
  -- 🔒 許可メールドメイン。追加・変更する場合はこの配列に列挙するだけでよい（複数指定可）。
  -- 変更時はマイグレーションの再適用が必要（値がSQL内にハードコードされているため）。
  v_allowed_domains   text[] := ARRAY['amita-net.co.jp'];
  v_caller_id         text;
  v_project_name      text;
  v_project_group_ids text[];
  v_owner_member_id   text;
  v_invite_group_id   text;
  v_email_norm        text;
  v_domain            text;
  v_code              text;
  v_code_hash         text;
  v_invite_id         uuid;
  v_expires_at        timestamptz;
BEGIN
  v_caller_id := public.current_member_id();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION '招待の発行にはメンバー登録が必要です' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT p.name, p.group_ids, p.owner_member_id
    INTO v_project_name, v_project_group_ids, v_owner_member_id
  FROM public.projects p
  WHERE p.id = p_project_id AND p.is_deleted = false;

  IF v_project_name IS NULL THEN
    RAISE EXCEPTION '対象のプロジェクトが見つかりません' USING ERRCODE = 'no_data_found';
  END IF;

  -- 🔴🔴🔴 最重要：呼び出し者が対象PJにアクセスできるかを検証する。
  -- この関数はSECURITY DEFINERのためRLSを迂回する。この検証を欠くと、
  -- ログインしている全メンバーが任意のPJへのアクセスを誰にでも配れてしまう
  -- （設計書§4-4・「発行権限は全メンバー」の代償として必ず入れる安全弁の1点目）。
  IF NOT public.can_access_group_ids(v_project_group_ids) THEN
    RAISE EXCEPTION 'このプロジェクトを招待する権限がありません' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 🔴 メールドメインの許可リスト検証。「@より後ろ（最後の@以降）」を取り出し、
  -- 許可リストの要素と完全一致するかだけを見る（部分一致・前方一致・後方一致は使わない。
  -- 例："user@amita-net.co.jp.evil.com" は末尾一致だと通ってしまうため完全一致にする）。
  v_email_norm := lower(trim(coalesce(p_email, '')));
  v_domain := substring(v_email_norm from '@([^@]+)$');
  IF v_domain IS NULL OR v_domain = '' THEN
    RAISE EXCEPTION 'メールアドレスの形式が正しくありません' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT (v_domain = ANY(v_allowed_domains)) THEN
    RAISE EXCEPTION '許可されていないメールドメインです（%）', v_domain USING ERRCODE = 'check_violation';
  END IF;

  -- 招待用部署：PJごとに1つ。idをPJから決定的に導出することで、同じPJに何度招待しても
  -- 同じ部署を再利用する（設計書§4-1）。
  v_invite_group_id := 'grp-invite-' || p_project_id;

  INSERT INTO public.groups (id, name, is_invite_group, updated_by)
  VALUES (v_invite_group_id, '招待用部署: ' || v_project_name, true, v_caller_id)
  ON CONFLICT (id) DO NOTHING;

  -- 対象PJのgroup_idsに招待用部署を追加（既に含まれていれば何もしない）
  UPDATE public.projects
  SET group_ids = array_append(group_ids, v_invite_group_id)
  WHERE id = p_project_id AND NOT (v_invite_group_id = ANY(group_ids));

  -- 発行者本人・PJオーナーに招待用部署を兼務付与（担当者の氏名を招待者から見せるため。
  -- 設計書§4-2）。guard_member_privilege_columns()のブロック3参照。
  PERFORM set_config('app.allow_invite_group_grant', 'on', true); -- トランザクションローカル

  UPDATE public.members
  SET group_ids = array_append(group_ids, v_invite_group_id)
  WHERE id = v_caller_id
    AND is_deleted = false
    AND NOT (v_invite_group_id = ANY(group_ids));

  IF v_owner_member_id IS NOT NULL AND v_owner_member_id <> v_caller_id THEN
    UPDATE public.members
    SET group_ids = array_append(group_ids, v_invite_group_id)
    WHERE id = v_owner_member_id
      AND is_deleted = false
      AND NOT (v_invite_group_id = ANY(group_ids));
  END IF;

  -- コード生成：pgcryptoに依存せず、コア組み込みのgen_random_uuid()を2回連結して
  -- 64桁の16進文字列（推測不能な値）を作る。
  v_code := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  -- ハッシュ化：pgcryptoのdigest()ではなく、pg_catalogに組み込みのsha256()を使う。
  -- 平文コードはDBに一切保存しない（戻り値として1度だけ返す）。
  v_code_hash := encode(sha256(convert_to(v_code, 'UTF8')), 'hex');
  v_expires_at := now() + interval '24 hours';

  INSERT INTO public.project_invites (
    project_id, invite_group_id, invited_email, code_hash, invited_by, expires_at
  ) VALUES (
    p_project_id, v_invite_group_id, v_email_norm, v_code_hash, v_caller_id, v_expires_at
  )
  RETURNING id INTO v_invite_id;

  RETURN QUERY SELECT v_invite_id, v_code, v_expires_at;
END;
$fn_create_project_invite$;

GRANT EXECUTE ON FUNCTION public.create_project_invite(text, text) TO authenticated;

-- ============================================================
-- ブロック5: accept_project_invite(p_code, p_email, p_display_name, p_short_name,
--                                   p_initials, p_color_bg, p_color_text)
-- ============================================================
CREATE OR REPLACE FUNCTION public.accept_project_invite(
  p_code text,
  p_email text,
  p_display_name text,
  p_short_name text,
  p_initials text,
  p_color_bg text,
  p_color_text text
)
RETURNS TABLE(member_id text, group_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_accept_project_invite$
DECLARE
  v_code_hash  text;
  v_email_norm text;
  v_auth_email text;
  v_invite     record;
  v_member_id  text;
BEGIN
  v_code_hash  := encode(sha256(convert_to(coalesce(p_code, ''), 'UTF8')), 'hex');
  v_email_norm := lower(trim(coalesce(p_email, '')));
  v_auth_email := lower(trim(coalesce(auth.email(), '')));

  IF v_auth_email = '' THEN
    RAISE EXCEPTION '認証されたメールアドレスが取得できません' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 同時実行のTOCTOU対策：同じ招待コードに対する同時受諾を直列化する
  -- （bootstrap_first_group_and_member()と同じ pg_advisory_xact_lock の流儀）。
  PERFORM pg_advisory_xact_lock(hashtext(v_code_hash));

  SELECT * INTO v_invite
  FROM public.project_invites
  WHERE code_hash = v_code_hash;

  -- 🔴 検証条件1：コードが存在し、未使用・未取消であること
  IF v_invite.id IS NULL THEN
    RAISE EXCEPTION '招待コードが無効です' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_invite.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'この招待は取り消されています' USING ERRCODE = 'check_violation';
  END IF;
  IF v_invite.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'この招待は既に使用されています' USING ERRCODE = 'check_violation';
  END IF;

  -- 🔴 検証条件2：発行から24時間以内であること
  IF v_invite.expires_at <= now() THEN
    RAISE EXCEPTION '招待の有効期限が切れています' USING ERRCODE = 'check_violation';
  END IF;

  -- 🔴 検証条件3：入力メールが招待時のメールと完全一致、かつauth.email()とも一致する
  -- （なりすまし防止。bootstrap_first_group_and_member()がauth.email()を使う先例に倣う）。
  IF v_invite.invited_email IS DISTINCT FROM v_email_norm
     OR v_invite.invited_email IS DISTINCT FROM v_auth_email THEN
    RAISE EXCEPTION 'メールアドレスが招待時の宛先と一致しません' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- （検証条件4：コードのハッシュ照合は、上のSELECTのWHERE code_hash = v_code_hashに
  --  折り込まれている。ハッシュが一致しなければv_invite.idがNULLになり条件1で弾かれる）

  IF coalesce(trim(p_display_name), '') = '' OR coalesce(trim(p_short_name), '') = '' THEN
    RAISE EXCEPTION '表示名・略称を入力してください' USING ERRCODE = 'check_violation';
  END IF;

  v_member_id := gen_random_uuid()::text;

  -- 🔴 is_admin / is_super_admin は必ずfalse（ここを間違えると権限昇格の穴になる）。
  -- ホーム部署は招待用部署。フェーズ3（group_ids）はINSERTのため無条件でgroup_id込みに
  -- 正規化される（guard_member_privilege_columns()参照。招待固有のセッション変数は不要）。
  INSERT INTO public.members (
    id, display_name, short_name, initials, teams_account, email,
    is_admin, is_super_admin, group_id, color_bg, color_text,
    is_deleted, updated_by
  ) VALUES (
    v_member_id, trim(p_display_name), trim(p_short_name), coalesce(p_initials, ''), '', v_auth_email,
    false, false, v_invite.invite_group_id, coalesce(p_color_bg, '#7F77DD'), coalesce(p_color_text, '#FFFFFF'),
    false, v_member_id
  );

  -- 使用済みへの確定はWHERE句で「まだ未使用・未取消・期限内」を再確認しながら行う
  -- （advisory lockに加えた二重の安全網。ここで0行なら例外を投げ、直前のmembers INSERTも
  -- 含めてこの関数呼び出し全体がロールバックされる＝孤立行は残らない）。
  UPDATE public.project_invites
  SET accepted_at = now(), accepted_member_id = v_member_id
  WHERE id = v_invite.id
    AND accepted_at IS NULL
    AND revoked_at IS NULL
    AND expires_at > now();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'この招待は他の操作により使用済みになりました。もう一度お試しください'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN QUERY SELECT v_member_id, v_invite.invite_group_id;
END;
$fn_accept_project_invite$;

GRANT EXECUTE ON FUNCTION public.accept_project_invite(text, text, text, text, text, text, text) TO authenticated;

-- ============================================================
-- ブロック6: 適用後の確認クエリ（山本さんへ：以下を実行し、期待どおりであることを確認してください）
-- ============================================================

-- 1) 列・テーブルが作成されたか
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'groups' AND column_name = 'is_invite_group';
-- SELECT table_name FROM information_schema.tables WHERE table_name = 'project_invites';

-- 2) RLSが有効化されているか（relrowsecurity = true）
-- SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'project_invites';

-- 3) project_invitesにSELECT以外のポリシーが存在しないこと（0行であること。書き込みが
--    SECURITY DEFINER関数経由のみに限定されていることの確認）
-- SELECT policyname, cmd FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'project_invites' AND cmd <> 'r';

-- 4) 緩いポリシー（qualにcan_access_group_idsを含まない等）が残っていないこと（0行）
-- SELECT policyname, qual FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'project_invites'
--     AND coalesce(qual, '') NOT ILIKE '%can_access_group_ids%';

-- 5) NULL猶予条項（IS NULLでの抜け穴）が無いこと（0行）
-- SELECT tablename, policyname FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'project_invites'
--     AND (coalesce(qual, '') ILIKE '%is null%' OR coalesce(with_check, '') ILIKE '%is null%');

-- 6) 関数が存在するか
-- SELECT proname FROM pg_proc WHERE proname IN ('create_project_invite', 'accept_project_invite');

-- 7) guard_member_privilege_columns拡張の悪用確認：app.allow_invite_group_grant を立てずに
--    直接 group_ids を追加しようとしても増えないこと（非super-adminのメンバーで実行して確認）
-- UPDATE members SET group_ids = array_append(group_ids, 'grp-invite-<存在するPJのid>') WHERE id = '<自分のid>';
-- SELECT group_ids FROM members WHERE id = '<自分のid>'; -- → 追加されていないこと

-- 8) 実際に1件発行してみて、code_hashに平文コードが入っていないこと（十分な長さのhex文字列であること）を目視確認
-- SELECT id, project_id, invite_group_id, invited_email, length(code_hash), expires_at FROM project_invites ORDER BY created_at DESC LIMIT 1;
