// src/lib/kanbanOrder.ts
//
// カンバンビューの「表示順」（列＝todo→in_progress→done（→showPaused時はon_hold→cancelled）を
// 左→右、各列内は配列順で上→下）をフラット化する純粋関数。Shift+クリック範囲選択
// （computeRangeSelection）とCtrl/Cmd+Aの対象算出で共有する。hideDone=trueのときは done列の
// カードが折りたたまれ個別にクリックできなくなるため、done列全体を対象から除外する。
// showPaused=falseのとき（既定）は on_hold/cancelled 列自体が非表示のため対象から除外する
// （2026-07-21 ステータス拡張・保留/中止トグル）。

type KanbanTaskStatus = "todo" | "in_progress" | "done" | "on_hold" | "cancelled";

export function computeKanbanOrderedIds(
  tasks: { id: string; status: KanbanTaskStatus }[],
  hideDone: boolean,
  showPaused: boolean = false,
): string[] {
  const order: KanbanTaskStatus[] = ["todo", "in_progress", "done"];
  if (showPaused) order.push("on_hold", "cancelled");
  const ids: string[] = [];
  for (const status of order) {
    if (status === "done" && hideDone) continue;
    for (const t of tasks) if (t.status === status) ids.push(t.id);
  }
  return ids;
}

/**
 * 列内の並びを期日順にする（v3.201）。期日なしは末尾、同日・どちらも期日なしは元の並びのまま
 * （Array.prototype.sort は安定ソート）。元の配列は変えない。
 */
export function sortByDueDateStable<T extends { due_date: string | null }>(tasks: readonly T[]): T[] {
  return [...tasks].sort((a, b) => {
    if (a.due_date === b.due_date) return 0;
    if (a.due_date === null) return 1;
    if (b.due_date === null) return -1;
    return a.due_date < b.due_date ? -1 : 1;
  });
}
