// src/lib/history/undoPermission.ts
//
// 【設計意図】
// 変更履歴のUndoボタンを誰に見せるかの判定（CLAUDE.md Section 57・山本さんの決定：
// 「管理者は全部・一般は自分の変更のみ」）。
//
// 🔴 これは事故防止であってセキュリティではない。タスク・PJの編集は部署内の全員に
// 許可されているため、他人の変更をUndoする代わりに直接同じ内容へ編集し直せば
// 全く同じ結果を作れる（entity_change_logsのRLS・DB制約もこれを妨げていない）。
// この判定はUIの誤操作防止（「誰かの変更を思わず戻してしまう」を減らす）が目的であり、
// サーバー側の強制（RLS等）はあえて設けていない。

import type { EntityChangeLog, Member } from "../localData/types";

export function canUndoEntityChangeLog(
  log: Pick<EntityChangeLog, "changed_by">,
  currentUser: Pick<Member, "id" | "is_admin" | "is_super_admin">,
): boolean {
  if (currentUser.is_admin || currentUser.is_super_admin) return true;
  return log.changed_by === currentUser.id;
}
