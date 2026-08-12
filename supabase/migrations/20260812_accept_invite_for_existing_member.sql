-- ============================================================
-- プロジェクト招待：既にアプリを使っている人が招待された場合に対応する
-- 2026-08-12（v3.68）
--
-- 【正本】docs/dev/project-invite-plan.md／CLAUDE.md Section 25
--
-- 【背景・現状のズレ】
-- accept_project_invite() は無条件で members に新規行をINSERTしていた。既に他部署で
-- このアプリを使っている人（auth.email()と一致する有効なmembers行を既に持つ人）が
-- 招待を受諾しようとすると、members_email_unique（部分一意インデックス）に阻まれ
-- 23505エラーになる（データは壊れないが、技術的なエラーしか出せず行き止まりだった）。
--
-- 【この修正で変えること（ここだけ）】
-- accept_project_invite() の中で、検証条件1〜4（存在・未使用・未取消／24時間以内／
-- メール完全一致・auth.email()一致／ハッシュ照合）を1つも省略せず全て通過した後に、
-- 「auth.email() と一致する有効な（is_deleted=false）members行が既にあるか」で分岐する：
--   ・無ければ：従来どおり新規INSERT（挙動を変えない）
--   ・あれば：INSERTせず、その既存行の group_ids に招待用部署を追加する（兼務）。
--     display_name/short_name/initials/color_bg/color_text の引数は無視する（既存の
--     表示名・色を上書きしない）。is_admin/is_super_admin/group_id（ホーム部署）は
--     一切変更しない（現在の値のまま）。既に招待用部署を持っている場合は何もせず
--     成功として扱う（冪等）。
--
-- 【is_admin/is_super_admin/group_id/表示名を変更しないことの担保】
-- 既存メンバー分岐では members に対して UPDATE を1回だけ発行し、そのSET句は
-- group_ids のみ（他の列は一切含まれない）。UPDATE文に列が現れない以上、
-- is_admin・is_super_admin・group_id・display_name等は物理的に変更され得ない
-- （「変更しない」という分岐を書く必要すらない。書かれていない列は触れない）。
--
-- 【guard_member_privilege_columns()は変更しない】
-- 既存メンバーへの group_ids 追加は、create_project_invite() が発行者本人・PJオーナーに
-- 兼務を付与するときと全く同じ仕組み（app.allow_invite_group_grant セッション変数。
-- migrations/20260810_add_project_invites.sql ブロック3）にそのまま乗せる。新しい抜け道は
-- 作らない。トリガー側の3条件（①セッション変数が立っている ②既存の所属を1件も失っていない
-- ③追加分が全てis_invite_group=trueのグループ）は今回のUPDATEでもそのまま満たされる。
--
-- 【NULL猶予条項は書かない】CLAUDE.md Section 1.6の2026-06-26事故の教訓を厳守。
-- 【SET search_path = ''】既存の流儀を維持。
-- 【ドル引用タグ】$fn_accept_project_invite$ のまま（関数名自体を変えないため。他関数と
-- 共有していない固有タグである点は変わらない）。
--
-- 【⚠️ スキーマ検査（schemaChecks.ts）で検知できない変更】
-- schemaChecks.ts の kind:"function" は pg_proc に同名関数が存在するかしか見ない
-- （check_schema_health RPC の実装＝20260806_add_schema_health_check.sql 参照）。
-- 今回は accept_project_invite() の「名前・引数の型」を変えず本文（関数の中身）だけを
-- 差し替えるため、このマイグレーションが未適用でも fn_accept_project_invite の検査は
-- 「存在する」と判定され続け、適用漏れを検知できない。CLAUDE.md Section 25にも明記する。
--
-- 【適用】Supabase SQL Editor に全文を貼って実行する（dev → prod の順）。
--   ⚠️ このファイルは山本さんが手動で適用します。エージェントは適用しないこと。
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
  v_code_hash        text;
  v_email_norm       text;
  v_auth_email       text;
  v_invite           record;
  v_member_id        text;
  v_existing_id       text;
  v_existing_group_ids text[];
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

  -- ============================================================
  -- 【2026-08-12・v3.68で追加】既存メンバー分岐
  -- auth.email() と一致する有効な（is_deleted=false）members行が既にあるかを調べる。
  -- 大文字小文字はクライアント側（App.tsx autoMatch()）の既存の比較方針に合わせ
  -- 大文字小文字を無視して照合する（members.email が過去に非正規化のまま保存された
  -- 行があっても取り逃さないため）。同一メールの有効行は通常1件のはずだが
  -- （members_email_unique）、理論上の重複に備え created_at 最古の1件に絞る。
  -- ============================================================
  SELECT id, group_ids INTO v_existing_id, v_existing_group_ids
  FROM public.members
  WHERE lower(coalesce(email, '')) = v_auth_email
    AND is_deleted = false
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    -- 既存メンバー：新規行は作らない。display_name/short_name/initials/color_bg/
    -- color_text の引数は無視する（渡された値をどの列にも書き込まない）。
    -- is_admin/is_super_admin/group_id（ホーム部署）も変更しない（SET句に含まれない）。
    v_member_id := v_existing_id;

    IF NOT (v_invite.invite_group_id = ANY(COALESCE(v_existing_group_ids, '{}'::text[]))) THEN
      -- create_project_invite() と同じ流儀：トランザクションローカルの許可フラグを
      -- 立てた場合に限り、guard_member_privilege_columns() が招待用部署への兼務追加を
      -- 通す（migrations/20260810_add_project_invites.sql ブロック3参照）。
      PERFORM set_config('app.allow_invite_group_grant', 'on', true);

      UPDATE public.members
      SET group_ids = array_append(coalesce(group_ids, '{}'::text[]), v_invite.invite_group_id)
      WHERE id = v_existing_id
        AND is_deleted = false
        AND NOT (v_invite.invite_group_id = ANY(coalesce(group_ids, '{}'::text[])));
    END IF;
    -- 既に招待用部署を持っている場合はここで何もしない（冪等に成功させる）。
  ELSE
    -- 従来どおり：新規メンバーとして作成する。
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
  END IF;

  -- 使用済みへの確定はWHERE句で「まだ未使用・未取消・期限内」を再確認しながら行う
  -- （advisory lockに加えた二重の安全網。既存メンバー分岐・新規分岐のどちらでも共通）。
  -- ここで0行なら例外を投げ、直前のUPDATE/INSERTも含めてこの関数呼び出し全体が
  -- ロールバックされる（孤立行・孤立した兼務は残らない）。
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
-- 適用後の確認クエリ（山本さんへ：以下を実行し、期待どおりであることを確認してください）
-- ============================================================

-- 1) 関数が存在するか（🔴 名前・引数のシグネチャは変えていないため、この検査だけでは
--    「本文が新しい版に差し替わったか」までは分からない。下記2)〜4)の実機確認が必須）。
-- SELECT proname FROM pg_proc WHERE proname = 'accept_project_invite';

-- 2) 【新規の人】これまでと同じ挙動であること：auth.email()と一致するmembers行が
--    存在しない状態で招待を受諾し、members行が1件増える（is_admin=false・
--    is_super_admin=false・group_id=招待用部署）ことを確認する。
-- SELECT count(*) FROM members WHERE is_deleted = false; -- 受諾前後で+1になること

-- 3) 【既存メンバー】auth.email()と一致する有効なmembers行が既にある状態で招待を受諾し、
--    ①members の行数が増えないこと ②その人のgroup_idsに招待用部署のid
--    （'grp-invite-<project_id>'）が追加されていること ③display_name/short_name/
--    initials/color_bg/color_text/is_admin/is_super_admin/group_id（ホーム部署）が
--    受諾の前後で1文字も変わっていないことを確認する。
-- SELECT id, display_name, short_name, initials, color_bg, color_text,
--        is_admin, is_super_admin, group_id, group_ids
-- FROM members WHERE email = '<既存メンバーのメール>';
-- -- 受諾前後でis_admin/is_super_admin/group_id/display_name等が完全に一致し、
-- -- group_idsだけが招待用部署の分だけ増えていることを目視確認する。

-- 4) 【冪等性】3)の状態のメンバーが、同じPJの別の招待（新しく発行し直したもの）を
--    もう一度受諾しても、group_idsに同じ招待用部署のidが重複して増えないこと。
-- SELECT group_ids FROM members WHERE email = '<既存メンバーのメール>';
-- -- 重複要素が無いことを確認する（配列の要素数が想定どおりであること）。

-- 5) project_invites側の確定（新規・既存どちらの分岐でも共通）：accepted_atと
--    accepted_member_idが正しく埋まっていること。
-- SELECT id, accepted_at, accepted_member_id FROM project_invites ORDER BY created_at DESC LIMIT 5;
