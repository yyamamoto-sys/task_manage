// src/lib/project/projectEditPermission.ts
//
// 【設計意図】
// PJの基本情報を編集できるか（＝status変更を含む）の判定条件を1箇所に集約する。
// 元々 ProjectSettingsModal.tsx にだけ実装されていた canEditBasicInfo
// （部署管理者(is_admin) or 全社スーパー管理者(is_super_admin)。ただし部署内にis_adminが
// 1人もいなければブートストラップとして全員編集可）をそのまま切り出しただけで、
// 新しい判定ロジックは発明していない。
//
// AdminView.tsx の管理画面アクセスガード（hasAnyAdmin && !canAccessAdmin なら拒否）も
// 論理的には同値の式（allowed = canAccessAdmin || !hasAnyAdmin）を別の書き方で持っている。
// 今回はサイドバーPJ行の「⋮」メニュー（CLAUDE.md Section 4・PJ設定画面と同じ権限条件で
// 状態変更ボタンを出す）でも同じ判定を使うため、ProjectSettingsModal.tsx側の式をここに
// 移し、両方から呼ぶ形にした。

import type { Member } from "../localData/types";
import { active } from "../localData/localStore";

/** PJの基本情報編集・状態変更（完了/アーカイブ/戻す）が可能かどうか。 */
export function canEditProjectBasicInfo(members: Member[], currentUser: Member): boolean {
  const activeAdmins = active(members).filter(m => m.is_admin === true);
  return currentUser.is_admin === true || currentUser.is_super_admin === true || activeAdmins.length === 0;
}
