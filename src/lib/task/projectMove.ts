// src/lib/task/projectMove.ts
//
// 【設計意図】選んだタスクをまとめて別のプロジェクトへ移すときの「誰が・どう動くか」を決める純粋関数（v3.156）。
// 親子の整合（子は親と同じPJ）を壊さないための規則：
//  - 親（最上位）を選んだら、その子は選んでいなくても親に連れて移す
//  - 子だけを選び、親を選んでいない場合：子は親から外れて、移動先PJの最上位タスクになる
//    （子だけ別PJに居る状態を作らない。親の側は動かさない）。確認ダイアログで件数を見せる
//  - 移すと section_id は null（移動先PJのグループは別物のため未分類へ）。task_projects（追加PJ）は触らない
//  - すでに移動先PJに居るタスクは対象外（件数にも含めない）

import type { Task } from "../localData/types";

export interface ProjectMovePatch {
  id: string;
  /** 適用する値（保存時は {...最新のタスク, ...patch}） */
  patch: Pick<Task, "project_id" | "section_id"> & Partial<Pick<Task, "parent_task_id" | "display_order">>;
  /** Undo で戻す値（変更前） */
  prev: Pick<Task, "project_id"> & { section_id: string | null; parent_task_id: string | null; display_order: number };
  kind: "top" | "carriedChild" | "selectedChild" | "detached";
}

export interface ProjectMovePlan {
  moves: ProjectMovePatch[];
  /** 動くタスクの総数（確認ダイアログの N） */
  total: number;
  /** うち子タスク（親と一緒に動くもの）の数（確認ダイアログの M） */
  childCount: number;
  /** うち親から外れて最上位になるタスクの数 */
  detachedCount: number;
}

/**
 * @param allTasks 全タスク
 * @param selectedIds 選択中のid
 * @param targetProjectId 移動先PJ
 * @param orderedIds 表示順（移動先の末尾へ並べる順。無ければ display_order 順）
 */
export function planProjectMove(
  allTasks: Task[],
  selectedIds: Set<string>,
  targetProjectId: string,
  orderedIds: string[] = [],
): ProjectMovePlan {
  const live = allTasks.filter(t => !t.is_deleted);
  const byId = new Map(live.map(t => [t.id, t]));
  const rank = new Map(orderedIds.map((id, i) => [id, i]));
  const selected = live.filter(t => selectedIds.has(t.id)).sort((a, b) =>
    (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9)
    || (a.display_order ?? 0) - (b.display_order ?? 0));

  const isTop = (t: Task) => !t.parent_task_id || !byId.has(t.parent_task_id);
  let nextOrder = live
    .filter(t => isTop(t) && t.project_id === targetProjectId)
    .reduce((m, t) => Math.max(m, t.display_order ?? 0), -1) + 1;

  const moves: ProjectMovePatch[] = [];
  const planned = new Set<string>();
  const prevOf = (t: Task) => ({
    project_id: t.project_id,
    section_id: t.section_id ?? null,
    parent_task_id: t.parent_task_id ?? null,
    display_order: t.display_order ?? 0,
  });

  // 親（最上位）：選択された親と、その子（選択の有無を問わず）
  for (const t of selected) {
    if (!isTop(t) || t.parent_task_id) continue;
    if (t.project_id !== targetProjectId) {
      moves.push({
        id: t.id, kind: "top", prev: prevOf(t),
        patch: { project_id: targetProjectId, section_id: null, display_order: nextOrder++ },
      });
      planned.add(t.id);
    }
    for (const c of live.filter(x => x.parent_task_id === t.id)) {
      if (c.project_id === targetProjectId || planned.has(c.id)) continue;
      moves.push({
        id: c.id, kind: selectedIds.has(c.id) ? "selectedChild" : "carriedChild", prev: prevOf(c),
        patch: { project_id: targetProjectId, section_id: null },
      });
      planned.add(c.id);
    }
  }
  // 子だけ選ばれている（親は選ばれていない）／親が見当たらない子：親から外して最上位にする
  for (const t of selected) {
    if (planned.has(t.id)) continue;
    const parent = t.parent_task_id ? byId.get(t.parent_task_id) : undefined;
    if (!parent && t.parent_task_id == null) continue; // 親タスクはここまでに処理済み
    if (parent && selectedIds.has(parent.id)) continue; // 親ごと処理済み
    if (t.project_id === targetProjectId) continue;
    moves.push({
      id: t.id, kind: "detached", prev: prevOf(t),
      patch: { project_id: targetProjectId, section_id: null, parent_task_id: null, display_order: nextOrder++ },
    });
    planned.add(t.id);
  }

  const detachedCount = moves.filter(m => m.kind === "detached").length;
  const childCount = moves.filter(m => m.kind === "carriedChild" || m.kind === "selectedChild").length;
  return { moves, total: moves.length, childCount, detachedCount };
}

/** 確認ダイアログの本文 */
export function projectMoveConfirmMessage(plan: ProjectMovePlan, projectName: string): string {
  const parts = plan.childCount > 0 ? `（子タスク${plan.childCount}件を含む）` : "";
  const base = `${plan.total}件${parts}を「${projectName}」へ移します。\nグループは「未分類」になります。`;
  return plan.detachedCount > 0
    ? `${base}\n親タスクが選ばれていない子タスク${plan.detachedCount}件は、親から外れて最上位のタスクになります。`
    : base;
}
