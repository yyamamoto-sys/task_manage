// src/lib/dragReorder.ts
//
// 【設計意図】
// タスクのドラッグ＆ドロップ並べ替え（兄弟の入れ替え・親子付け替え）の純粋ロジック。
// 元は ListView.tsx 内にあった computeDropZone（DOM依存部分のみ残し、判定部分をここへ抽出）と
// handleTaskDrop の「同じ階層に挿入した場合の display_order 振り直し」計算を切り出したもの。
// ListView（既存・全ゾーン対応）と GanttView（今回追加・PJ別ビューのラベル列。nestは使わない）の
// 両方から src/hooks/useTaskDragReorder.ts 経由で共有する（重複実装を避ける）。
//
// DOM（getBoundingClientRect等）にもReactにも依存しない純粋関数のみを置く。

import type { Task } from "./localData/types";

/** ドラッグ中タスクをドロップ先の行のどこに落としたか。before/after=並び替え、nest=ドロップ先の子にする */
export type DropZone = "before" | "after" | "nest";

/**
 * 行の中でのドロップ位置（0=行の最上部〜1=行の最下部）から DropZone を判定する純粋関数。
 * allowNest=false のときは常に上下50%で before/after のみ（nestという概念自体を提供しない画面向け。
 * GanttViewのラベル列はこちら）。
 * allowNest=true のときは上30%=before・下30%=after・中央40%=nest（ListViewの「孫禁止」でnestを
 * 封じたい呼び出し側は、この関数を呼ぶ前に allowNest=false を渡すこと＝target.parent_task_id が
 * あるときの旧 computeDropZone の分岐と同じ）。
 */
export function computeDropZoneFromRatio(ratio: number, allowNest: boolean): DropZone {
  if (!allowNest) return ratio < 0.5 ? "before" : "after";
  return ratio < 0.3 ? "before" : ratio > 0.7 ? "after" : "nest";
}

/**
 * ドラッグ中タスク(draggedId)をドロップ先タスク(targetId)と同じ階層（同じ parent_task_id・
 * 同じ project_id）の before/after に挿入した場合の、新しい並び順（idの配列。0番目から順に
 * display_order = 配列内indexを割り当てる）を計算する純粋関数。
 *
 * - visibleTasks：呼び出し側の画面で「今見えている」兄弟候補（フィルタ・折りたたみ後の表示順）。
 *   この配列内の相対順序がそのまま新しい display_order の基準になる。
 * - allTasks のうち isSibling だが visibleTasks に含まれないもの（隠れた兄弟）は、
 *   display_order の昇順で並べ、可視分の末尾に維持したまま番号だけ振り直す
 *   （非表示のタスクを勝手に可視領域の位置へ移動させないため）。
 * - targetId が isSibling の中に見つからない場合（呼び出し側の不整合）は null を返す。
 *
 * zone は "before" | "after" のみを受け取る（nestは呼び出し側で別途 parent_task_id 変更として扱う）。
 */
export function computeSiblingReorderIds(
  allTasks: Task[],
  visibleTasks: Task[],
  draggedId: string,
  targetId: string,
  zone: "before" | "after",
): string[] | null {
  const target = allTasks.find(t => t.id === targetId);
  if (!target) return null;
  const newParentId = target.parent_task_id ?? null;
  const newProjectId = target.project_id ?? null;
  const isSibling = (t: Task) => (t.parent_task_id ?? null) === newParentId && (t.project_id ?? null) === newProjectId;
  const visible = visibleTasks.filter(isSibling);
  const visibleSet = new Set(visible.map(t => t.id));
  const hidden = allTasks
    .filter(t => isSibling(t) && !visibleSet.has(t.id))
    .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));
  const ids = [...visible, ...hidden].map(t => t.id).filter(id => id !== draggedId);
  const targetIdx = ids.indexOf(targetId);
  if (targetIdx < 0) return null;
  ids.splice(zone === "before" ? targetIdx : targetIdx + 1, 0, draggedId);
  return ids;
}
