// src/lib/task/multiReorder.ts
//
// 【設計意図】選択中の複数タスクを、ドロップ位置へまとめて移す採番の純粋関数（v3.156）。
// 単体の computeSiblingReorderIds（src/lib/dragReorder.ts）を複数に拡張したもの。
// 規則：
//  - 移すタスクは表示順のまま、ドロップ先と同じ兄弟グループ（同じ parent・project）へ全部入れる
//  - 親（最上位）を選んでいれば子は連れて動く（選択の有無を問わず親の下に残る）。PJが変わるなら子の project_id も揃える
//  - 親だけが選ばれていない子（子だけ選択）は、親から外さない：最上位への移動・別の親への移動は拒否する
//    （同じ親の子の間での並べ替えだけ許す）
//  - 子として並べる（ドロップ先が子／nest）なら、移すタスクは子を持たず、最上位か同じ親の子であること
//  - ドロップ先が選択中・選択中の親の子の場合は何もしない

import type { Task } from "../localData/types";

export type MultiDropPosition =
  | { kind: "before" | "after"; targetId: string }
  | { kind: "nest"; parentId: string };

export interface MultiReorderPatch {
  id: string;
  patch: Partial<Pick<Task, "parent_task_id" | "project_id" | "section_id" | "display_order">>;
  /** Undo で戻す値（patch に含まれるキーだけ） */
  prev: Partial<Pick<Task, "parent_task_id" | "project_id" | "section_id" | "display_order">>;
}

export type MultiReorderResult =
  | { ok: true; patches: MultiReorderPatch[]; movedCount: number }
  | { ok: false; reason: string }
  | { ok: false; reason: null };

const ERR_PARENT_AS_CHILD = "子タスクを持つタスクは子にできません（先に子タスクを別の親に移動するか、解除してください）";
const ERR_CHILD_LEAVES = "子タスクだけを選んで別の親・最上位へまとめて移すことはできません。親タスクごと選ぶか、1件ずつドラッグしてください";
const ERR_CHILD_OTHER_PARENT = "別の親タスクの子はまとめて子にできません。1件ずつドラッグしてください";

/**
 * @param allTasks 全タスク
 * @param visibleTasks 画面に見えているタスク（表示順。隠れた兄弟の扱いは computeSiblingReorderIds と同じ）
 * @param orderedSelectedIds 選択中のタスク（表示順）
 */
export function computeMultiReorder(
  allTasks: Task[],
  visibleTasks: Task[],
  orderedSelectedIds: string[],
  position: MultiDropPosition,
): MultiReorderResult {
  const live = allTasks.filter(t => !t.is_deleted);
  const byId = new Map(live.map(t => [t.id, t]));
  const selected = new Set(orderedSelectedIds.filter(id => byId.has(id)));
  if (selected.size === 0) return { ok: false, reason: null };

  const target = position.kind === "nest" ? byId.get(position.parentId) : byId.get(position.targetId);
  if (!target) return { ok: false, reason: null };

  // 新しい親・PJ
  const newParentId: string | null = position.kind === "nest" ? target.id : (target.parent_task_id ?? null);
  const newProjectId = target.project_id ?? null;

  if (position.kind !== "nest" && selected.has(target.id)) return { ok: false, reason: null };
  if (position.kind === "nest") {
    if (selected.has(target.id)) return { ok: false, reason: null };
    if (target.parent_task_id) return { ok: false, reason: ERR_PARENT_AS_CHILD };
  }

  const hasChildren = (id: string) => live.some(t => t.parent_task_id === id);
  const parentOf = (t: Task) => (t.parent_task_id && byId.has(t.parent_task_id) ? t.parent_task_id : null);

  // 実際に動かす集合（選択された親に連れられる子は除く）
  const moving: Task[] = [];
  for (const id of orderedSelectedIds) {
    const t = byId.get(id);
    if (!t) continue;
    const p = parentOf(t);
    if (p && selected.has(p)) continue; // 親と一緒に動く
    moving.push(t);
  }

  for (const t of moving) {
    const p = parentOf(t);
    if (newParentId === null) {
      if (p) return { ok: false, reason: ERR_CHILD_LEAVES };
    } else {
      if (hasChildren(t.id)) return { ok: false, reason: ERR_PARENT_AS_CHILD };
      if (t.id === newParentId) return { ok: false, reason: null };
      if (p && p !== newParentId) return { ok: false, reason: ERR_CHILD_OTHER_PARENT };
    }
  }
  // ドロップ先が選択中の親の子（連れられる子）なら、実質自分の中へ移すことになる
  if (position.kind !== "nest" && target.parent_task_id && selected.has(target.parent_task_id)) {
    return { ok: false, reason: null };
  }

  const movingIds = new Set(moving.map(t => t.id));
  const isSibling = (t: Task) => (parentOf(t)) === newParentId && (t.project_id ?? null) === newProjectId;
  const visible = visibleTasks.filter(t => !t.is_deleted && isSibling(t));
  const visibleSet = new Set(visible.map(t => t.id));
  const hidden = live
    .filter(t => isSibling(t) && !visibleSet.has(t.id))
    .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));
  const base = [...visible, ...hidden].map(t => t.id).filter(id => !movingIds.has(id));

  let insertAt: number;
  if (position.kind === "nest") {
    insertAt = base.length;
  } else {
    const idx = base.indexOf(target.id);
    if (idx < 0) return { ok: false, reason: null };
    insertAt = position.kind === "before" ? idx : idx + 1;
  }
  const ids = base.slice();
  ids.splice(insertAt, 0, ...moving.map(t => t.id));

  const targetSection = target.section_id ?? null;
  const patches: MultiReorderPatch[] = [];
  const planned = new Set<string>();

  ids.forEach((id, idx) => {
    const t = byId.get(id);
    if (!t) return;
    const patch: MultiReorderPatch["patch"] = {};
    const prev: MultiReorderPatch["prev"] = {};
    if ((t.display_order ?? 0) !== idx) { patch.display_order = idx; prev.display_order = t.display_order ?? 0; }
    if (movingIds.has(id)) {
      if (parentOf(t) !== newParentId) { patch.parent_task_id = newParentId; prev.parent_task_id = t.parent_task_id ?? null; }
      if ((t.project_id ?? null) !== newProjectId) { patch.project_id = newProjectId; prev.project_id = t.project_id ?? null; }
      if (newParentId === null && (t.section_id ?? null) !== targetSection) {
        patch.section_id = targetSection; prev.section_id = t.section_id ?? null;
      }
    }
    if (Object.keys(patch).length > 0) { patches.push({ id, patch, prev }); planned.add(id); }
  });

  // PJが変わるなら、動く親の子も同じPJへ（親子は同じPJ）。親の保存の後に回す
  for (const t of moving) {
    for (const c of live.filter(x => x.parent_task_id === t.id)) {
      if (planned.has(c.id) || (c.project_id ?? null) === newProjectId) continue;
      patches.push({
        id: c.id,
        patch: { project_id: newProjectId, section_id: null },
        prev: { project_id: c.project_id ?? null, section_id: c.section_id ?? null },
      });
      planned.add(c.id);
    }
  }

  return { ok: true, patches, movedCount: moving.length };
}
