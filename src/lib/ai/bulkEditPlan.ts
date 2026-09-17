// src/lib/ai/bulkEditPlan.ts
//
// 【設計意図】CLAUDE.md Section 56（bulk_rename / bulk_status）参照。
// AI相談から「『第2回』を『第3回』に一括変更して」のような一括リネーム・一括ステータス変更を
// 適用する前に、対象タスクをどう扱うかを決める純粋関数群。DBにもappStoreにも触れない
// （applyProposal.tsがこの結果を使って確認ダイアログを組み立てる）。
//
// 【なぜ純粋関数に切り出すか】
// 安全装置（50件超の警告・空文字化の除外・変化なしの除外）はロジックの中核であり、UIやDB
// アクセスから切り離してテストしないと、確認漏れが起きても気づけない。

import type { Task } from "../localData/types";
import { replaceInName } from "../project/duplicateSelectedTasks";

/** この件数を超える対象には確認ダイアログで警告を表示する（実行は妨げない） */
export const BULK_WARNING_THRESHOLD = 50;

export type TaskStatusValue = Task["status"];

// ===== bulk_rename =====

export interface BulkRenameSourceTask {
  id: string;
  name: string;
}

export interface BulkRenameItem {
  task_id: string;
  task_name: string;
  new_name: string;
}

export interface BulkRenameExclusion {
  task_id: string;
  task_name: string;
  reason: "empty" | "unchanged";
}

export interface BulkRenamePlan {
  /** 実際に変更する対象（除外されたものは含まない） */
  items: BulkRenameItem[];
  /** 除外された対象（理由付き） */
  excluded: BulkRenameExclusion[];
  /** AIが指定したtarget_task_idsのうち実在した件数（除外分を含む） */
  totalTargetCount: number;
  /** totalTargetCount が BULK_WARNING_THRESHOLD を超えるか */
  overLimit: boolean;
}

/**
 * 一括リネームの計画を組み立てる。
 * - 置換後に空文字（trim後）になるタスクは除外（reason: "empty"）
 * - 置換しても名前が変わらないタスク（findが含まれない・findが空文字等）は除外（reason: "unchanged"）
 * 置換自体は duplicateSelectedTasks.ts の replaceInName（単純な部分文字列一致）を再利用する。
 */
export function buildBulkRenamePlan(
  tasks: BulkRenameSourceTask[],
  find: string,
  replace: string,
): BulkRenamePlan {
  const items: BulkRenameItem[] = [];
  const excluded: BulkRenameExclusion[] = [];

  for (const t of tasks) {
    const newName = replaceInName(t.name, find, replace);
    if (!newName.trim()) {
      excluded.push({ task_id: t.id, task_name: t.name, reason: "empty" });
      continue;
    }
    if (newName === t.name) {
      excluded.push({ task_id: t.id, task_name: t.name, reason: "unchanged" });
      continue;
    }
    items.push({ task_id: t.id, task_name: t.name, new_name: newName });
  }

  return {
    items,
    excluded,
    totalTargetCount: tasks.length,
    overLimit: tasks.length > BULK_WARNING_THRESHOLD,
  };
}

/** 除外があった場合のみ、件数と理由をまとめた文言を返す（無ければundefined） */
export function buildBulkExclusionSummary(excluded: BulkRenameExclusion[]): string | undefined {
  if (excluded.length === 0) return undefined;
  const emptyCount = excluded.filter(e => e.reason === "empty").length;
  const unchangedCount = excluded.filter(e => e.reason === "unchanged").length;
  const parts: string[] = [];
  if (emptyCount > 0) parts.push(`置換後に名前が空になる：${emptyCount}件`);
  if (unchangedCount > 0) parts.push(`置換しても変化なし：${unchangedCount}件`);
  return `${excluded.length}件を対象から自動的に除外しました（${parts.join("／")}）`;
}

// ===== bulk_status =====

export interface BulkStatusSourceTask {
  id: string;
  name: string;
  status: TaskStatusValue;
}

export interface BulkStatusItem {
  task_id: string;
  task_name: string;
  current_status: TaskStatusValue;
}

export interface BulkStatusPlan {
  items: BulkStatusItem[];
  totalTargetCount: number;
  overLimit: boolean;
}

/**
 * 一括ステータス変更の計画を組み立てる。
 * bulk_renameと違い自動除外は行わない（ステータスは「既に同じ値」でも実害が無いため、
 * 除外するかどうかは利用者がチェックボックスで判断すればよい。CLAUDE.md Section 56参照）。
 */
export function buildBulkStatusPlan(tasks: BulkStatusSourceTask[]): BulkStatusPlan {
  return {
    items: tasks.map(t => ({ task_id: t.id, task_name: t.name, current_status: t.status })),
    totalTargetCount: tasks.length,
    overLimit: tasks.length > BULK_WARNING_THRESHOLD,
  };
}
