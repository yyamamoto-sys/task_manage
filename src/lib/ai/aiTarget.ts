// src/lib/ai/aiTarget.ts
//
// 【設計意図】
// AIへ送るPJ・タスクの範囲を決める唯一の入口（CLAUDE.md Section 73）。
// - アーカイブ済み・削除済みのPJは、どのAI機能にも送らない（isAiTargetProject）
// - AIパネルの「対象PJ」：null＝「すべてのPJ」（完了PJも除く）／PJのid＝そのPJだけ（完了PJでも個別なら対象）
// - AI相談・資料インプットが送るタスクは、完了（done）・中止（cancelled）を除く
// 判定をここに集約し、AIへ送る組み立て箇所はこのファイルを必ず通る
// （src/lib/ai/__tests__/aiTargetCoverage.test.ts が経路の網羅を検査する）。

import type { Project, Task, TaskProject } from "../localData/types";

/** どのAI機能にも送ってよいPJか（削除済み・アーカイブ済みは送らない） */
export function isAiTargetProject(p: Pick<Project, "is_deleted" | "status">): boolean {
  return !p.is_deleted && p.status !== "archived";
}

/** 「すべてのPJ」で送るPJか（アーカイブ済み・削除済みに加えて、完了PJも送らない） */
export function isAiBulkTargetProject(p: Pick<Project, "is_deleted" | "status">): boolean {
  return isAiTargetProject(p) && p.status !== "completed";
}

/** AI相談・資料インプットが個別タスクとして送るか（完了・中止・削除済みは送らない） */
export function isAiSendableTask(t: Pick<Task, "is_deleted" | "status">): boolean {
  return !t.is_deleted && t.status !== "done" && t.status !== "cancelled";
}

/** 対象PJのプルダウンの選択肢にするPJ（アーカイブ済み・削除済みを除く。完了PJは含む） */
export function aiTargetPickerProjects<P extends Pick<Project, "is_deleted" | "status">>(projects: P[]): P[] {
  return projects.filter(isAiTargetProject);
}

export interface AiScopeProject {
  project: Project;
  /** そのPJに紐づく非削除タスクすべて（完了・中止を含む。PJ単位の件数集計用） */
  allTasks: Task[];
  /** AIへ個別に送るタスク（完了・中止を除く） */
  openTasks: Task[];
}

export interface AiScope {
  projects: AiScopeProject[];
  /** 送るタスクの重複なし一覧（複数PJに紐づくタスクは1件） */
  openTasks: Task[];
}

export interface ResolveAiScopeInput {
  projects: Project[];
  tasks: Task[];
  taskProjects?: TaskProject[];
  /** null＝すべてのPJ／id＝そのPJだけ */
  targetPjId: string | null;
  /** PJに属さないタスク（ToDo直轄など）も送るか。資料インプットのステータス更新候補用（「すべてのPJ」のときだけ効く） */
  includeProjectlessTasks?: boolean;
}

export function resolveAiScope(input: ResolveAiScopeInput): AiScope {
  const { projects, targetPjId } = input;
  const targetProjects = targetPjId == null
    ? projects.filter(isAiBulkTargetProject)
    : projects.filter(p => p.id === targetPjId && isAiTargetProject(p));

  const liveTasks = input.tasks.filter(t => !t.is_deleted);
  const secondaryIdsByPj = new Map<string, Set<string>>();
  for (const tp of input.taskProjects ?? []) {
    if (!secondaryIdsByPj.has(tp.project_id)) secondaryIdsByPj.set(tp.project_id, new Set());
    secondaryIdsByPj.get(tp.project_id)!.add(tp.task_id);
  }

  const scoped: AiScopeProject[] = targetProjects.map(project => {
    const secondary = secondaryIdsByPj.get(project.id);
    const allTasks = liveTasks.filter(t => t.project_id === project.id || (secondary?.has(t.id) ?? false));
    return { project, allTasks, openTasks: allTasks.filter(isAiSendableTask) };
  });

  const seen = new Set<string>();
  const openTasks: Task[] = [];
  for (const sp of scoped) {
    for (const t of sp.openTasks) {
      if (!seen.has(t.id)) { seen.add(t.id); openTasks.push(t); }
    }
  }
  if (targetPjId == null && input.includeProjectlessTasks) {
    for (const t of liveTasks) {
      if (t.project_id == null && isAiSendableTask(t) && !seen.has(t.id)) { seen.add(t.id); openTasks.push(t); }
    }
  }
  return { projects: scoped, openTasks };
}

/**
 * AI相談の途中で「対象PJ」を変えるとき、新しい相談として始めるかの確認を出すか（v3.183・M83）。
 * 会話（履歴・表示中の提案・返答待ち）が空なら出さない。PJが変わらないときも出さない。
 */
export function shouldConfirmTargetChange(input: {
  currentPjId: string | null;
  nextPjId: string | null;
  turnCount: number;
  proposalCount: number;
  loading: boolean;
}): boolean {
  if (input.currentPjId === input.nextPjId) return false;
  return input.turnCount > 0 || input.proposalCount > 0 || input.loading;
}
