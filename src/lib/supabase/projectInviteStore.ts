// src/lib/supabase/projectInviteStore.ts
//
// 【設計意図】
// プロジェクト招待（docs/dev/project-invite-plan.md）のRPC呼び出しラッパー＋一覧取得。
// Phase 1（今回）はDB・SECURITY DEFINER関数・型・ストア層のみで、発行UI・管理画面・
// ログイン導線は作らない（Phase 2/3で別途実装）。
//
// 🔴 appStore.ts には足さない。招待は管理系の機能で、全員が起動時に読む必要が無い
// （個人OKRと同じ判断。CLAUDE.md Section 19）。この store は招待機能を実際に使う画面
// （Phase 2で実装）からのみ動的にimportされる想定。
//
// 🔴 code_hash は絶対にselectしない。project_invites の RLS（SELECTのみ・発行者と同じ
// 部署のメンバーが参照可）は行単位の制御のため、列単位でcode_hashを隠せない。この
// ファイルのfetchProjectInvitesが明示的に列を指定することが、平文コードのハッシュを
// クライアントに渡さないための唯一の防波堤になっている。ここを変更するときは必ず
// 列リストからcode_hashが漏れていないことを確認すること。
//
// エラーはそのまま呼び出し元に投げる（catchして握り潰さない）。呼び出し元は
// formatErrorForUser()（CLAUDE.md Section 15）を通して表示すること。

import { supabase } from "./client";
import type { ProjectInvite } from "../localData/types";

export interface CreateProjectInviteResult {
  /** project_invites.id */
  inviteId: string;
  /** 平文の招待コード。この呼び出しの戻り値でのみ得られる（DBには保存されない）。 */
  code: string;
  /** ISO文字列。発行から24時間後。 */
  expiresAt: string;
}

/**
 * 招待を発行する（create_project_invite RPC）。
 * 呼び出し者が対象PJにアクセスできるか・メールドメインが許可リストに含まれるかは
 * 関数側（SQL）で検証される。ここでのクライアント側の事前検証は行わない
 * （SQL側の検証が唯一の権限制御であり、クライアント側の事前チェックは省略しても安全性は
 * 変わらない。誤ったUXでの早期リターンを増やさないための判断）。
 */
export async function createProjectInvite(
  projectId: string,
  email: string,
): Promise<CreateProjectInviteResult> {
  const { data, error } = await supabase.rpc("create_project_invite", {
    p_project_id: projectId,
    p_email: email,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("招待の作成に失敗しました（応答が空でした）");
  return { inviteId: row.invite_id, code: row.code, expiresAt: row.expires_at };
}

export interface AcceptProjectInviteParams {
  code: string;
  email: string;
  displayName: string;
  shortName: string;
  initials: string;
  colorBg: string;
  colorText: string;
}

export interface AcceptProjectInviteResult {
  memberId: string;
  groupId: string;
}

/**
 * 招待を受諾してmembersを作成する（accept_project_invite RPC）。
 * 呼び出し前提：Supabase Authでサインアップ済み（auth.email()が確定していること）。
 * 4条件（存在/未使用/未取消・24時間以内・メール完全一致・コードのハッシュ照合）の検証は
 * 関数側（SQL）が行う。
 */
export async function acceptProjectInvite(
  params: AcceptProjectInviteParams,
): Promise<AcceptProjectInviteResult> {
  const { data, error } = await supabase.rpc("accept_project_invite", {
    p_code: params.code,
    p_email: params.email,
    p_display_name: params.displayName,
    p_short_name: params.shortName,
    p_initials: params.initials,
    p_color_bg: params.colorBg,
    p_color_text: params.colorText,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("招待の受諾に失敗しました（応答が空でした）");
  return { memberId: row.member_id, groupId: row.group_id };
}

/**
 * 招待の一覧を取得する（監査用途。Phase 2の管理画面から使う想定）。
 * RLS（project_invites_select_same_dept）が発行者と同じ部署のメンバーに絞るため、
 * ここでは追加のフィルタは行わない。projectId を渡すと対象PJの招待だけに絞る。
 *
 * 🔴 列は明示的に列挙し、code_hash を含めない（本ファイル冒頭コメント参照）。
 */
export async function fetchProjectInvites(projectId?: string): Promise<ProjectInvite[]> {
  let query = supabase
    .from("project_invites")
    .select(
      "id, project_id, invite_group_id, invited_email, invited_by, expires_at, accepted_at, accepted_member_id, revoked_at, revoked_by, created_at",
    )
    .order("created_at", { ascending: false });
  if (projectId) {
    query = query.eq("project_id", projectId);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as ProjectInvite[];
}
