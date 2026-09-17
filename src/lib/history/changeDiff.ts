// src/lib/history/changeDiff.ts
//
// 【設計意図】
// タスク・プロジェクトの変更履歴（entity_change_logs）に記録する差分を計算する純粋関数。
// CLAUDE.md Section 57参照。appStore.ts の saveTask/saveProject choke point からのみ
// 呼ばれる想定（appStoreに直接書かず、ここに切り出してテストする）。
//
// 【対象フィールドを限定する理由】
// 全フィールドの差分を取ると display_order（並べ替えのたびに数十件の履歴が生まれ、
// 本当に見たい変更が埋もれる）・updated_at/updated_by（保存のたびに必ず変わり無意味）・
// created_at/group_id/group_ids（業務上の「変更」ではない）・baseline_*・
// finalized_mentions（内部管理用）まで記録してしまう。TASK_TRACKED_FIELDS /
// PROJECT_TRACKED_FIELDS のホワイトリストに載っている項目だけを比較する。

import type { Task, Project } from "../localData/types";

export type ChangeDiff = Record<string, { before: unknown; after: unknown }>;

export const TASK_TRACKED_FIELDS = [
  "name",
  "status",
  "priority",
  "assignee_member_id",
  "assignee_member_ids",
  "start_date",
  "due_date",
  "estimated_hours",
  "comment",
  "project_id",
  "todo_ids",
  "parent_task_id",
  "is_deleted",
] as const satisfies readonly (keyof Task)[];

export const PROJECT_TRACKED_FIELDS = [
  "name",
  "purpose",
  "contribution_memo",
  "owner_member_id",
  "start_date",
  "end_date",
  "status",
  "color_tag",
  "is_deleted",
] as const satisfies readonly (keyof Project)[];

/** 配列として比較すべきフィールド（順序を無視した集合比較にする）。
 *  computeFormDirty（taskEditPayload.ts）と同じ考え方：並べ替え自体は「変更」として
 *  記録したい内容ではないため、順序差だけでは差分扱いにしない。 */
const ARRAY_FIELDS = new Set(["assignee_member_ids", "todo_ids"]);

/** undefined と null は「未設定」として同一視する（DBからは undefined で来ないことが
 *  多いが、appStore内で組み立てた値には undefined が混じりうるため）。 */
function normalize(value: unknown): unknown {
  return value === undefined ? null : value;
}

function sameStringArrayAsSet(a: unknown, b: unknown): boolean {
  const arrA = Array.isArray(a) ? a : [];
  const arrB = Array.isArray(b) ? b : [];
  if (arrA.length !== arrB.length) return false;
  const setB = new Set(arrB);
  return arrA.every(x => setB.has(x));
}

function fieldsEqual(field: string, before: unknown, after: unknown): boolean {
  const b = normalize(before);
  const a = normalize(after);
  if (ARRAY_FIELDS.has(field)) return sameStringArrayAsSet(b, a);
  return b === a;
}

/**
 * ホワイトリストの各フィールドについて before/after を比較し、変化したものだけを
 * diff として返す。before が undefined（新規作成）の場合でも呼び出し自体はできるが、
 * 呼び出し側（appStore.ts）は action==="create" のときはこの関数を呼ばず diff を
 * 空のまま記録する設計にしている（CLAUDE.md Section 57「新規は diff 空でよい」）。
 */
function computeDiff<T extends Record<string, unknown>>(
  fields: readonly string[],
  before: T | undefined,
  after: T,
): ChangeDiff {
  const diff: ChangeDiff = {};
  for (const field of fields) {
    const b = before ? before[field] : undefined;
    const a = after[field];
    if (!fieldsEqual(field, b, a)) {
      diff[field] = { before: normalize(b), after: normalize(a) };
    }
  }
  return diff;
}

export function computeTaskDiff(before: Task | undefined, after: Task): ChangeDiff {
  return computeDiff(TASK_TRACKED_FIELDS, before as unknown as Record<string, unknown> | undefined, after as unknown as Record<string, unknown>);
}

export function computeProjectDiff(before: Project | undefined, after: Project): ChangeDiff {
  return computeDiff(PROJECT_TRACKED_FIELDS, before as unknown as Record<string, unknown> | undefined, after as unknown as Record<string, unknown>);
}
