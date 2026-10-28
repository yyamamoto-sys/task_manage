// src/lib/wbsImport/wbsApply.ts
//
// 【設計意図・v3.189】
// WBSの当てはめ結果（wbsPlan.ts）を書き込む。DBにはまとめて書くトランザクションが無い（1件ずつの保存）ため、
// 「途中で失敗しても半端な状態を残さない」ことを、作ったものを逆順に論理削除する取り消し（補償）で担保する。
// 物理削除はしない（CLAUDE.md Section 4）。取り消しも失敗したときは、何件が残ったかを返す。
// 書く順：PJ（新規のとき）→グループ→タスク（親→子の順）→親のステータスの合わせ直し→先行タスク→マイルストーン。
// 先行タスクを最後に張るのは、完了のタスクが先行の未完了で止められる（B1ゲート）のを避けるため。
// タスクは skipCascade:true（先行タスク追加前でB3は空振りだが、一括作成系と同じ防御）。

import type { Milestone, Project, ProjectSection, Task } from "../localData/types";
import type { WbsPlan } from "./wbsPlan";

export interface WbsApplyDeps {
  saveProject: (p: Project) => Promise<void>;
  deleteProject: (id: string, by: string) => Promise<void>;
  saveProjectSection: (s: ProjectSection) => Promise<void>;
  deleteProjectSection: (id: string, by: string) => Promise<void>;
  saveTask: (t: Task, o?: { skipCascade?: boolean }) => Promise<void>;
  deleteTask: (id: string, by: string) => Promise<void>;
  getTaskStatus: (id: string) => Task["status"] | undefined;
  getTask: (id: string) => Task | undefined;
  addTaskDependency: (pred: string, succ: string, by: string) => Promise<void>;
  /** 作った先行タスクのid（取り消し用）。見つからなければ undefined */
  findDependencyId: (pred: string, succ: string) => string | undefined;
  removeTaskDependency: (id: string, by: string) => Promise<void>;
  saveMilestone: (m: Milestone) => Promise<void>;
  deleteMilestone: (id: string, by: string) => Promise<void>;
  onProgress?: (done: number, total: number, label: string) => void;
}

export interface WbsCounts {
  project: number;
  sections: number;
  tasks: number;
  dependencies: number;
  milestones: number;
}

export type WbsApplyOutcome =
  | { ok: true; counts: WbsCounts }
  | {
      ok: false;
      error: unknown;
      /** 失敗したのがどの段階か（画面に出す） */
      stage: string;
      /** 失敗までに書けていた件数 */
      written: WbsCounts;
      /** 取り消しが完了したか。false のとき remaining に残ったものがある */
      rolledBack: boolean;
      remaining: WbsCounts;
    };

const zero = (): WbsCounts => ({ project: 0, sections: 0, tasks: 0, dependencies: 0, milestones: 0 });

export function describeCounts(c: WbsCounts): string {
  const parts: string[] = [];
  if (c.project) parts.push("プロジェクト1件");
  parts.push(`グループ${c.sections}件`, `タスク${c.tasks}件`, `先行タスク${c.dependencies}件`, `マイルストーン${c.milestones}件`);
  return parts.join("・");
}

export async function applyWbsPlan(plan: WbsPlan, by: string, deps: WbsApplyDeps): Promise<WbsApplyOutcome> {
  const total = (plan.project ? 1 : 0) + plan.sections.length + plan.tasks.length + plan.finalStatuses.length
    + plan.dependencies.length + plan.milestones.length;
  let step = 0;
  const progress = (label: string) => deps.onProgress?.(step, total, label);

  const written = zero();
  const createdDeps: { pred: string; succ: string }[] = [];
  const createdTaskIds: string[] = [];
  const createdSectionIds: string[] = [];
  const createdMilestoneIds: string[] = [];
  let projectCreated = false;
  let stage = "";

  try {
    if (plan.project) {
      stage = "プロジェクトの作成";
      progress("プロジェクトを作成中…");
      await deps.saveProject(plan.project);
      projectCreated = true;
      written.project = 1;
      step++;
    }
    stage = "グループの作成";
    for (const s of plan.sections) {
      progress(`グループを作成中…（${written.sections + 1}/${plan.sections.length}）`);
      await deps.saveProjectSection(s);
      createdSectionIds.push(s.id);
      written.sections++;
      step++;
    }
    stage = "タスクの作成";
    for (const t of plan.tasks) {
      progress(`タスクを作成中…（${written.tasks + 1}/${plan.tasks.length}）`);
      await deps.saveTask(t, { skipCascade: true });
      createdTaskIds.push(t.id);
      written.tasks++;
      step++;
    }
    stage = "親タスクのステータスの調整";
    for (const f of plan.finalStatuses) {
      progress("親タスクのステータスを調整中…");
      const cur = deps.getTask(f.taskId);
      if (cur && deps.getTaskStatus(f.taskId) !== f.status) {
        await deps.saveTask({ ...cur, status: f.status, updated_by: by }, { skipCascade: true });
      }
      step++;
    }
    stage = "先行タスクの設定";
    for (const d of plan.dependencies) {
      progress(`先行タスクを設定中…（${written.dependencies + 1}/${plan.dependencies.length}）`);
      await deps.addTaskDependency(d.predecessorTaskId, d.successorTaskId, by);
      createdDeps.push({ pred: d.predecessorTaskId, succ: d.successorTaskId });
      written.dependencies++;
      step++;
    }
    stage = "マイルストーンの作成";
    for (const m of plan.milestones) {
      progress(`マイルストーンを作成中…（${written.milestones + 1}/${plan.milestones.length}）`);
      await deps.saveMilestone(m);
      createdMilestoneIds.push(m.id);
      written.milestones++;
      step++;
    }
    return { ok: true, counts: written };
  } catch (error) {
    // 取り消し（逆順に論理削除）。1件の失敗で止めず、残った件数を数える
    const remaining = { ...written };
    const run = async (fn: () => Promise<void>, key: keyof WbsCounts) => {
      try { await fn(); remaining[key] = Math.max(0, remaining[key] - 1); } catch { /* 残件として数える */ }
    };
    for (const id of [...createdMilestoneIds].reverse()) await run(() => deps.deleteMilestone(id, by), "milestones");
    for (const d of [...createdDeps].reverse()) {
      const depId = deps.findDependencyId(d.pred, d.succ);
      if (depId) await run(() => deps.removeTaskDependency(depId, by), "dependencies");
      else remaining.dependencies = Math.max(0, remaining.dependencies - 1);
    }
    for (const id of [...createdTaskIds].reverse()) await run(() => deps.deleteTask(id, by), "tasks");
    for (const id of [...createdSectionIds].reverse()) await run(() => deps.deleteProjectSection(id, by), "sections");
    if (projectCreated && plan.project) await run(() => deps.deleteProject(plan.project!.id, by), "project");
    const left = remaining.project + remaining.sections + remaining.tasks + remaining.dependencies + remaining.milestones;
    return { ok: false, error, stage, written, rolledBack: left === 0, remaining };
  }
}
