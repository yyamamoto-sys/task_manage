// src/lib/task/multiReorder.ts
//
// 【設計意図】選択中の複数タスクを、ドロップ位置へまとめて移す採番の純粋関数（v3.156）。
// 単体の computeSiblingReorderIds（src/lib/dragReorder.ts）を複数に拡張したもの。
// 規則（v3.196で任意の深さに対応）：
//  - 動かすのは「選択のうち、祖先に選択が居ないタスク」。選択の中に祖先と子孫が両方あれば祖先側だけが動き、
//    子孫は選択の有無を問わず連れて動く（何段でも）。PJが変わるなら子孫の project_id も揃える
//  - 動かすタスクは表示順のまま、ドロップ先と同じ兄弟グループ（同じ parent・project）へ全部入れる。子持ちも子にできる
//  - 自分自身・自分の子孫の下へは移せない（循環）。ドロップ先が動かすタスク自身なら何もしない
//  - ドロップ先が選択中の親の子孫（連れられる側）の場合も、自分の中へ移すことになるので拒否する

import type { Task } from "../localData/types";
import { ancestorsOf, buildChildrenMap, descendantsOf } from "../taskHierarchy";

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

const ERR_CYCLE = "自分自身や自分の子タスクの下には移せません（循環になります）";

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
  const parentOf = (t: Task) => (t.parent_task_id && byId.has(t.parent_task_id) ? t.parent_task_id : null);
  const newParentId: string | null = position.kind === "nest" ? target.id : parentOf(target);
  const newProjectId = target.project_id ?? null;

  if (selected.has(target.id)) return { ok: false, reason: null };

  // 実際に動かす集合（選択された祖先に連れられる子孫は除く）
  const childrenMap = buildChildrenMap(live);
  const moving: Task[] = [];
  for (const id of orderedSelectedIds) {
    const t = byId.get(id);
    if (!t) continue;
    if (ancestorsOf(t, byId).some(a => selected.has(a.id))) continue; // 祖先と一緒に動く
    moving.push(t);
  }

  // 新しい親が、動かすタスク自身かその子孫なら循環
  if (newParentId !== null) {
    const parentChain = new Set<string>([newParentId, ...ancestorsOf(byId.get(newParentId)!, byId).map(a => a.id)]);
    if (moving.some(t => parentChain.has(t.id))) return { ok: false, reason: ERR_CYCLE };
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

  // PJが変わるなら、動くタスクの子孫（何段でも）も同じPJへ（親子は同じPJ）。親の保存の後に回す
  for (const t of moving) {
    for (const c of descendantsOf(t.id, childrenMap)) {
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
