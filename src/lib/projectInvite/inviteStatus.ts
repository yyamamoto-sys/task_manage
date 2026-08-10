// src/lib/projectInvite/inviteStatus.ts
//
// 【設計意図】
// project_invites の状態（未使用／使用済み／期限切れ／取り消し済み）を判定する純粋関数。
// 管理画面の招待一覧（Phase 2）が使う。DBに status 列は無く、accepted_at/revoked_at/
// expires_at の3列から都度導出する（真実の列を増やさない・導出値をDBに持たせない方針）。
//
// 優先順位（上から判定）：
//   1) accepted_at がある → "used"（正規に使われた記録は他条件より優先する。使われた後に
//      たまたま期限を過ぎていても「使用済み」と表示すべきため）
//   2) revoked_at がある → "revoked"
//   3) 期限切れ（isInviteExpired）→ "expired"
//   4) それ以外 → "unused"
//
// 期限判定は inviteRules.ts の isInviteExpired（expiresAt <= now と同じ境界。SQL側の
// accept_project_invite() の `v_invite.expires_at <= now()` に合わせてある）を再利用し、
// 境界値の定義を2箇所に持たない。

import { isInviteExpired } from "./inviteRules";

export type ProjectInviteStatus = "unused" | "used" | "expired" | "revoked";

export interface ProjectInviteStatusInput {
  accepted_at?: string | null;
  revoked_at?: string | null;
  expires_at: string;
}

export function resolveInviteStatus(
  invite: ProjectInviteStatusInput,
  now: Date = new Date(),
): ProjectInviteStatus {
  if (invite.accepted_at) return "used";
  if (invite.revoked_at) return "revoked";
  if (isInviteExpired(new Date(invite.expires_at), now)) return "expired";
  return "unused";
}

export const PROJECT_INVITE_STATUS_LABEL: Record<ProjectInviteStatus, string> = {
  unused: "未使用",
  used: "使用済み",
  expired: "期限切れ",
  revoked: "取り消し済み",
};
