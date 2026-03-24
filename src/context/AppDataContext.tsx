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
  useCallback, type ReactNode,
} from "react";
import type {
  Member, Objective, KeyResult, TaskForce,
  Project, Task, ProjectTaskForce,
  QuarterlyObjective, QuarterlyKeyResult, QuarterlyKrTaskForce,
  TaskTaskForce, TaskProject,
} from "../lib/localData/types";
import {
  fetchAllData,
  upsertMember, softDeleteMember,
  upsertObjective,
  upsertKeyResult, softDeleteKeyResult,
  upsertTaskForce, softDeleteTaskForce,
  upsertProject, softDeleteProject,
  upsertTask, softDeleteTask,
  insertProjectTaskForce, deleteProjectTaskForce,
  upsertQuarterlyObjective, softDeleteQuarterlyObjective,
  upsertQuarterlyKeyResult, softDeleteQuarterlyKeyResult,
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
  projects:             Project[];
  tasks:                Task[];
  projectTaskForces:    ProjectTaskForce[];
  quarterlyObjectives:    QuarterlyObjective[];
  quarterlyKeyResults:    QuarterlyKeyResult[];
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

  // QuarterlyKeyResult
  saveQuarterlyKeyResult:   (qKr: QuarterlyKeyResult) => Promise<void>;
  deleteQuarterlyKeyResult: (id: string, deletedBy: string) => Promise<void>;

  // QuarterlyKrTaskForce
  addQuarterlyKrTaskForce:    (qKrTf: QuarterlyKrTaskForce) => Promise<void>;
  removeQuarterlyKrTaskForce: (quarterlyKrId: string, tfId: string) => Promise<void>;

  // TaskTaskForce
  addTaskTaskForce:    (ttf: TaskTaskForce) => Promise<void>;
  removeTaskTaskForce: (taskId: string, tfId: string) => Promise<void>;

  // TaskProject
  addTaskProject:    (tp: TaskProject) => Promise<void>;
  removeTaskProject: (taskId: string, projectId: string) => Promise<void>;

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
  const [projects,             setProjects]             = useState<Project[]>([]);
  const [tasks,                setTasks]                = useState<Task[]>([]);
  const [projectTaskForces,    setProjectTaskForces]    = useState<ProjectTaskForce[]>([]);
  const [quarterlyObjectives,   setQuarterlyObjectives]   = useState<QuarterlyObjective[]>([]);
  const [quarterlyKeyResults,   setQuarterlyKeyResults]   = useState<QuarterlyKeyResult[]>([]);
  const [quarterlyKrTaskForces, setQuarterlyKrTaskForces] = useState<QuarterlyKrTaskForce[]>([]);
  const [taskTaskForces,        setTaskTaskForces]        = useState<TaskTaskForce[]>([]);
  const [taskProjects,          setTaskProjects]          = useState<TaskProject[]>([]);
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
      setProjects(data.projects);
      setTasks(data.tasks);
      setProjectTaskForces(data.projectTaskForces);
      setQuarterlyObjectives(data.quarterlyObjectives);
      setQuarterlyKeyResults(data.quarterlyKeyResults);
      setQuarterlyKrTaskForces(data.quarterlyKrTaskForces);
      setTaskTaskForces(data.taskTaskForces);
      setTaskProjects(data.taskProjects);
    } catch (e) {
      setError(e instanceof Error ? e.message : "データの読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

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
      await load();
      throw e;
    }
  }, [load]);

  // ===== Task =====

  const saveTask = useCallback(async (task: Task) => {
    // ステータスがdoneに変わった瞬間にcompleted_atをセット、外れたらクリア
    const existing = tasks.find(t => t.id === task.id);
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
      await load();
      throw e;
    }
  }, [load, tasks]);

  const deleteTask = useCallback(async (id: string, deletedBy: string) => {
    const now = new Date().toISOString();
    setTasks(prev => prev.map(t =>
      t.id === id ? { ...t, is_deleted: true, deleted_at: now, deleted_by: deletedBy } : t
    ));
    try {
      await softDeleteTask(id, deletedBy);
    } catch (e) {
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
      await load();
      throw e;
    }
  }, [load]);

  // ===== QuarterlyKeyResult =====

  const saveQuarterlyKeyResult = useCallback(async (qKr: QuarterlyKeyResult) => {
    setQuarterlyKeyResults(prev => {
      const idx = prev.findIndex(k => k.id === qKr.id);
      return idx >= 0
        ? prev.map(k => k.id === qKr.id ? qKr : k)
        : [...prev, qKr];
    });
    try {
      await upsertQuarterlyKeyResult(qKr);
    } catch (e) {
      await load();
      throw e;
    }
  }, [load]);

  const deleteQuarterlyKeyResult = useCallback(async (id: string, deletedBy: string) => {
    const now = new Date().toISOString();
    setQuarterlyKeyResults(prev => prev.map(k =>
      k.id === id ? { ...k, is_deleted: true, deleted_at: now, deleted_by: deletedBy } : k
    ));
    try {
      await softDeleteQuarterlyKeyResult(id, deletedBy);
    } catch (e) {
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
      await load();
      throw e;
    }
  }, [load]);

  const removeQuarterlyKrTaskForce = useCallback(async (quarterlyKrId: string, tfId: string) => {
    setQuarterlyKrTaskForces(prev =>
      prev.filter(q => !(q.quarterly_kr_id === quarterlyKrId && q.tf_id === tfId))
    );
    try {
      await deleteQuarterlyKrTaskForce(quarterlyKrId, tfId);
    } catch (e) {
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
      await load();
      throw e;
    }
  }, [load]);

  const removeTaskTaskForce = useCallback(async (taskId: string, tfId: string) => {
    setTaskTaskForces(prev => prev.filter(t => !(t.task_id === taskId && t.tf_id === tfId)));
    try {
      await deleteTaskTaskForce(taskId, tfId);
    } catch (e) {
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
      await load();
      throw e;
    }
  }, [load]);

  const removeTaskProject = useCallback(async (taskId: string, projectId: string) => {
    setTaskProjects(prev => prev.filter(t => !(t.task_id === taskId && t.project_id === projectId)));
    try {
      await deleteTaskProject(taskId, projectId);
    } catch (e) {
      await load();
      throw e;
    }
  }, [load]);

  const value: AppDataContextValue = {
    members, objective, keyResults, taskForces,
    projects, tasks, projectTaskForces,
    quarterlyObjectives, quarterlyKeyResults, quarterlyKrTaskForces,
    taskTaskForces, taskProjects,
    loading, error,
    saveMember, deleteMember,
    saveObjective,
    saveKeyResult, deleteKeyResult,
    saveTaskForce, deleteTaskForce,
    saveProject, deleteProject,
    saveTask, deleteTask,
    addProjectTaskForce, removeProjectTaskForce,
    saveQuarterlyObjective, deleteQuarterlyObjective,
    saveQuarterlyKeyResult, deleteQuarterlyKeyResult,
    addQuarterlyKrTaskForce, removeQuarterlyKrTaskForce,
    addTaskTaskForce, removeTaskTaskForce,
    addTaskProject, removeTaskProject,
    reload: load,
  };

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
