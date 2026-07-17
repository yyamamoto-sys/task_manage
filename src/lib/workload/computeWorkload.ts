// src/lib/workload/computeWorkload.ts
//
// 【設計意図】
// メンバー別タスク負荷の集計ロジック（単一の真実源）。
// - AI相談ペイロード（payloadBuilder.buildMemberWorkload）
// - ワークロードビュー（画面表示・src/components/workload/WorkloadView.tsx）
// の両方から呼ばれる。AI向け MemberWorkload 型より情報がリッチな行型を返すため、
// AI側はここから必要なフィールドだけを抜き出してマップすること（AIペイロードの出力は不変に保つ）。
//
// 呼び出し側の責務：members/tasks は呼び出し前に部署スコープ済みであること
// （selectScopedMembers / selectScopedTasks 経由。素の s.members / s.tasks は渡さない）。

import type { Member, Task } from "../localData/types";
import { active } from "../localData/localStore";
import { getAssigneeIds } from "../taskMeta";
import { todayStr } from "../date";

export interface MemberWorkloadRow {
  member_id: string;
  short_name: string;
  todo_count: number;
  in_progress_count: number;
  /** todo_count + in_progress_count（done は除く）。負荷バーの基準値 */
  active_count: number;
  /** 工数入力済みタスクのみの合計（未入力を0扱いしない）。1件も入力が無ければ null */
  total_estimated_hours: number | null;
  tasks_with_estimate: number;
  tasks_without_estimate: number;
  /** アクティブ（todo/in_progress）タスクのうち期日が今日より過去のもの */
  overdue_count: number;
}

/**
 * メンバーごとのタスク負荷を集計する（純粋関数）。
 * done のタスクは集計対象外。1つのタスクに複数担当者がいる場合は各担当者の負荷に
 * 個別に積む（担当を分担しているわけではなく、全員がそのタスクを負っているとみなす）。
 */
export function computeMemberWorkloadRows(members: Member[], tasks: Task[]): MemberWorkloadRow[] {
  const today = todayStr();
  return active(members).map(m => {
    const myTasks = tasks.filter(t => !t.is_deleted && getAssigneeIds(t).includes(m.id));
    const activeTasks = myTasks.filter(t => t.status !== "done");
    const withEstimate = activeTasks.filter(t => t.estimated_hours != null);
    const withoutEstimate = activeTasks.filter(t => t.estimated_hours == null);
    const totalHours = withEstimate.length > 0
      ? withEstimate.reduce((sum, t) => sum + (t.estimated_hours ?? 0), 0)
      : null;
    const todoCount = activeTasks.filter(t => t.status === "todo").length;
    const inProgressCount = activeTasks.filter(t => t.status === "in_progress").length;
    // YYYY-MM-DD 文字列同士なので辞書順比較で日付順比較になる
    const overdueCount = activeTasks.filter(t => t.due_date != null && t.due_date < today).length;

    return {
      member_id: m.id,
      short_name: m.short_name,
      todo_count: todoCount,
      in_progress_count: inProgressCount,
      active_count: todoCount + inProgressCount,
      total_estimated_hours: totalHours,
      tasks_with_estimate: withEstimate.length,
      tasks_without_estimate: withoutEstimate.length,
      overdue_count: overdueCount,
    };
  });
}
