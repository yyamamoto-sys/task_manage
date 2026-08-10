-- ============================================================
-- プロジェクト招待：取り消し機能 revoke_project_invite（Phase 2）
-- 2026-08-10（v3.44）
--
-- 【正本】docs/dev/project-invite-plan.md §6・§8
-- Phase 1（20260810_add_project_invites.sql）には revoked_at/revoked_by 列だけ用意し、
-- 書き込み経路（RPC）が無かった。Phase 2（管理画面の招待一覧・取り消しボタン）実装に
-- あたり、その書き込み経路として本関数を追加する。
--
-- 【検証（create_project_invite() と同じ考え方）】
--   1) 呼び出し者が current_member_id() を持つこと（メンバー登録済みであること）
--   2) 呼び出し者が対象招待の project_id のPJにアクセスできること（can_access_group_ids）。
--      🔴 これが無いと他部署の招待を取り消せてしまう（create_project_invite()の1点目の
--      安全弁と同じ理由）。
--   3) 既に accepted_at が入っている招待は取り消せない（既に使われているため取り消す
--      意味が無い。明示的なエラーにする）
--
-- 🔴 NULL猶予条項は書かない（CLAUDE.md Section 1.6の教訓）。
-- 🔴 SET search_path = ''（既存の流儀を維持）。
-- 🔴 ドル引用タグは関数固有（$fn_revoke_project_invite$）にする
--   （複数関数で$$を共有すると、コピペで1文字欠けた際に後続関数を巻き込み無関係な行で
--   エラーになる事故が起きるため）。
--
-- 【適用】Supabase SQL Editor に全文を貼って実行する（dev → prod の順）。
--   ⚠️ このファイルは山本さんが手動で適用します。エージェントは適用しないこと。
-- ============================================================

CREATE OR REPLACE FUNCTION public.revoke_project_invite(
  p_invite_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn_revoke_project_invite$
DECLARE
  v_caller_id         text;
  v_project_id        text;
  v_project_group_ids text[];
  v_accepted_at       timestamptz;
  v_revoked_at        timestamptz;
BEGIN
  v_caller_id := public.current_member_id();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION '招待の取り消しにはメンバー登録が必要です' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT pi.project_id, pi.accepted_at, pi.revoked_at
    INTO v_project_id, v_accepted_at, v_revoked_at
  FROM public.project_invites pi
  WHERE pi.id = p_invite_id;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION '対象の招待が見つかりません' USING ERRCODE = 'no_data_found';
  END IF;

  SELECT p.group_ids INTO v_project_group_ids
  FROM public.projects p
  WHERE p.id = v_project_id;

  -- 🔴🔴🔴 最重要：呼び出し者が対象招待のproject_idのPJにアクセスできるかを検証する。
  -- この関数はSECURITY DEFINERのためRLSを迂回する。この検証を欠くと、
  -- ログインしている全メンバーが任意の（他部署の）招待を取り消せてしまう
  -- （create_project_invite()の1点目の安全弁と同じ理由）。
  IF v_project_group_ids IS NULL OR NOT public.can_access_group_ids(v_project_group_ids) THEN
    RAISE EXCEPTION 'この招待を取り消す権限がありません' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 🔴 既に使用済みの招待は取り消せない（既に members 行が作られているため、取り消しても
  -- 意味が無い。誤操作で押しても実害の無い明示的なエラーにする）。
  IF v_accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'この招待は既に使用されているため取り消せません' USING ERRCODE = 'check_violation';
  END IF;

  IF v_revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'この招待は既に取り消されています' USING ERRCODE = 'check_violation';
  END IF;

  -- WHERE句で「まだ未使用・未取消」を再確認しながら更新する（TOCTOU対策の二重の安全網。
  -- accept_project_invite()と同じ流儀）。0行ならこの関数呼び出し全体を例外で終える。
  UPDATE public.project_invites
  SET revoked_at = now(), revoked_by = v_caller_id
  WHERE id = p_invite_id
    AND accepted_at IS NULL
    AND revoked_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'この招待は他の操作により状態が変わりました。もう一度お試しください'
      USING ERRCODE = 'check_violation';
  END IF;
END;
$fn_revoke_project_invite$;

GRANT EXECUTE ON FUNCTION public.revoke_project_invite(uuid) TO authenticated;

-- ============================================================
-- 確認クエリ（山本さんへ：適用後に以下を実行し、期待どおりであることを確認してください）
-- ============================================================

-- 1) 関数が存在するか
-- SELECT proname FROM pg_proc WHERE proname = 'revoke_project_invite';

-- 2) 未使用の招待を1件取り消してみて、revoked_at/revoked_byが入ること
-- SELECT revoke_project_invite('<project_invitesのid>');
-- SELECT id, accepted_at, revoked_at, revoked_by FROM project_invites WHERE id = '<同id>';

-- 3) 既に使用済みの招待（accepted_atがある行）に対して呼ぶとエラーになること
-- SELECT revoke_project_invite('<使用済みのinvite id>');

-- 4) 既に取り消し済みの招待に対して再度呼ぶとエラーになること
-- SELECT revoke_project_invite('<取り消し済みのinvite id>');

-- 5) 自分がアクセスできない部署のPJに紐づく招待IDを渡すとエラーになること
--    （他部署のprojectに紐づくproject_invites.idで試す）
