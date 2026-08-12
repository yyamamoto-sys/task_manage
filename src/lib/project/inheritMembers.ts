// src/lib/project/inheritMembers.ts
//
// 【設計意図】
// 「他PJから引き継ぐ」機能のメンバー引き継ぎ（山本さん確定仕様・2026-08-12）。
//
// CLAUDE.md Section 3-2 が指す「PJ ↔ Member 多対多」は、この実装では独立の
// project_members テーブルではなく `projects.member_ids`（配列列）で表現されている。
// よってここで一覧化する候補の実データは「元PJの member_ids」。
// `lib/project/projectMembers.ts` の `computeProjectMembers` は PJ設定画面の
// 「関わるメンバー」表示用に、オーナー・タスク担当者・招待で参加した人まで広げた
// 別目的の集約関数（読み取り専用の表示用）のため、ここでは流用しない。
// 流用すると「オーナーだから」「招待されているだけだから」という理由で本来
// member_ids に入っていない人まで引き継ぎ候補に混ざり、意図が変わってしまう。
//
// 候補には元PJの member_ids に加えて、元PJの全タスクの担当者も含める
// （担当者だが member_ids には入っていない、というケースを選択肢から漏らさないため）。
// 既定チェックは「チェック中タスクの担当者のみ」（山本さん確定仕様）。

import type { Member, Task } from "../localData/types";

/**
 * 元PJのメンバー候補（member_ids ∪ 全タスクの担当者）を、非削除メンバーに限定して返す。
 * 並び順は short_name（ja collation）。
 */
export function candidateInheritMembers(
  members: Member[],
  originMemberIds: string[] | undefined,
  originTasks: Task[],
): Member[] {
  const ids = new Set<string>(originMemberIds ?? []);
  for (const t of originTasks) {
    if (t.assignee_member_id) ids.add(t.assignee_member_id);
    for (const id of t.assignee_member_ids ?? []) ids.add(id);
  }
  const byId = new Map(members.filter(m => !m.is_deleted).map(m => [m.id, m]));
  return [...ids]
    .map(id => byId.get(id))
    .filter((m): m is Member => !!m)
    .sort((a, b) => a.short_name.localeCompare(b.short_name, "ja"));
}

/**
 * 既定でチェックONにするメンバーID集合を返す。
 * チェック中タスク（checkedTasks）の担当者のみを既定ONにする（PJの member_ids に
 * 入っているだけで誰のタスクも担当していない人は既定OFF＝利用者が選んで足す）。
 */
export function defaultCheckedMemberIds(checkedTasks: Task[]): Set<string> {
  const ids = new Set<string>();
  for (const t of checkedTasks) {
    if (t.assignee_member_id) ids.add(t.assignee_member_id);
    for (const id of t.assignee_member_ids ?? []) ids.add(id);
  }
  return ids;
}
