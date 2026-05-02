// src/stores/appStore.ts
//
// 【設計意図】
// 全アプリデータの zustand ストア。React Context から段階的移行中（Phase 1）。
//
// AppDataContext から作業を移し、コンポーネントは将来的に
//   const tasks = useAppStore(s => s.tasks);
// のような selector 形式に書き換えると、必要な部分だけが再レンダーされる。
//
// 移行期間中は AppDataContext.tsx の useAppData() がこのストアを wrap して
// 既存の API 互換性を保つ（Phase 1 では挙動・パフォーマンス共に変化なし）。
//
// CRUD 操作は楽観的更新パターン:
//   1. set() でローカル state を即座に更新（UI 反応速度のため）
//   2. supabase 呼び出し
//   3. 失敗時は handleSaveError → showToast + reload で整合性回復

import { create } from "zustand";
import { showToast } from "../components/common/Toast";
import { reportError } from "../lib/errorReporter";
import type {
  Member, Objective, KeyResult, TaskForce, ToDo,
  Project, Task, ProjectTaskForce, Milestone,
  QuarterlyObjective, QuarterlyKrTaskForce,
  TaskTaskForce, TaskProject,
} from "../lib/localData/types";
import {
  fetchAllData,
  ConflictError,
  upsertMember, softDeleteMember,
  upsertObjective,
  upsertKeyResult, softDeleteKeyResult,
  upsertTaskForce, softDeleteTaskForce,
  upsertToDo, softDeleteToDo,
  upsertProject, softDeleteProject,
  upsertTask, softDeleteTask,
  upsertMilestone, softDeleteMilestone,
  insertProjectTaskForce, deleteProjectTaskForce,
  upsertQuarterlyObjective, softDeleteQuarterlyObjective,
  insertQuarterlyKrTaskForce, deleteQuarterlyKrTaskForce,
  insertTaskTaskForce, deleteTaskTaskForce,
  insertTaskProject, deleteTaskProject,
} from "../lib/supabase/store";

export interface AppState {
  // ===== データ =====
  members: Member[];
  objective: Objective | null;
  keyResults: KeyResult[];
  taskForces: TaskForce[];
  todos: ToDo[];
  projects: Project[];
  tasks: Task[];
  projectTaskForces: ProjectTaskForce[];
  quarterlyObjectives: QuarterlyObjective[];
  quarterlyKrTaskForces: QuarterlyKrTaskForce[];
  taskTaskForces: TaskTaskForce[];
  taskProjects: TaskProject[];
  milestones: Milestone[];
  loading: boolean;
  error: string | null;

  // ===== 取得 =====
  load: () => Promise<void>;
  reload: () => Promise<void>;

  // ===== Member =====
  saveMember: (member: Member) => Promise<void>;
  deleteMember: (id: string, deletedBy: string) => Promise<void>;

  // ===== Objective =====
  saveObjective: (obj: Objective) => Promise<void>;

  // ===== KeyResult =====
  saveKeyResult: (kr: KeyResult) => Promise<void>;
  deleteKeyResult: (id: string, deletedBy: string) => Promise<void>;

  // ===== TaskForce =====
  saveTaskForce: (tf: TaskForce) => Promise<void>;
  deleteTaskForce: (id: string, deletedBy: string) => Promise<void>;

  // ===== ToDo =====
  saveToDo: (todo: ToDo) => Promise<void>;
  deleteToDo: (id: string, deletedBy: string) => Promise<void>;

  // ===== Project =====
  saveProject: (project: Project) => Promise<void>;
  deleteProject: (id: string, deletedBy: string) => Promise<void>;

  // ===== Task =====
  saveTask: (task: Task) => Promise<void>;
  deleteTask: (id: string, deletedBy: string) => Promise<void>;

  // ===== ProjectTaskForce =====
  addProjectTaskForce: (ptf: ProjectTaskForce) => Promise<void>;
  removeProjectTaskForce: (projectId: string, tfId: string) => Promise<void>;

  // ===== QuarterlyObjective =====
  saveQuarterlyObjective: (qObj: QuarterlyObjective) => Promise<void>;
  deleteQuarterlyObjective: (id: string, deletedBy: string) => Promise<void>;

  // ===== QuarterlyKrTaskForce =====
  addQuarterlyKrTaskForce: (qKrTf: QuarterlyKrTaskForce) => Promise<void>;
  removeQuarterlyKrTaskForce: (quarterlyObjId: string, krId: string, tfId: string) => Promise<void>;

  // ===== TaskTaskForce =====
  addTaskTaskForce: (ttf: TaskTaskForce) => Promise<void>;
  removeTaskTaskForce: (taskId: string, tfId: string) => Promise<void>;

  // ===== TaskProject =====
  addTaskProject: (tp: TaskProject) => Promise<void>;
  removeTaskProject: (taskId: string, projectId: string) => Promise<void>;

  // ===== Milestone =====
  saveMilestone: (milestone: Milestone) => Promise<void>;
  deleteMilestone: (id: string, deletedBy: string) => Promise<void>;
}

/**
 * 楽観的更新失敗時の共通ハンドラ。
 * - ConflictError は他者の先行更新（CLAUDE.md Section 5）→ 専用トースト
 * - その他のエラーは一般トースト
 * - いずれの場合も load() で楽観更新前の最新状態に戻し一貫性を回復
 */
async function handleSaveError(
  e: unknown,
  load: () => Promise<void>,
): Promise<void> {
  if (e instanceof ConflictError) {
    showToast("他のメンバーが先に編集していたため、最新の内容に戻しました。再度編集して保存してください。", "error");
  } else {
    const msg = e instanceof Error ? e.message : "不明なエラー";
    showToast(`保存に失敗しました: ${msg}`, "error");
  }
  reportError(e);
  await load();
}

export const useAppStore = create<AppState>()((set, get) => ({
  // ===== 初期 state =====
  members: [],
  objective: null,
  keyResults: [],
  taskForces: [],
  todos: [],
  projects: [],
  tasks: [],
  projectTaskForces: [],
  quarterlyObjectives: [],
  quarterlyKrTaskForces: [],
  taskTaskForces: [],
  taskProjects: [],
  milestones: [],
  loading: true,
  error: null,

  // ===== load =====
  load: async () => {
    set({ loading: true, error: null });
    try {
      const data = await fetchAllData();
      set({
        members: data.members,
        objective: data.objectives.find(o => o.is_current) ?? data.objectives[0] ?? null,
        keyResults: data.keyResults,
        taskForces: data.taskForces,
        todos: data.todos,
        projects: data.projects,
        tasks: data.tasks,
        projectTaskForces: data.projectTaskForces,
        quarterlyObjectives: data.quarterlyObjectives,
        quarterlyKrTaskForces: data.quarterlyKrTaskForces,
        taskTaskForces: data.taskTaskForces,
        taskProjects: data.taskProjects,
        milestones: data.milestones,
        loading: false,
      });
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : "データの読み込みに失敗しました",
        loading: false,
      });
    }
  },

  reload: async () => { await get().load(); },

  // ===== Member =====
  saveMember: async (member) => {
    set(state => ({
      members: state.members.findIndex(m => m.id === member.id) >= 0
        ? state.members.map(m => m.id === member.id ? member : m)
        : [...state.members, member],
    }));
    try {
      await upsertMember(member);
    } catch (e) {
      await handleSaveError(e, get().load);
      throw e;
    }
  },

  deleteMember: async (id, deletedBy) => {
    const now = new Date().toISOString();
    set(state => ({
      members: state.members.map(m =>
        m.id === id ? { ...m, is_deleted: true, deleted_at: now, deleted_by: deletedBy } : m
      ),
    }));
    try {
      await softDeleteMember(id, deletedBy);
    } catch (e) {
      await handleSaveError(e, get().load);
      throw e;
    }
  },

  // ===== Objective =====
  saveObjective: async (obj) => {
    set({ objective: obj });
    try {
      await upsertObjective(obj);
    } catch (e) {
      await handleSaveError(e, get().load);
      throw e;
    }
  },

  // ===== KeyResult =====
  saveKeyResult: async (kr) => {
    set(state => ({
      keyResults: state.keyResults.findIndex(k => k.id === kr.id) >= 0
        ? state.keyResults.map(k => k.id === kr.id ? kr : k)
        : [...state.keyResults, kr],
    }));
    try {
      await upsertKeyResult(kr);
    } catch (e) {
      await handleSaveError(e, get().load);
      throw e;
    }
  },

  deleteKeyResult: async (id, deletedBy) => {
    const now = new Date().toISOString();
    set(state => ({
      keyResults: state.keyResults.map(k =>
        k.id === id ? { ...k, is_deleted: true, deleted_at: now, deleted_by: deletedBy } : k
      ),
    }));
    try {
      await softDeleteKeyResult(id, deletedBy);
    } catch (e) {
      await handleSaveError(e, get().load);
      throw e;
    }
  },

  // ===== TaskForce =====
  saveTaskForce: async (tf) => {
    set(state => ({
      taskForces: state.taskForces.findIndex(t => t.id === tf.id) >= 0
        ? state.taskForces.map(t => t.id === tf.id ? tf : t)
        : [...state.taskForces, tf],
    }));
    try {
      await upsertTaskForce(tf);
    } catch (e) {
      await handleSaveError(e, get().load);
      throw e;
    }
  },

  deleteTaskForce: async (id, deletedBy) => {
    const now = new Date().toISOString();
    set(state => ({
      taskForces: state.taskForces.map(t =>
        t.id === id ? { ...t, is_deleted: true, deleted_at: now, deleted_by: deletedBy } : t
      ),
    }));
    try {
      await softDeleteTaskForce(id, deletedBy);
    } catch (e) {
      await handleSaveError(e, get().load);
      throw e;
    }
  },

  // ===== ToDo =====
  saveToDo: async (todo) => {
    set(state => ({
      todos: state.todos.findIndex(t => t.id === todo.id) >= 0
        ? state.todos.map(t => t.id === todo.id ? todo : t)
        : [...state.todos, todo],
    }));
    try {
      await upsertToDo(todo);
    } catch (e) {
      await handleSaveError(e, get().load);
      throw e;
    }
  },

  deleteToDo: async (id, deletedBy) => {
    const now = new Date().toISOString();
    set(state => ({
      todos: state.todos.map(t =>
        t.id === id ? { ...t, is_deleted: true, deleted_at: now, deleted_by: deletedBy } : t
      ),
    }));
    try {
      await softDeleteToDo(id, deletedBy);
    } catch (e) {
      await handleSaveError(e, get().load);
      throw e;
    }
  },

  // ===== Project =====
  saveProject: async (project) => {
    set(state => ({
      projects: state.projects.findIndex(p => p.id === project.id) >= 0
        ? state.projects.map(p => p.id === project.id ? project : p)
        : [...state.projects, project],
    }));
    try {
      await upsertProject(project);
    } catch (e) {
      await handleSaveError(e, get().load);
      throw e;
    }
  },

  deleteProject: async (id, deletedBy) => {
    const now = new Date().toISOString();
    set(state => ({
      projects: state.projects.map(p =>
        p.id === id ? { ...p, is_deleted: true, deleted_at: now, deleted_by: deletedBy } : p
      ),
    }));
    try {
      await softDeleteProject(id, deletedBy);
    } catch (e) {
      await handleSaveError(e, get().load);
      throw e;
    }
  },

  // ===== Task =====
  saveTask: async (task) => {
    // ステータスが done に変わった瞬間に completed_at をセット、外れたらクリア
    // get().tasks で最新 state を参照（旧コードの tasksRef 相当）
    const existing = get().tasks.find(t => t.id === task.id);
    const taskToSave: Task = {
      ...task,
      completed_at:
        task.status === "done"
          ? (existing?.status === "done"
              ? (task.completed_at ?? existing?.completed_at ?? new Date().toISOString())
              : new Date().toISOString())
          : null,
    };
    set(state => ({
      tasks: state.tasks.findIndex(t => t.id === taskToSave.id) >= 0
        ? state.tasks.map(t => t.id === taskToSave.id ? taskToSave : t)
        : [...state.tasks, taskToSave],
    }));
    try {
      await upsertTask(taskToSave);
    } catch (e) {
      await handleSaveError(e, get().load);
      throw e;
    }
  },

  deleteTask: async (id, deletedBy) => {
    const now = new Date().toISOString();
    set(state => ({
      tasks: state.tasks.map(t =>
        t.id === id ? { ...t, is_deleted: true, deleted_at: now, deleted_by: deletedBy } : t
      ),
    }));
    try {
      await softDeleteTask(id, deletedBy);
    } catch (e) {
      await handleSaveError(e, get().load);
      throw e;
    }
  },

  // ===== ProjectTaskForce =====
  addProjectTaskForce: async (ptf) => {
    set(state => ({ projectTaskForces: [...state.projectTaskForces, ptf] }));
    try {
      await insertProjectTaskForce(ptf);
    } catch (e) {
      await handleSaveError(e, get().load);
      throw e;
    }
  },

  removeProjectTaskForce: async (projectId, tfId) => {
    set(state => ({
      projectTaskForces: state.projectTaskForces.filter(
        p => !(p.project_id === projectId && p.tf_id === tfId)
      ),
    }));
    try {
      await deleteProjectTaskForce(projectId, tfId);
    } catch (e) {
      await handleSaveError(e, get().load);
      throw e;
    }
  },

  // ===== QuarterlyObjective =====
  saveQuarterlyObjective: async (qObj) => {
    set(state => ({
      quarterlyObjectives: state.quarterlyObjectives.findIndex(q => q.id === qObj.id) >= 0
        ? state.quarterlyObjectives.map(q => q.id === qObj.id ? qObj : q)
        : [...state.quarterlyObjectives, qObj],
    }));
    try {
      await upsertQuarterlyObjective(qObj);
    } catch (e) {
      await handleSaveError(e, get().load);
      throw e;
    }
  },

  deleteQuarterlyObjective: async (id, deletedBy) => {
    const now = new Date().toISOString();
    set(state => ({
      quarterlyObjectives: state.quarterlyObjectives.map(q =>
        q.id === id ? { ...q, is_deleted: true, deleted_at: now, deleted_by: deletedBy } : q
      ),
    }));
    try {
      await softDeleteQuarterlyObjective(id, deletedBy);
    } catch (e) {
      await handleSaveError(e, get().load);
      throw e;
    }
  },

  // ===== QuarterlyKrTaskForce =====
  addQuarterlyKrTaskForce: async (qKrTf) => {
    set(state => ({ quarterlyKrTaskForces: [...state.quarterlyKrTaskForces, qKrTf] }));
    try {
      await insertQuarterlyKrTaskForce(qKrTf);
    } catch (e) {
      await handleSaveError(e, get().load);
      throw e;
    }
  },

  removeQuarterlyKrTaskForce: async (quarterlyObjId, krId, tfId) => {
    set(state => ({
      quarterlyKrTaskForces: state.quarterlyKrTaskForces.filter(
        q => !(q.quarterly_objective_id === quarterlyObjId && q.kr_id === krId && q.tf_id === tfId)
      ),
    }));
    try {
      await deleteQuarterlyKrTaskForce(quarterlyObjId, krId, tfId);
    } catch (e) {
      await handleSaveError(e, get().load);
      throw e;
    }
  },

  // ===== TaskTaskForce =====
  addTaskTaskForce: async (ttf) => {
    set(state => ({ taskTaskForces: [...state.taskTaskForces, ttf] }));
    try {
      await insertTaskTaskForce(ttf);
    } catch (e) {
      await handleSaveError(e, get().load);
      throw e;
    }
  },

  removeTaskTaskForce: async (taskId, tfId) => {
    set(state => ({
      taskTaskForces: state.taskTaskForces.filter(
        t => !(t.task_id === taskId && t.tf_id === tfId)
      ),
    }));
    try {
      await deleteTaskTaskForce(taskId, tfId);
    } catch (e) {
      await handleSaveError(e, get().load);
      throw e;
    }
  },

  // ===== TaskProject =====
  addTaskProject: async (tp) => {
    set(state => ({ taskProjects: [...state.taskProjects, tp] }));
    try {
      await insertTaskProject(tp);
    } catch (e) {
      await handleSaveError(e, get().load);
      throw e;
    }
  },

  removeTaskProject: async (taskId, projectId) => {
    set(state => ({
      taskProjects: state.taskProjects.filter(
        t => !(t.task_id === taskId && t.project_id === projectId)
      ),
    }));
    try {
      await deleteTaskProject(taskId, projectId);
    } catch (e) {
      await handleSaveError(e, get().load);
      throw e;
    }
  },

  // ===== Milestone =====
  saveMilestone: async (milestone) => {
    set(state => ({
      milestones: state.milestones.findIndex(m => m.id === milestone.id) >= 0
        ? state.milestones.map(m => m.id === milestone.id ? milestone : m)
        : [...state.milestones, milestone],
    }));
    try {
      await upsertMilestone(milestone);
    } catch (e) {
      await handleSaveError(e, get().load);
      throw e;
    }
  },

  deleteMilestone: async (id, deletedBy) => {
    const now = new Date().toISOString();
    set(state => ({
      milestones: state.milestones.map(m =>
        m.id === id ? { ...m, is_deleted: true, deleted_at: now, deleted_by: deletedBy } : m
      ),
    }));
    try {
      await softDeleteMilestone(id, deletedBy);
    } catch (e) {
      await handleSaveError(e, get().load);
      throw e;
    }
  },
}));
