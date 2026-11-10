// src/lib/ai/ganttPreviewDiff.ts
//
// 【設計意図・v3.209】「ガントで比較」画面（GanttPreviewPanel）で、提案を適用した前後の差分を求める純粋関数。
// 変更のあった行を色・記号で目立たせるための元データ（種類つき）を作る。DBは触らない。
//
// 日付の求め方は applyProposal.ts の date_change（shift_days があれば現在の期日に加算、無ければ suggested_date）と
// 同じにしてある。以前のプレビューは shift_days を無視して suggested_date だけを見ていたため、
// 「全て+N日」型の提案ではバーが動かなかった。
// 反映時に起きる後続タスクの自動リスケ（B3）はここでは再現しない（提案が直接指定したタスクの変化だけを示す）。

import type { Task } from "../localData/types";
import { toDate, addDays, toDateStr } from "../date";

export type ChangeKind = "date" | "assignee" | "added" | "removed";

export interface TaskChange {
  kind: ChangeKind;
  beforeStart: string | null;
  beforeDue: string | null;
  afterStart: string | null;
  afterDue: string | null;
}

export interface PreviewProposalInput {
  action_type: string;
  suggested_date?: string;
  shift_days?: number;
  suggested_assignee?: string;
}

/** 提案を適用した仮のタスク一覧を返す（対象 id のタスクだけ書き換える。元の配列・オブジェクトは変えない） */
export function applyProposalToPreview(
  tasks: Task[],
  proposal: PreviewProposalInput,
  targetTaskIds: string[],
  findMemberIdByShortName: (shortName: string) => string | undefined,
): Task[] {
  const targets = new Set(targetTaskIds);
  return tasks.map((task): Task => {
    if (!targets.has(task.id)) return task;

    if (proposal.action_type === "date_change") {
      let next = proposal.suggested_date;
      if (proposal.shift_days && task.due_date) {
        const d = toDate(task.due_date);
        if (d) next = toDateStr(addDays(d, proposal.shift_days));
      }
      return next ? { ...task, due_date: next } : task;
    }

    if (proposal.action_type === "assignee" && proposal.suggested_assignee) {
      const memberId = findMemberIdByShortName(proposal.suggested_assignee);
      return memberId ? { ...task, assignee_member_id: memberId, assignee_member_ids: [memberId] } : task;
    }

    return task;
  });
}

function sameAssignees(a: Task, b: Task): boolean {
  const ids = (t: Task) => [...(t.assignee_member_ids?.length ? t.assignee_member_ids : t.assignee_member_id ? [t.assignee_member_id] : [])].sort().join(",");
  return ids(a) === ids(b);
}

const isGone = (t: Task) => t.is_deleted || t.status === "cancelled";

/**
 * 前後の差分。種類の優先順位は 削除/中止 ＞ 追加 ＞ 日程 ＞ 担当（複数当てはまるときは先のものを採る）。
 * 変わっていないタスクは含めない。
 */
export function diffTasksForPreview(before: Task[], after: Task[]): Map<string, TaskChange> {
  const beforeById = new Map(before.map(t => [t.id, t]));
  const afterById = new Map(after.map(t => [t.id, t]));
  const changes = new Map<string, TaskChange>();

  for (const [id, a] of afterById) {
    const b = beforeById.get(id);
    const base = {
      beforeStart: b?.start_date ?? null, beforeDue: b?.due_date ?? null,
      afterStart: a.start_date ?? null, afterDue: a.due_date ?? null,
    };
    if (!b) {
      if (!isGone(a)) changes.set(id, { kind: "added", ...base });
      continue;
    }
    if (isGone(a) && !isGone(b)) changes.set(id, { kind: "removed", ...base });
    else if (base.beforeStart !== base.afterStart || base.beforeDue !== base.afterDue) changes.set(id, { kind: "date", ...base });
    else if (!sameAssignees(b, a)) changes.set(id, { kind: "assignee", ...base });
  }
  for (const [id, b] of beforeById) {
    if (!afterById.has(id) && !isGone(b)) {
      changes.set(id, { kind: "removed", beforeStart: b.start_date ?? null, beforeDue: b.due_date ?? null, afterStart: null, afterDue: null });
    }
  }
  return changes;
}

export function summarizeChanges(changes: Map<string, TaskChange>): Record<ChangeKind, number> & { total: number } {
  const out = { date: 0, assignee: 0, added: 0, removed: 0, total: 0 };
  for (const c of changes.values()) { out[c.kind]++; out.total++; }
  return out;
}

/** 変更だけのタスク一覧（「変更のある行だけ表示」用。親が外れた子は最上位として表示される＝ガント側の既存の挙動） */
export function onlyChangedTasks(tasks: Task[], changes: Map<string, TaskChange>): Task[] {
  return tasks.filter(t => changes.has(t.id));
}

export interface ChangeStyle {
  label: string;
  /** 色だけに頼らないための記号 */
  symbol: string;
  /** 帯・バー・記号の色（デザイントークン。ダークモードは globals.css 側で切り替わる） */
  color: string;
  /** 行の薄い背景色 */
  bg: string;
}

export const CHANGE_STYLES: Record<ChangeKind, ChangeStyle> = {
  date:     { label: "日程変更", symbol: "↔", color: "var(--color-text-info)",    bg: "var(--color-bg-info)" },
  assignee: { label: "担当変更", symbol: "👤", color: "var(--color-text-purple)", bg: "var(--color-bg-purple)" },
  added:    { label: "新規追加", symbol: "＋", color: "var(--color-text-success)", bg: "var(--color-bg-success)" },
  removed:  { label: "削除・中止", symbol: "−", color: "var(--color-text-danger)", bg: "var(--color-bg-danger)" },
};

/** 「5/10 → 5/17」形式の短い説明（ツールチップ・バー横の注記用） */
export function describeChange(c: TaskChange): string {
  const md = (s: string | null) => {
    if (!s) return "未定";
    const m = /^\d{4}-(\d{2})-(\d{2})/.exec(s);
    return m ? `${Number(m[1])}/${Number(m[2])}` : s;
  };
  if (c.kind === "date") return `${md(c.beforeDue)} → ${md(c.afterDue)}`;
  if (c.kind === "assignee") return "担当が変わります";
  if (c.kind === "added") return "新規追加";
  return "削除・中止";
}
