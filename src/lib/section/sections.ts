// src/lib/section/sections.ts
//
// PJ内の「グループ」（project_sections）まわりの純粋関数。画面の文言は「グループ」だが、
// 社内では「グループ」が部署（groups 表）の意味でも使われるため、コード・DB は section で統一している。
//
// 規則（DB の enforce_task_section_integrity トリガーと同じ。画面はこの関数で即時に同じ結果を出す）：
//  - 1タスク＝1グループ（null＝未分類）
//  - 子タスクは親と同じグループ（親を移すと子も移る。子だけ別にはできない）
//  - PJ なし／別PJのグループ／削除済みのグループを指していたら未分類へ戻す

import type { Task, ProjectSection } from "../localData/types";

/** 未分類を表すグループ見出しのキー（グループ id と衝突しない固定文字列） */
export const UNSECTIONED_KEY = "__unsectioned__";

export const SECTION_NAME_MAX = 100;

/** そのPJの有効なグループ（sort_order → created_at の順） */
export function sectionsOfProject(sections: ProjectSection[], projectId: string | null | undefined): ProjectSection[] {
  if (!projectId) return [];
  return sections
    .filter(s => s.project_id === projectId && !s.is_deleted)
    .sort((a, b) =>
      (a.sort_order - b.sort_order)
      || (a.created_at ?? "").localeCompare(b.created_at ?? "")
      || a.id.localeCompare(b.id));
}

export function nextSectionSortOrder(sections: ProjectSection[], projectId: string): number {
  const mine = sections.filter(s => s.project_id === projectId && !s.is_deleted);
  return mine.length === 0 ? 0 : Math.max(...mine.map(s => s.sort_order)) + 1;
}

/** 名前の前後の空白を除き、長さ上限で切る（空なら null＝作らない） */
export function normalizeSectionName(raw: string): string | null {
  const t = raw.trim().slice(0, SECTION_NAME_MAX);
  return t === "" ? null : t;
}

export function buildNewSection(
  projectId: string,
  name: string,
  existing: ProjectSection[],
  updatedBy: string,
  id: string = crypto.randomUUID(),
): ProjectSection | null {
  const n = normalizeSectionName(name);
  if (!n) return null;
  return {
    id,
    project_id: projectId,
    name: n,
    sort_order: nextSectionSortOrder(existing, projectId),
    is_deleted: false,
    updated_by: updatedBy,
  };
}

/** 現在の並びに対して orderedIds の順へ付け直したとき、sort_order が変わるグループだけ返す（新しい sort_order 入り） */
export function computeSectionReorder(current: ProjectSection[], orderedIds: string[]): ProjectSection[] {
  const byId = new Map(current.map(s => [s.id, s]));
  const out: ProjectSection[] = [];
  let i = 0;
  for (const id of orderedIds) {
    const s = byId.get(id);
    if (!s) continue;
    if (s.sort_order !== i) out.push({ ...s, sort_order: i });
    i++;
  }
  return out;
}

/** 並べ替え（from の要素を to の位置へ）。範囲外・同位置なら元の配列 */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = list.slice();
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
}

/** タスクの現在のグループ id（未設定・null は null） */
export function sectionIdOf(task: Pick<Task, "section_id">): string | null {
  return task.section_id ?? null;
}

/**
 * 保存前にタスクのグループを DB の規則へ揃える。
 * - 親があれば親のグループ（親が未分類なら未分類）
 * - PJ なし・別PJのグループ・削除済み・存在しないグループは未分類（null）
 * 変更が無ければ**同じオブジェクトを返し、section_id のキーを足さない**（列がまだ無い DB でも
 * 既存の保存が落ちないように。列が無い間は section_id が常に undefined のまま）。
 */
export function normalizeTaskSection(
  task: Task,
  tasks: Task[],
  sections: ProjectSection[],
): Task {
  const cur = sectionIdOf(task);
  let want: string | null = cur;
  if (task.parent_task_id) {
    const parent = tasks.find(t => t.id === task.parent_task_id);
    if (parent) want = sectionIdOf(parent);
  }
  if (want) {
    const sec = sections.find(s => s.id === want && !s.is_deleted);
    if (!task.project_id || !sec || sec.project_id !== task.project_id) want = null;
  }
  return want === cur ? task : { ...task, section_id: want };
}

/** 親のグループが変わったとき、子タスクの state を同じグループへ揃える（DB は cascade トリガーが同じことをする） */
export function followParentSection(tasks: Task[], parentId: string, sectionId: string | null): Task[] {
  let changed = false;
  const next = tasks.map(t => {
    if (t.parent_task_id === parentId && !t.is_deleted && sectionIdOf(t) !== sectionId) {
      changed = true;
      return { ...t, section_id: sectionId };
    }
    return t;
  });
  return changed ? next : tasks;
}

/** グループ別の件数（完了・件数。PJカルテ用）。cancelled は母数から除く（PJの進み具合の既存の数え方に合わせる） */
export interface SectionProgress {
  key: string;
  name: string;
  total: number;
  done: number;
}

export function computeSectionProgress(
  projectTasks: Task[],
  sections: ProjectSection[],
  projectId: string,
  unsectionedLabel = "未分類",
): SectionProgress[] {
  const live = projectTasks.filter(t => !t.is_deleted && t.project_id === projectId && t.status !== "cancelled");
  const rows: SectionProgress[] = sectionsOfProject(sections, projectId).map(s => {
    const mine = live.filter(t => sectionIdOf(t) === s.id);
    return { key: s.id, name: s.name, total: mine.length, done: mine.filter(t => t.status === "done").length };
  });
  const un = live.filter(t => {
    const id = sectionIdOf(t);
    return !id || !rows.some(r => r.key === id);
  });
  if (un.length > 0) {
    rows.push({ key: UNSECTIONED_KEY, name: unsectionedLabel, total: un.length, done: un.filter(t => t.status === "done").length });
  }
  return rows;
}
