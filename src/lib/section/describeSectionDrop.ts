// src/lib/section/describeSectionDrop.ts
//
// グループ見出しをドラッグ中に、落とす先の見出しへ出す「挿入位置の線」と「札の文言」を決める純関数。
// 並べ替えの規則そのものは computeSectionDropOrder（下へは相手の後ろ・上へは相手の前・「未分類」へは先頭）が
// 唯一の正本で、ここは必ずそれを呼んで「順番が変わらない（null）」と「どちら側へ入るか」を揃える。
// リスト・ガントの見出しが同じ判定を共有する（判定式を各画面に複製しない）。

import type { ProjectSection } from "../localData/types";
import { UNSECTIONED_KEY, computeSectionDropOrder } from "./sections";

export interface SectionDropDescription {
  /** 線を引く側（落とす先の見出しの上端／下端） */
  side: "top" | "bottom";
  kind: "before" | "after" | "first";
  /** 札の文言（例：『第1回』の前に入ります／先頭に入ります） */
  label: string;
}

/**
 * @param list      そのPJの有効なグループ（sort_order 順。「未分類」は含まない）
 * @param draggingId つかんでいるグループの id
 * @param targetKey  落とす先（グループの id、または UNSECTIONED_KEY）
 * @returns 落とせない・順番が変わらない位置は null（線も札も出さない）
 */
export function describeSectionDrop(
  list: ProjectSection[],
  draggingId: string,
  targetKey: string,
): SectionDropDescription | null {
  if (!computeSectionDropOrder(list, draggingId, targetKey)) return null;
  if (targetKey === UNSECTIONED_KEY) {
    return { side: "top", kind: "first", label: "先頭に入ります" };
  }
  const from = list.findIndex(s => s.id === draggingId);
  const to = list.findIndex(s => s.id === targetKey);
  const name = list[to].name;
  return from < to
    ? { side: "bottom", kind: "after", label: `『${name}』の後に入ります` }
    : { side: "top", kind: "before", label: `『${name}』の前に入ります` };
}
