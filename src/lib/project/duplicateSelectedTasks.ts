// src/lib/project/duplicateSelectedTasks.ts
//
// 【設計意図】
// 「選択したタスクを複製」機能（山本さん確定仕様・2026-08-12）の中核ロジック。
// v3.57で作った「他PJから引き継ぐ」（taskInheritance.ts・inheritTaskDates.ts）と考え方は同じ
// （基準の日付オフセットを求めて全対象に加算・依存関係は選択範囲内で閉じている組だけ複製）だが、
// この機能は「同じPJの中で」複製する点が異なる：
// - project_id は複製元のまま保つ（新規PJを作らない。taskInheritance.tsのbuildInheritedTasksは
//   1つのnewProjectIdを全件に強制するため使えず、この専用関数を新設した）
// - todo_ids（ToDo紐づけ）は引き継ぐ（taskInheritance.tsは新PJがOKR未整備の前提で意図的に
//   引き継がなかったが、同じPJ内の複製ではToDo紐づけを保つ方が利用者の直感に合う）
// - タスク間の依存関係（対象内のみ）は taskInheritance.ts の buildInheritedDependencies を
//   そのまま再利用する（project_idを一切参照しない汎用実装のため変更不要）
//
// 日付移動の計算自体（オフセット・shiftDateByOffset）は inheritTaskDates.ts の純粋関数を
// そのまま使う（同じ計算を二度書かない。山本さんの指示）。

import type { Task, TaskTaskForce, TaskProject } from "../localData/types";
import { computeInheritedTaskDates } from "./inheritTaskDates";

/**
 * 名前の一括置換（任意）。findが空文字なら置換しない（そのまま返す）。
 * 正規表現ではなく単純な部分文字列一致（split/join）にする：利用者が入れる「第1回」等の
 * 文字列に正規表現特殊文字（括弧・記号）が含まれても意図通りに動くことを優先するため。
 */
export function replaceInName(name: string, find: string, replace: string): string {
  if (!find) return name;
  return name.split(find).join(replace);
}

export interface BuildDuplicatedTasksParams {
  /** 複製対象として選択されたタスク（元のまま。選択範囲外のタスクは含めない） */
  selectedTasks: Task[];
  /** 日付移動のオフセット（暦日）。null は基準が決まらない/「日付を引き継がない」相当 */
  dateOffsetDays: number | null;
  /** 名前の一括置換（任意。findが空なら置換しない） */
  nameFind: string;
  nameReplace: string;
  createdBy: string;
  now: string;
  generateId: () => string;
}

export interface BuildDuplicatedTasksResult {
  tasks: Task[];
  /** 元タスクID → 新タスクID（選択されたタスクのみ） */
  idMap: Map<string, string>;
}

/**
 * 選択されたタスク群から、複製後の新規Taskオブジェクト一式を組み立てる。
 *
 * 【引き継ぐ】タスク名（置換適用後）・担当者・優先度・見積工数・コメント・PJ紐づけ
 * （project_idはそのまま＝同じPJ内に作る）・TF/ToDo紐づけ（todo_idsはここでコピー。
 * TaskTaskForce/TaskProjectの複製はbuildDuplicatedTaskForceLinks/buildDuplicatedTaskProjectLinks
 * が別途担う）・親子関係（選択範囲内で閉じている場合のみ）・タグ。
 * 【リセットする】ステータス（todoに戻す）・完了関連（completed_atはappStore.saveTaskの
 * choke pointが自動でnullにする。ここでは触らない）。
 * 【新規に捕捉される】ベースライン（B4）はbaseline_start_date/baseline_due_dateを
 * 意図的に省略することで、saveTaskのchoke pointが複製後の日付から改めて凍結する。
 * finalized_mentions（メンション確定スナップショット）も意図的に省略する（複製元の
 * レビュー履歴を新タスクに持ち込む理由が無いため）。
 */
export function buildDuplicatedTasks(params: BuildDuplicatedTasksParams): BuildDuplicatedTasksResult {
  const { selectedTasks, dateOffsetDays, nameFind, nameReplace, createdBy, now, generateId } = params;

  const idMap = new Map<string, string>();
  for (const t of selectedTasks) idMap.set(t.id, generateId());

  const tasks: Task[] = selectedTasks.map(t => {
    const { start_date, due_date } = computeInheritedTaskDates({
      offsetDays: dateOffsetDays, startDate: t.start_date, dueDate: t.due_date,
    });
    // 親が選択範囲外（未選択、またはそもそも選択に含まれない他タスクの子）なら
    // idMapに無いためnullになる＝独立したトップレベルタスクとして複製される。
    // 逆に「選択した親タスクの子タスクを選び忘れた」場合、その子は単に複製されない
    // （複製後の親に「消えた子」が残るわけではない＝驚きが少ない。CLAUDE.md本文の
    // 判断参照）。
    const originParentId = t.parent_task_id ?? null;
    const newParentId = originParentId && idMap.has(originParentId) ? (idMap.get(originParentId) ?? null) : null;

    const newTask: Task = {
      id: idMap.get(t.id) as string,
      name: replaceInName(t.name, nameFind, nameReplace),
      project_id: t.project_id,
      todo_ids: [...t.todo_ids],
      assignee_member_id: t.assignee_member_id,
      assignee_member_ids: [...t.assignee_member_ids],
      status: "todo",
      priority: t.priority,
      start_date,
      due_date,
      estimated_hours: t.estimated_hours,
      comment: t.comment,
      is_deleted: false,
      created_at: now,
      updated_at: now,
      updated_by: createdBy,
      parent_task_id: newParentId,
      tags: t.tags ? [...t.tags] : undefined,
      // display_order・baseline_start_date/baseline_due_date・finalized_mentionsは
      // 意図的に省略（display_orderは複製元と同じ値を持つと兄弟内で衝突するため）
    };
    return newTask;
  });

  return { tasks, idMap };
}

/**
 * 元のTaskTaskForce（タスク⇔TF）から、複製対象（idMapに存在するタスク）分だけを
 * 新タスクID向けに複製する。
 */
export function buildDuplicatedTaskForceLinks(
  originLinks: TaskTaskForce[],
  idMap: Map<string, string>,
): TaskTaskForce[] {
  const links: TaskTaskForce[] = [];
  for (const link of originLinks) {
    const newTaskId = idMap.get(link.task_id);
    if (newTaskId) links.push({ task_id: newTaskId, tf_id: link.tf_id });
  }
  return links;
}

/**
 * 元のTaskProject（タスク⇔追加PJ。project_idの主紐づけ以外の多対多）から、
 * 複製対象分だけを新タスクID向けに複製する。
 */
export function buildDuplicatedTaskProjectLinks(
  originLinks: TaskProject[],
  idMap: Map<string, string>,
): TaskProject[] {
  const links: TaskProject[] = [];
  for (const link of originLinks) {
    const newTaskId = idMap.get(link.task_id);
    if (newTaskId) links.push({ task_id: newTaskId, project_id: link.project_id });
  }
  return links;
}
