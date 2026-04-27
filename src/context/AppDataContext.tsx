// src/context/AppDataContext.tsx
//
// 【設計意図】
// 全アプリデータをSupabaseから読み込み、コンポーネントに提供するReact Context。
// - mount時にSupabaseから全データを一括取得してstateに保持
// - 書き込み関数はstateを楽観的更新 → Supabaseに非同期書き込み
// - コンポーネントはこのContextのみを経由してデータを読み書きする
// - localStoreは使用しない

import {
  createContext, useContext, useState, useEffect,
  useCallback, useRef, useMemo, type ReactNode,
} from "react";
import { reportError } from "../lib/errorReporter";
import type {
  Member, Objective, KeyResult, TaskForce, ToDo,
  Project, Task, ProjectTaskForce, Milestone,
  QuarterlyObjective, QuarterlyKrTaskForce,
  TaskTaskForce, TaskProject,
} from "../lib/localData/types";
import { supabase } from "../lib/supabase/client";
import {
  fetchAllData,
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

// ===== Context型定義 =====

interface AppDataContextValue {
  // データ
  members:              Member[];
  objective:            Objective | null;
  keyResults:           KeyResult[];
  taskForces:           TaskForce[];
  todos:                ToDo[];
  projects:             Project[];
  tasks:                Task[];
  projectTaskForces:    ProjectTaskForce[];
  quarterlyObjectives:    QuarterlyObjective[];
  quarterlyKrTaskForces:  QuarterlyKrTaskForce[];
  taskTaskForces:         TaskTaskForce[];
  taskProjects:           TaskProject[];
  loading:              boolean;
  error:                string | null;

  // Member
  saveMember:   (member: Member) => Promise<void>;
  deleteMember: (id: string, deletedBy: string) => Promise<void>;

  // Objective
  saveObjective: (obj: Objective) => Promise<void>;

  // KeyResult
  saveKeyResult:   (kr: KeyResult) => Promise<void>;
  deleteKeyResult: (id: string, deletedBy: string) => Promise<void>;

  // TaskForce
  saveTaskForce:   (tf: TaskForce) => Promise<void>;
  deleteTaskForce: (id: string, deletedBy: string) => Promise<void>;

  // ToDo
  saveToDo:   (todo: ToDo) => Promise<void>;
  deleteToDo: (id: string, deletedBy: string) => Promise<void>;

  // Project
  saveProject:   (project: Project) => Promise<void>;
  deleteProject: (id: string, deletedBy: string) => Promise<void>;

  // Task
  saveTask:   (task: Task) => Promise<void>;
  deleteTask: (id: string, deletedBy: string) => Promise<void>;

  // ProjectTaskForce
  addProjectTaskForce:    (ptf: ProjectTaskForce) => Promise<void>;
  removeProjectTaskForce: (projectId: string, tfId: string) => Promise<void>;

  // QuarterlyObjective
  saveQuarterlyObjective:   (qObj: QuarterlyObjective) => Promise<void>;
  deleteQuarterlyObjective: (id: string, deletedBy: string) => Promise<void>;

  // QuarterlyKrTaskForce
  addQuarterlyKrTaskForce:    (qKrTf: QuarterlyKrTaskForce) => Promise<void>;
  removeQuarterlyKrTaskForce: (quarterlyObjId: string, krId: string, tfId: string) => Promise<void>;

  // TaskTaskForce
  addTaskTaskForce:    (ttf: TaskTaskForce) => Promise<void>;
  removeTaskTaskForce: (taskId: string, tfId: string) => Promise<void>;

  // TaskProject
  addTaskProject:    (tp: TaskProject) => Promise<void>;
  removeTaskProject: (taskId: string, projectId: string) => Promise<void>;

  // Milestone
  milestones:        Milestone[];
  saveMilestone:     (milestone: Milestone) => Promise<void>;
  deleteMilestone:   (id: string, deletedBy: string) => Promise<void>;

  // ユーティリティ
  reload: () => Promise<void>;
}

// ===== Context作成 =====

const AppDataContext = createContext<AppDataContextValue | null>(null);

// ===== Provider =====

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [members,              setMembers]              = useState<Member[]>([]);
  const [objective,            setObjective]            = useState<Objective | null>(null);
  const [keyResults,           setKeyResults]           = useState<KeyResult[]>([]);
  const [taskForces,           setTaskForces]           = useState<TaskForce[]>([]);
  const [todos,                setTodos]                = useState<ToDo[]>([]);
  const [projects,             setProjects]             = useState<Project[]>([]);
  const [tasks,                setTasks]                = useState<Task[]>([]);
  const tasksRef = useRef<Task[]>([]); // saveTask内でtasksを参照するためのref（依存配列に入れない）
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);
  const [projectTaskForces,    setProjectTaskForces]    = useState<ProjectTaskForce[]>([]);
  const [quarterlyObjectives,   setQuarterlyObjectives]   = useState<QuarterlyObjective[]>([]);
  const [quarterlyKrTaskForces, setQuarterlyKrTaskForces] = useState<QuarterlyKrTaskForce[]>([]);
  const [taskTaskForces,        setTaskTaskForces]        = useState<TaskTaskForce[]>([]);
  const [taskProjects,          setTaskProjects]          = useState<TaskProject[]>([]);
  const [milestones,            setMilestones]            = useState<Milestone[]>([]);
  const [loading,              setLoading]              = useState(true);
  const [error,                setError]                = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAllData();
      setMembers(data.members);
      setObjective(data.objectives.find(o => o.is_current) ?? data.objectives[0] ?? null);
      setKeyResults(data.keyResults);
      setTaskForces(data.taskForces);
      setTodos(data.todos);
      setProjects(data.projects);
      setTasks(data.tasks);
      setProjectTaskForces(data.projectTaskForces);
      setQuarterlyObjectives(data.quarterlyObjectives);
      setQuarterlyKrTaskForces(data.quarterlyKrTaskForces);
      setTaskTaskForces(data.taskTaskForces);
      setTaskProjects(data.taskProjects);
      setMilestones(data.milestones);
    } catch (e) {
      setError(e instanceof Error ? e.message : "データの読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Supabase realtime: tasks / projects テーブルへの外部書き込みを検知して再取得
  useEffect(() => {
    const channel = supabase
      .channel("app-data-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "projects" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  // ===== Member =====

  const saveMember = useCallback(async (member: Member) => {
    setMembers(prev => {
      const idx = prev.findIndex(m => m.id === member.id);
      return idx >= 0
        ? prev.map(m => m.id === member.id ? member : m)
        : [...prev, member];
    });
    try {
      await upsertMember(member);
    } catch (e) {
      reportError(e);
      await load();
      throw e;
    }
  }, [load]);

  const deleteMember = useCallback(async (id: string, deletedBy: string) => {
    const now = new Date().toISOString();
    setMembers(prev => prev.map(m =>
      m.id === id ? { ...m, is_deleted: true, deleted_at: now, deleted_by: deletedBy } : m
    ));
    try {
      await softDeleteMember(id, deletedBy);
    } catch (e) {
      reportError(e);
      await load();
      throw e;
    }
  }, [load]);

  // ===== Objective =====

  const saveObjective = useCallback(async (obj: Objective) => {
    setObjective(obj);
    try {
      await upsertObjective(obj);
    } catch (e) {
      reportError(e);
      await load();
      throw e;
    }
  }, [load]);

  // ===== KeyResult =====

  const saveKeyResult = useCallback(async (kr: KeyResult) => {
    setKeyResults(prev => {
      const idx = prev.findIndex(k => k.id === kr.id);
      return idx >= 0
        ? prev.map(k => k.id === kr.id ? kr : k)
        : [...prev, kr];
    });
    try {
      await upsertKeyResult(kr);
    } catch (e) {
      reportError(e);
      await load();
      throw e;
    }
  }, [load]);

  const deleteKeyResult = useCallback(async (id: string, deletedBy: string) => {
    const now = new Date().toISOString();
    setKeyResults(prev => prev.map(k =>
      k.id === id ? { ...k, is_deleted: true, deleted_at: now, deleted_by: deletedBy } : k
    ));
    try {
      await softDeleteKeyResult(id, deletedBy);
    } catch (e) {
      reportError(e);
      await load();
      throw e;
    }
  }, [load]);

  // ===== TaskForce =====

  const saveTaskForce = useCallback(async (tf: TaskForce) => {
    setTaskForces(prev => {
      const idx = prev.findIndex(t => t.id === tf.id);
      return idx >= 0
        ? prev.map(t => t.id === tf.id ? tf : t)
        : [...prev, tf];
    });
    try {
      await upsertTaskForce(tf);
    } catch (e) {
      reportError(e);
      await load();
      throw e;
    }
  }, [load]);

  const deleteTaskForce = useCallback(async (id: string, deletedBy: string) => {
    const now = new Date().toISOString();
    setTaskForces(prev => prev.map(t =>
      t.id === id ? { ...t, is_deleted: true, deleted_at: now, deleted_by: deletedBy } : t
    ));
    try {
      await softDeleteTaskForce(id, deletedBy);
    } catch (e) {
      reportError(e);
      await load();
      throw e;
    }
  }, [load]);

  // ===== ToDo =====

  const saveToDo = useCallback(async (todo: ToDo) => {
    setTodos(prev => {
      const idx = prev.findIndex(t => t.id === todo.id);
      return idx >= 0
        ? prev.map(t => t.id === todo.id ? todo : t)
        : [...prev, todo];
    });
    try {
      await upsertToDo(todo);
    } catch (e) {
      reportError(e);
      await load();
      throw e;
    }
  }, [load]);

  const deleteToDo = useCallback(async (id: string, deletedBy: string) => {
    const now = new Date().toISOString();
    setTodos(prev => prev.map(t =>
      t.id === id ? { ...t, is_deleted: true, deleted_at: now, deleted_by: deletedBy } : t
    ));
    try {
      await softDeleteToDo(id, deletedBy);
    } catch (e) {
      reportError(e);
      await load();
      throw e;
    }
  }, [load]);

  // ===== Project =====

  const saveProject = useCallback(async (project: Project) => {
    setProjects(prev => {
      const idx = prev.findIndex(p => p.id === project.id);
      return idx >= 0
        ? prev.map(p => p.id === project.id ? project : p)
        : [...prev, project];
    });
    try {
      await upsertProject(project);
    } catch (e) {
      reportError(e);
      await load();
      throw e;
    }
  }, [load]);

  const deleteProject = useCallback(async (id: string, deletedBy: string) => {
    const now = new Date().toISOString();
    setProjects(prev => prev.map(p =>
      p.id === id ? { ...p, is_deleted: true, deleted_at: now, deleted_by: deletedBy } : p
    ));
    try {
      await softDeleteProject(id, deletedBy);
    } catch (e) {
      reportError(e);
      await load();
      throw e;
    }
  }, [load]);

  // ===== Task =====

  const saveTask = useCallback(async (task: Task) => {
    // ステータスがdoneに変わった瞬間にcompleted_atをセット、外れたらクリア
    // tasksRefを使うことでtasksを依存配列に入れず、不要な再生成を防ぐ
    const existing = tasksRef.current.find(t => t.id === task.id);
    const taskToSave: Task = {
      ...task,
      completed_at:
        task.status === "done"
          ? (existing?.status === "done" ? (task.completed_at ?? existing?.completed_at ?? new Date().toISOString()) : new Date().toISOString())
          : null,
    };
    setTasks(prev => {
      const idx = prev.findIndex(t => t.id === taskToSave.id);
      return idx >= 0
        ? prev.map(t => t.id === taskToSave.id ? taskToSave : t)
        : [...prev, taskToSave];
    });
    try {
      await upsertTask(taskToSave);
    } catch (e) {
      reportError(e);
      await load();
      throw e;
    }
  }, [load]);

  const deleteTask = useCallback(async (id: string, deletedBy: string) => {
    const now = new Date().toISOString();
    setTasks(prev => prev.map(t =>
      t.id === id ? { ...t, is_deleted: true, deleted_at: now, deleted_by: deletedBy } : t
    ));
    try {
      await softDeleteTask(id, deletedBy);
    } catch (e) {
      reportError(e);
      await load();
      throw e;
    }
  }, [load]);

  // ===== ProjectTaskForce =====

  const addProjectTaskForce = useCallback(async (ptf: ProjectTaskForce) => {
    setProjectTaskForces(prev => [...prev, ptf]);
    try {
      await insertProjectTaskForce(ptf);
    } catch (e) {
      reportError(e);
      await load();
      throw e;
    }
  }, [load]);

  const removeProjectTaskForce = useCallback(async (projectId: string, tfId: string) => {
    setProjectTaskForces(prev =>
      prev.filter(p => !(p.project_id === projectId && p.tf_id === tfId))
    );
    try {
      await deleteProjectTaskForce(projectId, tfId);
    } catch (e) {
      reportError(e);
      await load();
      throw e;
    }
  }, [load]);

  // ===== QuarterlyObjective =====

  const saveQuarterlyObjective = useCallback(async (qObj: QuarterlyObjective) => {
    setQuarterlyObjectives(prev => {
      const idx = prev.findIndex(q => q.id === qObj.id);
      return idx >= 0
        ? prev.map(q => q.id === qObj.id ? qObj : q)
        : [...prev, qObj];
    });
    try {
      await upsertQuarterlyObjective(qObj);
    } catch (e) {
      reportError(e);
      await load();
      throw e;
    }
  }, [load]);

  const deleteQuarterlyObjective = useCallback(async (id: string, deletedBy: string) => {
    const now = new Date().toISOString();
    setQuarterlyObjectives(prev => prev.map(q =>
      q.id === id ? { ...q, is_deleted: true, deleted_at: now, deleted_by: deletedBy } : q
    ));
    try {
      await softDeleteQuarterlyObjective(id, deletedBy);
    } catch (e) {
      reportError(e);
      await load();
      throw e;
    }
  }, [load]);

  // ===== QuarterlyKrTaskForce =====

  const addQuarterlyKrTaskForce = useCallback(async (qKrTf: QuarterlyKrTaskForce) => {
    setQuarterlyKrTaskForces(prev => [...prev, qKrTf]);
    try {
      await insertQuarterlyKrTaskForce(qKrTf);
    } catch (e) {
      reportError(e);
      await load();
      throw e;
    }
  }, [load]);

  const removeQuarterlyKrTaskForce = useCallback(async (quarterlyObjId: string, krId: string, tfId: string) => {
    setQuarterlyKrTaskForces(prev =>
      prev.filter(q => !(q.quarterly_objective_id === quarterlyObjId && q.kr_id === krId && q.tf_id === tfId))
    );
    try {
      await deleteQuarterlyKrTaskForce(quarterlyObjId, krId, tfId);
    } catch (e) {
      reportError(e);
      await load();
      throw e;
    }
  }, [load]);

  // ===== TaskTaskForce =====

  const addTaskTaskForce = useCallback(async (ttf: TaskTaskForce) => {
    setTaskTaskForces(prev => [...prev, ttf]);
    try {
      await insertTaskTaskForce(ttf);
    } catch (e) {
      reportError(e);
      await load();
      throw e;
    }
  }, [load]);

  const removeTaskTaskForce = useCallback(async (taskId: string, tfId: string) => {
    setTaskTaskForces(prev => prev.filter(t => !(t.task_id === taskId && t.tf_id === tfId)));
    try {
      await deleteTaskTaskForce(taskId, tfId);
    } catch (e) {
      reportError(e);
      await load();
      throw e;
    }
  }, [load]);

  // ===== Milestone =====

  const saveMilestone = useCallback(async (milestone: Milestone) => {
    setMilestones(prev => {
      const idx = prev.findIndex(m => m.id === milestone.id);
      return idx >= 0
        ? prev.map(m => m.id === milestone.id ? milestone : m)
        : [...prev, milestone];
    });
    try {
      await upsertMilestone(milestone);
    } catch (e) {
      reportError(e);
      await load();
      throw e;
    }
  }, [load]);

  const deleteMilestone = useCallback(async (id: string, deletedBy: string) => {
    const now = new Date().toISOString();
    setMilestones(prev => prev.map(m =>
      m.id === id ? { ...m, is_deleted: true, deleted_at: now, deleted_by: deletedBy } : m
    ));
    try {
      await softDeleteMilestone(id, deletedBy);
    } catch (e) {
      reportError(e);
      await load();
      throw e;
    }
  }, [load]);

  // ===== TaskProject =====

  const addTaskProject = useCallback(async (tp: TaskProject) => {
    setTaskProjects(prev => [...prev, tp]);
    try {
      await insertTaskProject(tp);
    } catch (e) {
      reportError(e);
      await load();
      throw e;
    }
  }, [load]);

  const removeTaskProject = useCallback(async (taskId: string, projectId: string) => {
    setTaskProjects(prev => prev.filter(t => !(t.task_id === taskId && t.project_id === projectId)));
    try {
      await deleteTaskProject(taskId, projectId);
    } catch (e) {
      reportError(e);
      await load();
      throw e;
    }
  }, [load]);

  const value: AppDataContextValue = useMemo(() => ({
    members, objective, keyResults, taskForces, todos,
    projects, tasks, projectTaskForces,
    quarterlyObjectives, quarterlyKrTaskForces,
    taskTaskForces, taskProjects,
    loading, error,
    saveMember, deleteMember,
    saveObjective,
    saveKeyResult, deleteKeyResult,
    saveTaskForce, deleteTaskForce,
    saveToDo, deleteToDo,
    saveProject, deleteProject,
    saveTask, deleteTask,
    addProjectTaskForce, removeProjectTaskForce,
    saveQuarterlyObjective, deleteQuarterlyObjective,
    addQuarterlyKrTaskForce, removeQuarterlyKrTaskForce,
    addTaskTaskForce, removeTaskTaskForce,
    addTaskProject, removeTaskProject,
    milestones, saveMilestone, deleteMilestone,
    reload: load,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [
    members, objective, keyResults, taskForces, todos,
    projects, tasks, projectTaskForces,
    quarterlyObjectives, quarterlyKrTaskForces,
    taskTaskForces, taskProjects,
    loading, error,
  ]);

  return (
    <AppDataContext.Provider value={value}>
      {children}
    </AppDataContext.Provider>
  );
}

// ===== カスタムフック =====

export function useAppData(): AppDataContextValue {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error("useAppData must be used within AppDataProvider");
  return ctx;
}
