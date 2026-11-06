// src/lib/kanbanAxis.ts
//
// カンバンの「列の軸」（状態／担当者／優先度／グループ。v3.204）の列の算出とドロップ時の更新内容（純粋関数）。
// 状態軸の列・ドラッグは従来の実装（KanbanView 本体）のまま。ここは状態以外の3軸を受け持つ。

import type { ProjectSection, Task } from "./localData/types";
import { getAssigneeIds } from "./taskMeta";
import { UNASSIGNED_KEY, assigneePatch, moveAssigneeIds } from "./task/assigneeMove";

export type KanbanAxis = "status" | "assignee" | "priority" | "group";

export const KANBAN_AXIS_LABEL: Record<KanbanAxis, string> = {
  status: "状態", assignee: "担当者", priority: "優先度", group: "グループ",
};
export const KANBAN_AXES: readonly KanbanAxis[] = ["status", "assignee", "priority", "group"];

export function parseStoredKanbanAxis(raw: string | null): KanbanAxis {
  return KANBAN_AXES.includes(raw as KanbanAxis) ? (raw as KanbanAxis) : "status";
}

export const OTHER_ASSIGNEE_KEY = "__other_assignee__";
export const NO_GROUP_KEY = "__no_group__";
export const NO_PRIORITY_KEY = "__no_priority__";
const PRIORITY_KEYS = ["high", "mid", "low"] as const;
const PRIORITY_LABEL: Record<string, string> = { high: "高", mid: "中", low: "低", [NO_PRIORITY_KEY]: "未設定" };

export interface AxisColumn {
  key: string;
  label: string;
}
export interface AxisColumnWithTasks extends AxisColumn {
  tasks: Task[];
}
export interface AxisContext {
  /** 担当者列にするメンバー（表示中のメンバー） */
  members: readonly { id: string; display_name: string }[];
  sections: readonly ProjectSection[];
  projects: readonly { id: string; name: string }[];
  selectedProjectId: string | null;
}

/** 存在するグループ id → 所属するグループ（未知の id は null＝グループなし扱い） */
function knownSection(task: Task, ctx: AxisContext): ProjectSection | null {
  if (!task.section_id) return null;
  return ctx.sections.find(s => s.id === task.section_id && !s.is_deleted) ?? null;
}

/** タスクが載る列キー（担当者軸のみ複数になりうる） */
export function taskColumnKeys(axis: Exclude<KanbanAxis, "status">, task: Task, ctx: AxisContext): string[] {
  if (axis === "priority") return [task.priority ?? NO_PRIORITY_KEY];
  if (axis === "group") return [knownSection(task, ctx)?.id ?? NO_GROUP_KEY];
  const ids = getAssigneeIds(task);
  if (ids.length === 0) return [UNASSIGNED_KEY];
  const memberIds = new Set(ctx.members.map(m => m.id));
  const visible = ids.filter(id => memberIds.has(id));
  return visible.length > 0 ? visible : [OTHER_ASSIGNEE_KEY];
}

/** 状態以外の軸の列と、各列に載るタスク（渡された順を保つ） */
export function buildAxisColumns(axis: Exclude<KanbanAxis, "status">, tasks: readonly Task[], ctx: AxisContext): AxisColumnWithTasks[] {
  const byKey = new Map<string, Task[]>();
  for (const t of tasks) {
    for (const k of taskColumnKeys(axis, t, ctx)) {
      const list = byKey.get(k);
      if (list) list.push(t); else byKey.set(k, [t]);
    }
  }
  const take = (key: string): Task[] => byKey.get(key) ?? [];

  if (axis === "priority") {
    const cols: AxisColumnWithTasks[] = PRIORITY_KEYS.map(k => ({ key: k, label: PRIORITY_LABEL[k], tasks: take(k) }));
    if (byKey.has(NO_PRIORITY_KEY)) cols.push({ key: NO_PRIORITY_KEY, label: PRIORITY_LABEL[NO_PRIORITY_KEY], tasks: take(NO_PRIORITY_KEY) });
    return cols;
  }

  if (axis === "assignee") {
    const cols: AxisColumnWithTasks[] = ctx.members.map(m => ({ key: m.id, label: m.display_name, tasks: take(m.id) }));
    cols.push({ key: UNASSIGNED_KEY, label: "未割り当て", tasks: take(UNASSIGNED_KEY) });
    if (byKey.has(OTHER_ASSIGNEE_KEY)) cols.push({ key: OTHER_ASSIGNEE_KEY, label: "表示外の担当者", tasks: take(OTHER_ASSIGNEE_KEY) });
    return cols;
  }

  // group：表示中のタスクが属するグループ（PJを選んでいるときはそのPJの全グループ＝空のグループへも移せるように）
  const wanted = new Set<string>();
  for (const k of byKey.keys()) if (k !== NO_GROUP_KEY) wanted.add(k);
  if (ctx.selectedProjectId) {
    for (const s of ctx.sections) if (s.project_id === ctx.selectedProjectId && !s.is_deleted) wanted.add(s.id);
  }
  const sections = ctx.sections
    .filter(s => wanted.has(s.id) && !s.is_deleted)
    .sort((a, b) => a.project_id.localeCompare(b.project_id) || a.sort_order - b.sort_order || a.id.localeCompare(b.id));
  const nameCount = new Map<string, number>();
  for (const s of sections) nameCount.set(s.name, (nameCount.get(s.name) ?? 0) + 1);
  const projectName = (id: string) => ctx.projects.find(p => p.id === id)?.name ?? "";
  const cols: AxisColumnWithTasks[] = sections.map(s => ({
    key: s.id,
    label: !ctx.selectedProjectId && (nameCount.get(s.name) ?? 0) > 1 ? `${projectName(s.project_id)}／${s.name}` : s.name,
    tasks: take(s.id),
  }));
  cols.push({ key: NO_GROUP_KEY, label: "グループなし", tasks: take(NO_GROUP_KEY) });
  return cols;
}

/** その列へ落としてよいか。落とせないときは理由（短い案内）、よければ null */
export function dropRejectReason(
  axis: Exclude<KanbanAxis, "status">, task: Task, toKey: string, ctx: AxisContext,
): string | null {
  if (axis === "assignee") {
    return toKey === OTHER_ASSIGNEE_KEY ? "この列には移せません" : null;
  }
  if (axis === "group") {
    if (toKey === NO_GROUP_KEY) {
      return task.parent_task_id ? "子タスクは親タスクと同じグループです" : null;
    }
    if (task.parent_task_id) return "子タスクは親タスクと同じグループです";
    const section = ctx.sections.find(s => s.id === toKey && !s.is_deleted);
    if (!section) return "このグループには移せません";
    if (task.project_id !== section.project_id) return "別のプロジェクトのグループには移せません";
  }
  return null;
}

/**
 * ドロップ時に Task へ上書きする項目。変化なし・落とせない場合は null。
 * fromKey＝ドラッグを始めた列（担当者軸で「どの担当者を入れ替えるか」に使う）。
 */
export function computeAxisDropPatch(
  axis: Exclude<KanbanAxis, "status">, task: Task, fromKey: string, toKey: string, ctx: AxisContext,
): Partial<Task> | null {
  if (dropRejectReason(axis, task, toKey, ctx)) return null;
  if (axis === "priority") {
    const next = toKey === NO_PRIORITY_KEY ? null : (toKey as Task["priority"]);
    return next === (task.priority ?? null) ? null : { priority: next };
  }
  if (axis === "group") {
    const next = toKey === NO_GROUP_KEY ? null : toKey;
    return next === (task.section_id ?? null) ? null : { section_id: next };
  }
  const ids = moveAssigneeIds(getAssigneeIds(task), fromKey, toKey);
  return ids ? assigneePatch(ids) : null;
}
