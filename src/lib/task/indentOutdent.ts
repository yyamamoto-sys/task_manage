// src/lib/task/indentOutdent.ts
//
// 【設計意図】リストの Tab（1段下げる）／Shift+Tab（1段上げる）の採番・親付け替えを決める純粋関数（v3.196）。
//  - 動かすのは「対象のうち、祖先に対象が居ないタスク」（祖先と子孫が両方あれば祖先側だけ。子孫は連れて動く）
//  - Tab：表示順で直前にある「同じ親の兄弟」（対象に含まれないもの）の最後の子にする。兄弟が居なければ動かさない
//    最上位どうしは同じPJ・同じグループの兄弟だけを対象にする（別グループの兄弟の下へ入るとグループが変わるため）
//  - Shift+Tab：親の次の兄弟（親の直後）にする。最上位のタスクは動かさない
//  - 戻り値の patches は multiReorder と同じ形（Undo 用の prev 付き）。保存と Undo トーストは呼び出し側（useTaskDragReorder）

import type { Task } from "../localData/types";
import { ancestorsOf, sortTasksByOrder } from "../taskHierarchy";
import type { MultiReorderPatch } from "./multiReorder";

export interface IndentOutdentResult {
  patches: MultiReorderPatch[];
  /** 実際に動いたタスクの数 */
  movedCount: number;
  /** 動かせなかった対象の数（兄弟が居ない・最上位 など） */
  skippedCount: number;
  /** 新しい親（Tab で子が増えた親）。折りたたまれていたら開くために返す */
  newParentIds: string[];
}

const EMPTY: IndentOutdentResult = { patches: [], movedCount: 0, skippedCount: 0, newParentIds: [] };

function rootsOf(
  live: Task[],
  orderedVisibleIds: string[],
  targetIds: Iterable<string>,
): { moving: Task[]; byId: Map<string, Task> } {
  const byId = new Map(live.map(t => [t.id, t]));
  const targets = new Set(targetIds);
  const rank = new Map(orderedVisibleIds.map((id, i) => [id, i]));
  const picked = live.filter(t => targets.has(t.id) && rank.has(t.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  const moving = picked.filter(t => !ancestorsOf(t, byId).some(a => targets.has(a.id)));
  return { moving, byId };
}

export function computeIndent(
  allTasks: Task[],
  orderedVisibleIds: string[],
  targetIds: Iterable<string>,
): IndentOutdentResult {
  const live = allTasks.filter(t => !t.is_deleted);
  const { moving, byId } = rootsOf(live, orderedVisibleIds, targetIds);
  if (moving.length === 0) return EMPTY;
  const movingIds = new Set(moving.map(t => t.id));
  const parentOf = (t: Task) => (t.parent_task_id && byId.has(t.parent_task_id) ? t.parent_task_id : null);
  const rank = new Map(orderedVisibleIds.map((id, i) => [id, i]));

  const nextOrder = new Map<string, number>();
  const orderFor = (parentId: string) => {
    let n = nextOrder.get(parentId);
    if (n === undefined) {
      n = live.filter(t => parentOf(t) === parentId).reduce((m, t) => Math.max(m, (t.display_order ?? 0) + 1), 0);
    }
    nextOrder.set(parentId, n + 1);
    return n;
  };

  const patches: MultiReorderPatch[] = [];
  const newParentIds = new Set<string>();
  let skipped = 0;
  for (const t of moving) {
    const myParent = parentOf(t);
    let newParent: Task | undefined;
    for (let i = (rank.get(t.id) ?? 0) - 1; i >= 0; i--) {
      const r = byId.get(orderedVisibleIds[i]);
      if (!r) continue;
      if (r.id === myParent) break; // 親まで戻った＝これより上に兄弟は居ない
      if (parentOf(r) !== myParent || movingIds.has(r.id)) continue;
      if (myParent === null && ((r.project_id ?? null) !== (t.project_id ?? null) || (r.section_id ?? null) !== (t.section_id ?? null))) break;
      newParent = r;
      break;
    }
    if (!newParent) { skipped++; continue; }
    const patch: MultiReorderPatch["patch"] = { parent_task_id: newParent.id, display_order: orderFor(newParent.id) };
    const prev: MultiReorderPatch["prev"] = { parent_task_id: t.parent_task_id ?? null, display_order: t.display_order ?? 0 };
    if ((t.section_id ?? null) !== (newParent.section_id ?? null)) {
      patch.section_id = newParent.section_id ?? null; prev.section_id = t.section_id ?? null;
    }
    patches.push({ id: t.id, patch, prev });
    newParentIds.add(newParent.id);
  }
  return { patches, movedCount: patches.length, skippedCount: skipped, newParentIds: [...newParentIds] };
}

export function computeOutdent(
  allTasks: Task[],
  orderedVisibleIds: string[],
  targetIds: Iterable<string>,
): IndentOutdentResult {
  const live = allTasks.filter(t => !t.is_deleted);
  const { moving, byId } = rootsOf(live, orderedVisibleIds, targetIds);
  if (moving.length === 0) return EMPTY;
  const parentOf = (t: Task) => (t.parent_task_id && byId.has(t.parent_task_id) ? t.parent_task_id : null);

  // 新しい親（祖父）ごとの兄弟の並び（親の兄弟）。ここへ動かすタスクを「親の直後」に差し込む
  const lists = new Map<string, string[]>();
  const keyOf = (grandId: string | null, projectId: string | null) => `${grandId ?? ""}|${projectId ?? ""}`;
  const listFor = (grandId: string | null, projectId: string | null) => {
    const k = keyOf(grandId, projectId);
    let l = lists.get(k);
    if (!l) {
      l = live
        .filter(x => parentOf(x) === grandId && (x.project_id ?? null) === projectId)
        .sort(sortTasksByOrder)
        .map(x => x.id);
      lists.set(k, l);
    }
    return l;
  };
  const lastAfter = new Map<string, string>();
  const movedNewParent = new Map<string, string | null>();
  let skipped = 0;
  for (const t of moving) {
    const pid = parentOf(t);
    const p = pid ? byId.get(pid) : undefined;
    if (!p) { skipped++; continue; }
    const grandId = parentOf(p);
    const list = listFor(grandId, p.project_id ?? null);
    const anchor = lastAfter.get(p.id) ?? p.id;
    const idx = list.indexOf(anchor);
    if (idx < 0) { skipped++; continue; }
    list.splice(idx + 1, 0, t.id);
    lastAfter.set(p.id, t.id);
    movedNewParent.set(t.id, grandId);
  }

  const patches: MultiReorderPatch[] = [];
  const planned = new Set<string>();
  for (const list of lists.values()) {
    list.forEach((id, idx) => {
      const t = byId.get(id);
      if (!t || planned.has(id)) return;
      const patch: MultiReorderPatch["patch"] = {};
      const prev: MultiReorderPatch["prev"] = {};
      if ((t.display_order ?? 0) !== idx) { patch.display_order = idx; prev.display_order = t.display_order ?? 0; }
      if (movedNewParent.has(id)) { patch.parent_task_id = movedNewParent.get(id)!; prev.parent_task_id = t.parent_task_id ?? null; }
      if (Object.keys(patch).length > 0) { patches.push({ id, patch, prev }); planned.add(id); }
    });
  }
  return { patches, movedCount: movedNewParent.size, skippedCount: skipped, newParentIds: [] };
}
