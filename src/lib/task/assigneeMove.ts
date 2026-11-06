// src/lib/task/assigneeMove.ts
//
// 「担当者の行・列から別の行・列へタスクを移す」ときの担当者の計算（v3.204・純粋関数）。
// カンバンの担当者軸とワークロードの週グリッドが同じ規則を使うために共有する。
// 規則：移動元の担当者だけを移動先に入れ替える（共同担当の他の人は残す）。
//  - 移動先が既に担当者なら、移動元を外すだけ
//  - 「未割り当て」から移す＝担当を追加／「未割り当て」へ移す＝移動元を外す

/** 「未割り当て」の行・列を表すキー（メンバー id と重ならない値） */
export const UNASSIGNED_KEY = "__unassigned__";

/**
 * 移動後の担当者 id 配列。変化がなければ null。
 * fromKey が担当者に含まれていない（表示外の担当者の列など）ときは「追加」として扱う。
 */
export function moveAssigneeIds(ids: readonly string[], fromKey: string, toKey: string): string[] | null {
  if (fromKey === toKey) return null;
  const fromIsMember = fromKey !== UNASSIGNED_KEY && ids.includes(fromKey);
  if (toKey === UNASSIGNED_KEY) {
    if (!fromIsMember) return null;
    return ids.filter(id => id !== fromKey);
  }
  if (ids.includes(toKey)) {
    return fromIsMember ? ids.filter(id => id !== fromKey) : null;
  }
  if (!fromIsMember) return [...ids, toKey];
  return ids.map(id => (id === fromKey ? toKey : id));
}

/** 担当者 id 配列を、保存用の2項目（先頭1人の主FK＋配列）にする */
export function assigneePatch(ids: readonly string[]): { assignee_member_ids: string[]; assignee_member_id: string } {
  return { assignee_member_ids: [...ids], assignee_member_id: ids[0] ?? "" };
}
