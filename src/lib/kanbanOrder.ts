// src/lib/kanbanOrder.ts
//
// カンバンビューの「表示順」（列＝todo→in_progress→done を左→右、各列内は配列順で上→下）を
// フラット化する純粋関数。Shift+クリック範囲選択（computeRangeSelection）とCtrl/Cmd+Aの
// 対象算出で共有する。hideDone=trueのときは done列のカードが折りたたまれ個別にクリック
// できなくなるため、done列全体を対象から除外する。

export function computeKanbanOrderedIds(
  tasks: { id: string; status: "todo" | "in_progress" | "done" }[],
  hideDone: boolean,
): string[] {
  const order: Array<"todo" | "in_progress" | "done"> = ["todo", "in_progress", "done"];
  const ids: string[] = [];
  for (const status of order) {
    if (status === "done" && hideDone) continue;
    for (const t of tasks) if (t.status === status) ids.push(t.id);
  }
  return ids;
}
