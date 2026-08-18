// src/lib/dependencies/topoSort.ts
//
// 【設計意図・v3.77】
// applyProposalWithConfirmation（date_change）で複数タスクの期日を一括反映する際、
// dialog.items が AI の返した順のまま（＝依存関係のトポロジカル順になっていない）だと、
// 確認画面で利用者が確定した日付が、後から反映される先行タスクのB3自動リスケ連鎖に
// よって黙って上書きされてしまうことがあった。
//
// 例：後続タスクB→先行タスクAの順でdialog.itemsを反映すると、①Bの確定値を書き込み
// （まだAの新日付を知らないので何も連鎖しない）→②Aの確定値を書き込み、するとAの新しい
// 期日を起点にB3の自動リスケ連鎖が発火し、Bが「ぶつからない位置」まで自動で押し出されて
// しまい、①で書いたはずのBの確定値が上書きされる。
//
// 反映前に「先行タスクを先に」並べ替えれば、各タスク自身の確定値の書き込みが必ずそのタスク
// への最後の書き込みになる（後から処理される後続タスク自身の確定値の書き込みが、先行タスクの
// カスケードより後に来るため）。
//
// 循環データが混入していた場合（既存の canAddDependency/cycleCheck.ts が依存追加時に
// 必ず弾くため通常は発生しない）は、reschedule.ts の computeCascadeShiftsMulti と同じ
// 安全側の割り切りで、並べ替えを諦めて渡された順のまま返す（クラッシュ・無限ループを
// 起こさない）。

import type { TaskDependency } from "../localData/types";

type DependencyEdge = Pick<TaskDependency, "predecessor_task_id" | "successor_task_id" | "is_deleted">;

/**
 * 与えられた taskIds 集合を、依存関係（先行→後続）のトポロジカル順に並べ替える。
 * 集合外のタスクを介した間接的な依存は考慮しない（集合内の2者間の順序だけが対象）。
 * 循環が見つかった場合は安全側に倒し、元の順序のまま返す。
 */
export function sortTaskIdsByDependencyOrder(
  taskIds: string[],
  deps: DependencyEdge[],
): string[] {
  const idSet = new Set(taskIds);
  const successorsOf = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const id of taskIds) inDegree.set(id, 0);

  for (const d of deps) {
    if (d.is_deleted) continue;
    if (!idSet.has(d.predecessor_task_id) || !idSet.has(d.successor_task_id)) continue;
    successorsOf.set(
      d.predecessor_task_id,
      [...(successorsOf.get(d.predecessor_task_id) ?? []), d.successor_task_id],
    );
    inDegree.set(d.successor_task_id, (inDegree.get(d.successor_task_id) ?? 0) + 1);
  }

  // 入力順に見て inDegree=0（先行の無い、またはこの集合内では先行が既に無いもの）から
  // キューに積む＝もともとの並びをできるだけ保った安定ソートに近い挙動にする。
  const queue: string[] = [];
  for (const id of taskIds) if ((inDegree.get(id) ?? 0) === 0) queue.push(id);

  const order: string[] = [];
  const remainingInDegree = new Map(inDegree);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    order.push(cur);
    for (const succ of successorsOf.get(cur) ?? []) {
      const next = (remainingInDegree.get(succ) ?? 0) - 1;
      remainingInDegree.set(succ, next);
      if (next === 0) queue.push(succ);
    }
  }

  // 循環が紛れ込んでいた場合の防御。全ノードを網羅できないなら、安全側に倒し
  // 並べ替えを諦めて元の順序のまま返す（reschedule.tsのcomputeCascadeShiftsMultiと同じ方針）。
  if (order.length < taskIds.length) return taskIds;

  return order;
}
