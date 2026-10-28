// src/lib/wbsImport/wbsPlan.ts
//
// 【設計意図・v3.189】
// 読み取ったWBS（wbsParse.ts）を、アプリのデータ（PJ・PJ内グループ・タスク・先行タスク・マイルストーン）へ
// 当てはめる純粋関数。保存はしない（確認画面で見せてから wbsApply.ts が書く）。
// 当てはめ方：
//  - G＝PJ内グループ（Section 78）。既存PJへ追加するとき同名のグループがあればそこへ入れ、無ければ新しく作る
//  - P＝親タスク、C＝その子タスク（子は親と同じグループ）
//  - 備考：「完了」→ステータス完了／「マイルストーン」→タスク＋マイルストーン（◆）の両方／「ユーザー」「仮」→タグ／その他→メモ
//    マイルストーンをタスクのまま残すのは、先行タスクのつながり（タスク同士にしか張れない）を保つため。
//    ◆はタスクの終了日（無ければ開始日）に置く
//  - 担当者：列が無い／照合できないときは取り込む本人（meetingDrafts.ts の既定と同じ）
//  - 並び順：WBSの順どおり（display_order）。既存PJへの追加は末尾から

import type { Member, Milestone, Project, ProjectSection, Task } from "../localData/types";
import { normalizeSectionName, sectionsOfProject, nextSectionSortOrder } from "../section/sections";
import { nextDisplayOrder } from "../task/newTask";
import type { WbsParseResult, WbsRow } from "./wbsParse";

export type WbsTarget =
  | { kind: "new"; name: string; purpose: string; color: string }
  | { kind: "existing"; projectId: string };

export interface WbsPlanContext {
  target: WbsTarget;
  currentUserId: string;
  /** 担当者の照合に使う候補（表示部署のメンバー） */
  members: Pick<Member, "id" | "short_name" | "display_name">[];
  /** 既存PJへ追加するときの、そのPJの現在のタスク・グループ（並び順の採番と同名グループの判定） */
  existingTasks: Task[];
  existingSections: ProjectSection[];
  now: string;
  newId: () => string;
}

export interface WbsPlan {
  /** 新規作成するPJ（既存PJへ追加するときは null） */
  project: Project | null;
  projectId: string;
  /** 新しく作るグループ */
  sections: ProjectSection[];
  /** 既存のグループに入れる件数（同名） */
  reusedSectionNames: string[];
  /** WBSの順。親は必ず子より前 */
  tasks: Task[];
  /** 親タスクの、WBSに書かれた本来のステータス（子の保存で自動更新された後に合わせ直す） */
  finalStatuses: { taskId: string; status: Task["status"] }[];
  dependencies: { predecessorTaskId: string; successorTaskId: string }[];
  milestones: Milestone[];
  /** 行（WbsRow.index）ごとの当てはめ時の警告（担当者・マイルストーンの日付） */
  extraWarnings: Map<number, string[]>;
  /** 行（WbsRow.index）→ 作るタスクの id（グループ行は無い） */
  taskIdByRow: Map<number, string>;
}

function resolveAssignees(
  text: string,
  members: WbsPlanContext["members"],
  currentUserId: string,
): { ids: string[]; warning: string | null } {
  const fallback = { ids: [currentUserId], warning: null as string | null };
  if (text.trim() === "") return fallback;
  const ids: string[] = [];
  const missing: string[] = [];
  for (const token of text.split(/[,、，/／・;；]+/).map(x => x.trim()).filter(x => x !== "")) {
    const hit = members.find(m => m.short_name === token) ?? members.find(m => m.display_name.includes(token));
    if (hit) { if (!ids.includes(hit.id)) ids.push(hit.id); } else missing.push(token);
  }
  if (ids.length === 0) {
    return { ids: [currentUserId], warning: `担当者「${text}」をメンバーと照合できません（取り込む本人を担当者にします）` };
  }
  return { ids, warning: missing.length > 0 ? `担当者「${missing.join("・")}」は照合できないため外します` : null };
}

function pushWarning(map: Map<number, string[]>, index: number, w: string) {
  const list = map.get(index) ?? [];
  list.push(w);
  map.set(index, list);
}

export function buildWbsPlan(parsed: WbsParseResult, ctx: WbsPlanContext): WbsPlan {
  const { rows } = parsed;
  const extraWarnings = new Map<number, string[]>();
  const dated = rows.flatMap(r => [r.start, r.end]).filter((d): d is string => d !== null).sort();

  let project: Project | null = null;
  let projectId: string;
  if (ctx.target.kind === "new") {
    projectId = ctx.newId();
    const year = new Date(ctx.now).getFullYear();
    project = {
      id: projectId,
      name: ctx.target.name.trim(),
      purpose: ctx.target.purpose.trim(),
      contribution_memo: "",
      owner_member_id: ctx.currentUserId,
      owner_member_ids: [ctx.currentUserId],
      member_ids: [],
      status: "active",
      color_tag: ctx.target.color,
      start_date: dated[0] ?? ctx.now.slice(0, 10),
      end_date: dated[dated.length - 1] ?? `${year}-12-31`,
      is_deleted: false,
      created_at: ctx.now,
      updated_at: ctx.now,
      updated_by: ctx.currentUserId,
    };
  } else {
    projectId = ctx.target.projectId;
  }

  // グループ：同名は1つにまとめる。既存PJに同名があればそれを使う
  const existingSecs = ctx.target.kind === "existing" ? sectionsOfProject(ctx.existingSections, projectId) : [];
  const allForOrder: ProjectSection[] = [...ctx.existingSections];
  const sections: ProjectSection[] = [];
  const reusedSectionNames: string[] = [];
  const sectionIdByName = new Map<string, string>();
  const sectionIdByRow = new Map<number, string>();
  for (const row of rows) {
    if (row.level !== "G") continue;
    const name = normalizeSectionName(row.name);
    if (!name) continue;
    let id = sectionIdByName.get(name);
    if (!id) {
      const reuse = existingSecs.find(s => s.name === name);
      if (reuse) {
        id = reuse.id;
        reusedSectionNames.push(name);
      } else {
        id = ctx.newId();
        const sec: ProjectSection = {
          id, project_id: projectId, name,
          sort_order: nextSectionSortOrder(allForOrder, projectId),
          is_deleted: false, updated_by: ctx.currentUserId,
        };
        sections.push(sec);
        allForOrder.push(sec);
      }
      sectionIdByName.set(name, id);
    }
    sectionIdByRow.set(row.index, id);
  }

  const hasChildren = new Set<number>();
  for (const r of rows) if (r.parentIndex !== null) hasChildren.add(r.parentIndex);

  const taskIdByRow = new Map<number, string>();
  const tasks: Task[] = [];
  const finalStatuses: WbsPlan["finalStatuses"] = [];
  const milestones: Milestone[] = [];
  let topOrder = nextDisplayOrder(ctx.existingTasks, projectId, null);
  const childOrder = new Map<number, number>();

  const buildTask = (row: WbsRow): Task => {
    const id = ctx.newId();
    taskIdByRow.set(row.index, id);
    const { ids, warning } = resolveAssignees(row.assigneeText, ctx.members, ctx.currentUserId);
    if (warning) pushWarning(extraWarnings, row.index, warning);
    const tags = [...row.tags];
    if (row.milestone) tags.push("マイルストーン");
    const parentId = row.parentIndex !== null ? taskIdByRow.get(row.parentIndex) ?? null : null;
    let order: number;
    if (parentId) {
      order = childOrder.get(row.parentIndex as number) ?? 0;
      childOrder.set(row.parentIndex as number, order + 1);
    } else {
      order = topOrder++;
    }
    const desired: Task["status"] = row.done ? "done" : "todo";
    // 子を持つ親は、子の保存で親の状態が自動で動くため、いったん todo で作り最後に本来の値へ合わせる
    const parentWithChildren = hasChildren.has(row.index);
    if (parentWithChildren && desired !== "todo") finalStatuses.push({ taskId: id, status: desired });
    const task: Task = {
      id,
      name: row.name,
      project_id: projectId,
      parent_task_id: parentId,
      display_order: order,
      todo_ids: [],
      assignee_member_id: ids[0],
      assignee_member_ids: ids,
      status: parentWithChildren ? "todo" : desired,
      priority: null,
      start_date: row.start,
      due_date: row.end,
      estimated_hours: null,
      comment: row.memo ? `備考：${row.memo}` : "",
      is_deleted: false,
      created_at: ctx.now,
      updated_at: ctx.now,
      updated_by: ctx.currentUserId,
    };
    if (tags.length > 0) task.tags = tags;
    const secId = row.groupIndex !== null ? sectionIdByRow.get(row.groupIndex) : undefined;
    if (secId) task.section_id = secId;
    if (row.milestone) {
      const date = row.end ?? row.start;
      if (date) {
        milestones.push({
          id: ctx.newId(), project_id: projectId, name: row.name, date,
          is_deleted: false, updated_by: ctx.currentUserId,
        });
      } else {
        pushWarning(extraWarnings, row.index, "日付が無いためマイルストーン（◆）は作らず、タグだけ付けます");
      }
    }
    return task;
  };

  for (const row of rows) {
    if (row.level === "G") continue;
    tasks.push(buildTask(row));
  }

  const dependencies: WbsPlan["dependencies"] = [];
  for (const row of rows) {
    const succ = taskIdByRow.get(row.index);
    if (!succ) continue;
    for (const pid of row.predecessorIds) {
      const predRow = rows.find(r => r.id === pid);
      const pred = predRow ? taskIdByRow.get(predRow.index) : undefined;
      if (pred) dependencies.push({ predecessorTaskId: pred, successorTaskId: succ });
    }
  }

  return { project, projectId, sections, reusedSectionNames, tasks, finalStatuses, dependencies, milestones, extraWarnings, taskIdByRow };
}
