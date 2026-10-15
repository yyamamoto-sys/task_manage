// src/hooks/useAdminScope.ts
//
// 【設計意図・v3.155】
// 設定画面の「編集対象の部署」の判定（AdminView のルートにあった計算を切り出し）と、
// トップのカードに出す件数バッジ。AdminView（詳細ページの中身）と SettingsView（トップのカード・
// 詳細ヘッダーの「編集対象：◯◯」）が同じ判定を使うため、1か所にまとめた。
//
// 部署の決め方は v3.60 から変わらない：サイドバーの「表示部署」（appStore.currentGroupId）に従い、
// 確定できないときは「全部署を見せる」側には倒さず null を返す（resolveAdminGroupId・Section 1.6）。

import { useMemo } from "react";
import { useAppStore } from "../stores/appStore";
import type { Member } from "../lib/localData/types";
import { active } from "../lib/localData/localStore";
import { filterInviteGroupsForSidebar } from "../lib/projectInvite/sidebarGroupVisibility";
import { resolveAdminGroupId } from "../lib/admin/resolveAdminGroupId";
import { memberInGroup, projectInGroup } from "../lib/admin/adminGroupScope";
import { keyResultsInGroup, taskForcesInGroup } from "../lib/okr/deptScope";
import type { SettingsCountKey } from "../lib/settings/settingsPages";

export function useAdminScope(currentUser: Member) {
  const rawGroups = useAppStore(s => s.groups);
  const currentGroupId = useAppStore(s => s.currentGroupId);
  const isSuperAdmin = currentUser.is_super_admin === true;
  const groupsActive = useMemo(() => rawGroups.filter(g => !g.is_deleted), [rawGroups]);
  // filterInviteGroupsForSidebar：サイドバーの表示部署切替と選べる範囲を一致させる（Section 25）
  const accessibleGroups = useMemo(() => {
    const base = isSuperAdmin ? groupsActive
      : groupsActive.filter(g => {
          const ids = currentUser.group_ids?.length ? currentUser.group_ids
            : (currentUser.group_id ? [currentUser.group_id] : []);
          return ids.includes(g.id);
        });
    return filterInviteGroupsForSidebar(base);
  }, [groupsActive, isSuperAdmin, currentUser.group_ids, currentUser.group_id]);
  // 🔴 selectedGroupId は「string | null」。空文字にはしない（絞り込み無し＝全部署表示にしない）
  const selectedGroupId = useMemo(
    () => resolveAdminGroupId(currentGroupId, accessibleGroups.map(g => g.id)),
    [currentGroupId, accessibleGroups],
  );
  const selectedGroupName = accessibleGroups.find(g => g.id === selectedGroupId)?.name ?? selectedGroupId ?? "";
  return { selectedGroupId, accessibleGroups, showDeptLabel: accessibleGroups.length >= 2, selectedGroupName };
}

/** トップのカードの件数バッジ。実際に各ページが表示する一覧と同じ絞り込みで数える */
export function useAdminCounts(selectedGroupId: string | null): Record<SettingsCountKey, number> {
  const krs = useAppStore(s => s.keyResults);
  const rawProjects = useAppStore(s => s.projects);
  const rawTfs = useAppStore(s => s.taskForces);
  const rawObjectives = useAppStore(s => s.objectives);
  const rawGroups = useAppStore(s => s.groups);
  const rawTags = useAppStore(s => s.memberTags);
  const allMembers = useAppStore(s => s.members);
  return useMemo(() => ({
    okr: keyResultsInGroup(active(krs), rawObjectives, selectedGroupId).length,
    tf: taskForcesInGroup(active(rawTfs), active(krs), rawObjectives, selectedGroupId).length,
    pj: active(rawProjects).filter(p => projectInGroup(p, selectedGroupId)).length,
    // MembersSection の scopedMembers.length と一致させる（招待受諾者は別枠カードで数える設計のため含めない）
    members: active(allMembers).filter(m => memberInGroup(m, selectedGroupId)).length,
    // タグ本体は部署概念を持たない全社共通マスタ
    tags: active(rawTags).length,
    groups: rawGroups.filter(g => !g.is_deleted).length,
  }), [krs, rawObjectives, rawTfs, rawProjects, allMembers, rawTags, rawGroups, selectedGroupId]);
}
