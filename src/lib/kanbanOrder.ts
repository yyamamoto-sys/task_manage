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
