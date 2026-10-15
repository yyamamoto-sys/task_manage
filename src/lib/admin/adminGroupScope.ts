// src/lib/admin/adminGroupScope.ts
//
// 部署絞り込み（v3.60・サイドバーの「表示部署」に追従）。元は AdminView.tsx のローカル関数。
// 設定トップのカードの件数バッジ（useAdminScope）と AdminView の両方から使うため、v3.155 で切り出した。
//
// group_ids（複数部署アクセス・migration 20260722b）が入っていればそれで判定し、
// 未設定（バックフィル漏れ等）の古いデータは group_id（ホーム部署）にフォールバックする。
//
// 🔴 groupId が null/空文字（＝部署が未確定）のときは false を返す（絞り込み無し＝全部署を
// 見せる、にはしない。2026-06-26のNULL猶予条項の事故と同じ轍を踏まないため。
// CLAUDE.md Section 1.6参照）。
//
// 🔴 memberInGroup は招待受諾者（ホーム部署が招待用部署のみ）を構造的に取りこぼす。呼び出し箇所は
// src/components/__tests__/memberInGroupUsage.test.ts が一覧で固定している（CLAUDE.md Section 36）。

import type { Member, Project } from "../localData/types";

export function memberInGroup(m: Member, groupId: string | null): boolean {
  if (!groupId) return false;
  if (m.group_ids && m.group_ids.length > 0) return m.group_ids.includes(groupId);
  return m.group_id === groupId;
}

export function projectInGroup(p: Project, groupId: string | null): boolean {
  if (!groupId) return false;
  if (p.group_ids && p.group_ids.length > 0) return p.group_ids.includes(groupId);
  return p.group_id === groupId;
}
