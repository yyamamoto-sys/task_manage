// src/lib/project/taskInheritance.ts
//
// 【設計意図】
// プロジェクト作成時の「他PJからタスクを引き継ぐ」機能（山本さん確定仕様）の中核ロジック。
// - ステータスは全て todo にリセットする（completed_at 等の後始末は appStore.saveTask の
//   choke point が既存ロジックで自動的に行うため、ここでは一切触らない）
// - 親子関係は「両方チェックされている場合のみ」新IDで張り替える。親が外れた子
//   （親が未チェック、または親がそもそも引き継ぎ元PJの範囲外＝他PJの親を持つケース）は
//   親なしのトップレベルタスクとして引き継ぐ（idMap に無い parent_task_id は null にするだけで
//   両方のケースが自然に同じ経路で処理される）
// - baseline_start_date/baseline_due_date・finalized_mentions・todo_ids（OKR紐づけ。OKRモード
//   全面刷新予定のため引き継がない）は意図的にコピーしない（フィールドを省略するだけでよい。
//   baseline は saveTask の choke point が新PJの日付から自動的に凍結する）
//
// 【IDの生成】ID を乱数で生成する処理自体は呼び出し側に委ね、この関数は
// generateId: () => string を受け取るだけにする。テストで決定的なIDジェネレータを注入できる
// ようにするため（純粋関数としてテストしやすくする設計）。

import type { Task, TaskDependency } from "../localData/types";
import { isCompletedForProgress } from "../taskMeta";
import { computeSlidedDate } from "./dateSlide";

/**
 * 元PJのタスク一覧から、既定でチェックONにするタスクID集合を返す。
 * 完了(done)・中止(cancelled)は既定でチェックOFF（isCompletedForProgress と同じ基準。
 * 山本さん確定仕様）。保留(on_hold)は引き続き既定ONのまま。
 */
export function defaultCheckedTaskIds(tasks: Task[]): Set<string> {
  return new Set(tasks.filter(t => !isCompletedForProgress(t.status)).map(t => t.id));
}

export interface BuildInheritedTasksParams {
  /** 引き継ぎ元PJの非削除タスク全件（チェック有無に関わらず全件。親子判定・依存関係の
   *  対象範囲を決めるための唯一の真実源として渡す） */
  originTasks: Task[];
  /** チェックが入っている（＝引き継ぐ）タスクID */
  checkedTaskIds: Set<string>;
  /** 新規作成するPJのID */
  newProjectId: string;
  /** 新PJの開始日（YYYY-MM-DD） */
  newProjectStartDate: string;
  /** 元PJの開始日（無ければ日付スライドの基準が取れないため無変更で引き継ぐ） */
  originProjectStartDate: string | null;
  /** 新規タスクの updated_by に使う値 */
  createdBy: string;
  /** 新規タスクの created_at/updated_at に使う値（ISO8601） */
  now: string;
  /** 新規タスクIDの採番（テストで決定的な値を注入できるよう呼び出し側から渡す） */
  generateId: () => string;
}

export interface BuildInheritedTasksResult {
  tasks: Task[];
  /** 元タスクID → 新タスクID（チェックされたタスクのみ） */
  idMap: Map<string, string>;
}

/**
 * チェックされた元タスク群から、新PJに複製する新規 Task オブジェクト一式を組み立てる。
 */
export function buildInheritedTasks(params: BuildInheritedTasksParams): BuildInheritedTasksResult {
  const {
    originTasks, checkedTaskIds, newProjectId, newProjectStartDate,
    originProjectStartDate, createdBy, now, generateId,
  } = params;

  const checked = originTasks.filter(t => checkedTaskIds.has(t.id));
  const idMap = new Map<string, string>();
  for (const t of checked) idMap.set(t.id, generateId());

  const tasks: Task[] = checked.map(t => {
    const newStart = computeSlidedDate({
      originStartDate: originProjectStartDate,
      newStartDate: newProjectStartDate,
      originalDate: t.start_date,
    });
    const newDue = computeSlidedDate({
      originStartDate: originProjectStartDate,
      newStartDate: newProjectStartDate,
      originalDate: t.due_date,
    });
    const originParentId = t.parent_task_id ?? null;
    // 親が未チェック、または引き継ぎ元PJの範囲外（他PJの親）なら idMap に無いため null になる
    const newParentId = originParentId && idMap.has(originParentId) ? (idMap.get(originParentId) ?? null) : null;

    const newTask: Task = {
      id: idMap.get(t.id) as string,
      name: t.name,
      project_id: newProjectId,
      todo_ids: [], // OKR紐づけは引き継がない（OKRモード全面刷新予定のため）
      assignee_member_id: t.assignee_member_id,
      assignee_member_ids: [...t.assignee_member_ids],
      status: "todo", // ステータスは全てリセット（completed_at等はsaveTaskが自動でクリアする）
      priority: t.priority,
      start_date: newStart,
      due_date: newDue,
      estimated_hours: t.estimated_hours,
      comment: t.comment,
      is_deleted: false,
      created_at: now,
      updated_at: now,
      updated_by: createdBy,
      parent_task_id: newParentId,
      display_order: t.display_order,
      tags: t.tags ? [...t.tags] : undefined,
      // baseline_start_date/baseline_due_date・finalized_mentions は意図的に省略
    };
    return newTask;
  });

  return { tasks, idMap };
}

export interface InheritedDependencyPair {
  predecessorTaskId: string;
  successorTaskId: string;
}

/**
 * 元PJの依存関係のうち、先行・後続の両方がチェックされている（＝idMapに存在する）組だけを、
 * 新タスクID同士の組として返す。片方だけチェックされている場合はその依存は引き継がない。
 */
export function buildInheritedDependencies(
  originDependencies: TaskDependency[],
  idMap: Map<string, string>,
): InheritedDependencyPair[] {
  const pairs: InheritedDependencyPair[] = [];
  for (const dep of originDependencies) {
    if (dep.is_deleted) continue;
    const newPred = idMap.get(dep.predecessor_task_id);
    const newSucc = idMap.get(dep.successor_task_id);
    if (newPred && newSucc) pairs.push({ predecessorTaskId: newPred, successorTaskId: newSucc });
  }
  return pairs;
}
