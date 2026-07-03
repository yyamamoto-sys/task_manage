// src/stores/appStore.ts
//
// 【設計意図】
// 全アプリデータの zustand ストア。Phase 5 まで完了し全コンポーネントが
// useAppStore(s => s.X) の selector ベースで購読。
//
// コンポーネントは必要な state だけを subscribe し、無関係な state 変更による
// 再レンダーは発生しない（旧 React Context 設計の致命的問題を解消）。
//
// 利用例:
//   const tasks    = useAppStore(s => s.tasks);
//   const saveTask = useAppStore(s => s.saveTask);
//
// CRUD 操作は楽観的更新パターン:
//   1. set() でローカル state を即座に更新（UI 反応速度のため）
//   2. supabase 呼び出し
//   3. 失敗時は handleSaveError → showToast + reload で整合性回復

import { create } from "zustand";
import { showToast } from "../components/common/Toast";
import { reportError } from "../lib/errorReporter";
import type {
  Group, Member, Objective, KeyResult, TaskForce, ToDo,
  Project, Task, ProjectTaskForce, Milestone,
  QuarterlyObjective, QuarterlyKrTaskForce,
  TaskTaskForce, TaskProject,
  MemberTag, MemberTagMember,
} from "../lib/localData/types";
import {
  fetchAllData,
  fetchCriticalData,
  fetchOkrData,
  fetchGroups,
  ConflictError,
  upsertGroup, softDeleteGroup,
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
  upsertMemberTag, softDeleteMemberTag, replaceMemberTagMembers,
} from "../lib/supabase/store";

export interface AppState {
  // ===== データ =====
  groups: Group[];
  currentGroupId: string | null;
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
  memberTags: MemberTag[];
  memberTagMembers: MemberTagMember[];
  loading: boolean;
  backgroundLoading: boolean;   // Phase-2（OKRデータ）取得中。メイン UI はブロックしない
  loadProgress: number;         // 現フェーズの進捗 0-100（フェーズ切替で 0 にリセット）
  loadingHint: string;          // ローディング画面の補足メッセージ（再試行中など）
  error: string | null;

  // ===== 取得 =====
  load: () => Promise<void>;
  reload: () => Promise<void>;

  // ===== Group =====
  setCurrentGroupId: (id: string | null) => void;
  saveGroup: (group: Group) => Promise<void>;
  deleteGroup: (id: string, deletedBy: string) => Promise<void>;

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

  // ===== MemberTag =====
  saveMemberTag: (tag: MemberTag, memberIds: string[]) => Promise<void>;
  deleteMemberTag: (id: string, deletedBy: string) => Promise<void>;

  // ===== Realtime（他クライアントの変更をリロードなしで反映） =====
  applyRemoteChange: (event: RealtimeChange) => void;
}

/**
 * Supabase Realtime（postgres_changes）から受け取るイベントの最小型。
 * テーブル名・イベント種別・new/old のみ使う。
 */
export type RealtimeChange = {
  table: string;
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: Record<string, unknown> | null;
  old: Record<string, unknown> | null;
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

/**
 * 配列 state 内の指定 id の要素の updated_at を、DB 書き込み後の新しい値に同期する。
 * 連続保存時に「フォーム時点 updated_at」が古いまま使われて ConflictError になるのを防ぐ。
 */
function syncUpdatedAt<T extends { id: string; updated_at?: string }>(
  list: T[],
  id: string,
  newUpdatedAt: string,
): T[] {
  return list.map(item => item.id === id ? { ...item, updated_at: newUpdatedAt } : item);
}

/**
 * load() の並列実行を防ぐフラグ（Thundering herd 対策）。
 *
 * 【設計意図】
 * realtime イベントが短時間に大量発行されると、デバウンス後でも ConflictError
 * 回復の load() が重なる場合がある。同時に複数の fetchAllData()（15 並列クエリ）
 * が走ると Supabase の接続プールを圧迫し、応答遅延やデータ不整合を引き起こす。
 *
 * 対策：
 * - _activeLoad: 現在進行中の load() Promise。非 null なら後発の load() は
 *   _pendingLoad フラグだけ立てて即リターン。
 * - _pendingLoad: 進行中に「もう1回必要」というフラグ。activeLoad 完了後に
 *   1回だけ追加実行することで、進行中に発生した変更も取りこぼさない。
 * - これにより並列実行は「現在 + 次の1回」に抑えられ、N 人同時接続でも
 *   実質 1〜2 回の fetchAllData() で済む。
 */
let _activeLoad: Promise<void> | null = null;
let _pendingLoad = false;

/**
 * タイムアウト／ネットワーク系エラーのみリトライするヘルパー。
 * - 最大 MAX_RETRIES 回（合計 MAX_RETRIES+1 試行）
 * - 指数バックオフ: 1秒 → 2秒 → 4秒
 * - タイムアウト以外（DB エラー等）は即座に再スロー
 */
const MAX_RETRIES = 3;

function isRetryable(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const msg = e.message.toLowerCase();
  return msg.includes("timeout") || msg.includes("failed to fetch") || msg.includes("network");
}

async function withRetry<T>(
  fn: () => Promise<T>,
  onRetry: (attempt: number, delaySec: number) => void,
): Promise<T> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (!isRetryable(e) || attempt === MAX_RETRIES) throw e;
      const delaySec = 2 ** attempt; // 1, 2, 4 秒
      onRetry(attempt + 1, delaySec);
      await new Promise<void>(r => setTimeout(r, delaySec * 1000));
    }
  }
  throw new Error("unreachable");
}

/**
 * 同じエンティティ id に対する保存をシリアライズするためのキュー。
 *
 * 【設計意図】
 * 同じタスク・PJ等への保存リクエストが重なると（auto-save の連打、ドラッグ&ドロップの
 * 連続、bulk 操作など）、後発の保存が読む `expectedUpdatedAt` が前発の syncUpdatedAt
 * 前の古い値になり、DB 側で先に commit された updated_at と不一致 → 100% ConflictError
 * になる自己衝突レースが発生する。
 *
 * 対策：保存処理を id ごとに直列実行する。前発の保存が完了して syncUpdatedAt が
 * 走った後に、後発の保存が `expectedUpdatedAt` を読み直して DB に投げる。
 *
 * 注：optimistic update（store.set）はキューイング対象外で即時実行する（UI 即応性を保つ）。
 * シリアライズされるのは DB 書き込みと expectedUpdatedAt の読み取り部分のみ。
 *
 * key = `${tableName}:${id}` でテーブル間で衝突しないようにする。
 */
const saveQueueByKey = new Map<string, Promise<void>>();

async function runSerializedByKey(key: string, work: () => Promise<void>): Promise<void> {
  const prev = saveQueueByKey.get(key);
  const current = (async () => {
    if (prev) await prev.catch(() => { /* 前発のエラーは独立 */ });
    await work();
  })();
  saveQueueByKey.set(key, current);
  try {
    await current;
  } finally {
    if (saveQueueByKey.get(key) === current) {
      saveQueueByKey.delete(key);
    }
  }
}

export const useAppStore = create<AppState>()((set, get) => ({
  // ===== 初期 state =====
  groups: [],
  currentGroupId: null,
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
  memberTags: [],
  memberTagMembers: [],
  loading: true,
  backgroundLoading: false,
  loadProgress: 0,
  loadingHint: "",
  error: null,

  // ===== load =====
  //
  // 【2フェーズロード — 2026-06-23】
  // Phase 1: 重要7テーブル（members/projects/tasks/milestones 等）を取得 → loading=false でUI解放
  // Phase 2: OKR系8テーブルをバックグラウンド取得 → backgroundLoading=false でトップバーを消す
  //
  // これにより「15テーブル全部揃うまで真っ白」ではなく
  // 「主要データが揃い次第すぐ表示、OKRは後から反映」になる。
  load: async () => {
    // 並列 load() を防ぐ: 進行中なら「次が必要」フラグを立てるだけ
    if (_activeLoad) {
      _pendingLoad = true;
      return;
    }
    set({ loading: true, backgroundLoading: false, loadProgress: 0, loadingHint: "", error: null });
    _activeLoad = (async () => {
      try {
        // Phase 1: メンバー・PJ・タスク・マイルストーン（7テーブル）→ UI解放
        // タイムアウト時は最大 MAX_RETRIES 回まで指数バックオフで自動リトライ
        const critical = await withRetry(
          () => {
            set({ loadingHint: "", loadProgress: 0 }); // リトライ開始時にリセット
            return fetchCriticalData((done, total) => {
              set({ loadProgress: Math.round((done / total) * 100) });
            });
          },
          (attempt, delaySec) => {
            set({
              loadProgress: 0,
              loadingHint: `接続タイムアウト — ${delaySec}秒後に再接続 (${attempt}/${MAX_RETRIES})`,
            });
          },
        );
        // groups はサイレントフェッチ（失敗してもメイン UI はブロックしない）
        let fetchedGroups: Group[] = [];
        try {
          fetchedGroups = await fetchGroups();
        } catch {
          // groups テーブル未適用環境でもアプリを起動できるよう握りつぶす
        }

        set({
          groups:           fetchedGroups,
          members:          critical.members,
          projects:         critical.projects,
          tasks:            critical.tasks,
          taskProjects:     critical.taskProjects,
          milestones:       critical.milestones,
          memberTags:       critical.memberTags,
          memberTagMembers: critical.memberTagMembers,
          loading:          false,          // ← ここでUIが表示される
          backgroundLoading: true,          // ← OKRをバックグラウンド取得中
          loadProgress:     0,              // ← Phase 2 のプログレスを 0 にリセット
          loadingHint:      "",             // ← ヒントをクリア
        });

        // Phase 2: OKR系（8テーブル）→ バックグラウンド取得
        // 失敗してもメイン UI はブロックしない（サイレントエラー）
        try {
          const okr = await fetchOkrData((done, total) => {
            set({ loadProgress: Math.round((done / total) * 100) });
          });
          set({
            objective:             okr.objectives.find(o => o.is_current) ?? okr.objectives[0] ?? null,
            keyResults:            okr.keyResults,
            taskForces:            okr.taskForces,
            todos:                 okr.todos,
            projectTaskForces:     okr.projectTaskForces,
            quarterlyObjectives:   okr.quarterlyObjectives,
            quarterlyKrTaskForces: okr.quarterlyKrTaskForces,
            taskTaskForces:        okr.taskTaskForces,
            backgroundLoading:     false,
            loadProgress:          100,
          });
        } catch {
          set({ backgroundLoading: false, loadProgress: 100 });
        }
      } catch (e) {
        const raw = e instanceof Error ? e.message : "データの読み込みに失敗しました";
        // タイムアウト系エラーは「再試行」を促すメッセージに置換（自動リトライ上限超え）
        const msg = isRetryable(e)
          ? `接続がタイムアウトしました（${MAX_RETRIES}回リトライ後）。右の「再試行」を押してください。`
          : raw;
        set({ error: msg, loading: false, backgroundLoading: false, loadProgress: 0, loadingHint: "" });
      } finally {
        _activeLoad = null;
        // 進行中に追加の変更があった場合は1回だけ追従ロード
        if (_pendingLoad) {
          _pendingLoad = false;
          get().load();
        }
      }
    })();
    await _activeLoad;
  },

  reload: async () => { await get().load(); },

  // ===== Group =====
  setCurrentGroupId: (id) => set({ currentGroupId: id }),

  saveGroup: async (group) => {
    set(state => ({
      groups: state.groups.findIndex(g => g.id === group.id) >= 0
        ? state.groups.map(g => g.id === group.id ? group : g)
        : [...state.groups, group],
    }));
    await runSerializedByKey(`groups:${group.id}`, async () => {
      const expectedUpdatedAt = get().groups.find(g => g.id === group.id)?.updated_at;
      try {
        const newUpdatedAt = await upsertGroup(group, expectedUpdatedAt);
        set(state => ({ groups: syncUpdatedAt(state.groups, group.id, newUpdatedAt) }));
      } catch (e) {
        await handleSaveError(e, get().load);
        throw e;
      }
    });
  },

  deleteGroup: async (id, deletedBy) => {
    const now = new Date().toISOString();
    set(state => ({
      groups: state.groups.map(g =>
        g.id === id ? { ...g, is_deleted: true, deleted_at: now, deleted_by: deletedBy } : g
      ),
    }));
    try {
      await softDeleteGroup(id, deletedBy);
    } catch (e) {
      await handleSaveError(e, get().load);
      throw e;
    }
  },

  // ===== Member =====
  saveMember: async (member) => {
    const memberToSave: Member = member.group_id != null
      ? member
      : { ...member, group_id: get().currentGroupId ?? undefined };
    set(state => ({
      members: state.members.findIndex(m => m.id === memberToSave.id) >= 0
        ? state.members.map(m => m.id === memberToSave.id ? memberToSave : m)
        : [...state.members, memberToSave],
    }));
    await runSerializedByKey(`members:${memberToSave.id}`, async () => {
      const expectedUpdatedAt = get().members.find(m => m.id === memberToSave.id)?.updated_at;
      try {
        const newUpdatedAt = await upsertMember(memberToSave, expectedUpdatedAt);
        set(state => ({ members: syncUpdatedAt(state.members, memberToSave.id, newUpdatedAt) }));
      } catch (e) {
        await handleSaveError(e, get().load);
        throw e;
      }
    });
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
    await runSerializedByKey(`objectives:${obj.id}`, async () => {
      const expectedUpdatedAt = get().objective?.id === obj.id ? get().objective?.updated_at : undefined;
      try {
        const newUpdatedAt = await upsertObjective(obj, expectedUpdatedAt);
        set(state => ({
          objective: state.objective?.id === obj.id
            ? { ...state.objective, updated_at: newUpdatedAt }
            : state.objective,
        }));
      } catch (e) {
        await handleSaveError(e, get().load);
        throw e;
      }
    });
  },

  // ===== KeyResult =====
  saveKeyResult: async (kr) => {
    set(state => ({
      keyResults: state.keyResults.findIndex(k => k.id === kr.id) >= 0
        ? state.keyResults.map(k => k.id === kr.id ? kr : k)
        : [...state.keyResults, kr],
    }));
    await runSerializedByKey(`key_results:${kr.id}`, async () => {
      const expectedUpdatedAt = get().keyResults.find(k => k.id === kr.id)?.updated_at;
      try {
        const newUpdatedAt = await upsertKeyResult(kr, expectedUpdatedAt);
        set(state => ({ keyResults: syncUpdatedAt(state.keyResults, kr.id, newUpdatedAt) }));
      } catch (e) {
        await handleSaveError(e, get().load);
        throw e;
      }
    });
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
    await runSerializedByKey(`task_forces:${tf.id}`, async () => {
      const expectedUpdatedAt = get().taskForces.find(t => t.id === tf.id)?.updated_at;
      try {
        const newUpdatedAt = await upsertTaskForce(tf, expectedUpdatedAt);
        set(state => ({ taskForces: syncUpdatedAt(state.taskForces, tf.id, newUpdatedAt) }));
      } catch (e) {
        await handleSaveError(e, get().load);
        throw e;
      }
    });
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
    await runSerializedByKey(`todos:${todo.id}`, async () => {
      const expectedUpdatedAt = get().todos.find(t => t.id === todo.id)?.updated_at;
      try {
        const newUpdatedAt = await upsertToDo(todo, expectedUpdatedAt);
        set(state => ({ todos: syncUpdatedAt(state.todos, todo.id, newUpdatedAt) }));
      } catch (e) {
        await handleSaveError(e, get().load);
        throw e;
      }
    });
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
    const projectToSave: Project = project.group_id != null
      ? project
      : { ...project, group_id: get().currentGroupId ?? undefined };
    set(state => ({
      projects: state.projects.findIndex(p => p.id === projectToSave.id) >= 0
        ? state.projects.map(p => p.id === projectToSave.id ? projectToSave : p)
        : [...state.projects, projectToSave],
    }));
    await runSerializedByKey(`projects:${projectToSave.id}`, async () => {
      const expectedUpdatedAt = get().projects.find(p => p.id === projectToSave.id)?.updated_at;
      try {
        const newUpdatedAt = await upsertProject(projectToSave, expectedUpdatedAt);
        set(state => ({ projects: syncUpdatedAt(state.projects, projectToSave.id, newUpdatedAt) }));
      } catch (e) {
        await handleSaveError(e, get().load);
        throw e;
      }
    });
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
    // group_id が未設定なら現在のグループを注入する
    const existing = get().tasks.find(t => t.id === task.id);
    const taskToSave0: Task = task.group_id != null
      ? task
      : { ...task, group_id: get().currentGroupId ?? undefined };
    // ステータスが done に変わった瞬間に completed_at をセット、外れたらクリア
    const taskToSave: Task = {
      ...taskToSave0,
      completed_at:
        task.status === "done"
          ? (existing?.status === "done"
              ? (task.completed_at ?? existing?.completed_at ?? new Date().toISOString())
              : new Date().toISOString())
          : null,
    };
    // 楽観更新（UI 即応性のためシリアライズ対象外）
    set(state => ({
      tasks: state.tasks.findIndex(t => t.id === taskToSave.id) >= 0
        ? state.tasks.map(t => t.id === taskToSave.id ? taskToSave : t)
        : [...state.tasks, taskToSave],
    }));
    // 同じ task id への DB 書き込みは直列化（自己衝突防止）
    await runSerializedByKey(`tasks:${taskToSave.id}`, async () => {
      // 直前の保存の syncUpdatedAt 後に expectedUpdatedAt を読む
      const current = get().tasks.find(t => t.id === taskToSave.id);
      const expectedUpdatedAt = current?.updated_at;
      try {
        const newUpdatedAt = await upsertTask(taskToSave, expectedUpdatedAt);
        set(state => ({ tasks: syncUpdatedAt(state.tasks, taskToSave.id, newUpdatedAt) }));
      } catch (e) {
        await handleSaveError(e, get().load);
        throw e;
      }
    });
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
    await runSerializedByKey(`quarterly_objectives:${qObj.id}`, async () => {
      const expectedUpdatedAt = get().quarterlyObjectives.find(q => q.id === qObj.id)?.updated_at;
      try {
        const newUpdatedAt = await upsertQuarterlyObjective(qObj, expectedUpdatedAt);
        set(state => ({
          quarterlyObjectives: syncUpdatedAt(state.quarterlyObjectives, qObj.id, newUpdatedAt),
        }));
      } catch (e) {
        await handleSaveError(e, get().load);
        throw e;
      }
    });
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
    await runSerializedByKey(`milestones:${milestone.id}`, async () => {
      const expectedUpdatedAt = get().milestones.find(m => m.id === milestone.id)?.updated_at;
      try {
        const newUpdatedAt = await upsertMilestone(milestone, expectedUpdatedAt);
        set(state => ({ milestones: syncUpdatedAt(state.milestones, milestone.id, newUpdatedAt) }));
      } catch (e) {
        await handleSaveError(e, get().load);
        throw e;
      }
    });
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

  // ===== MemberTag =====
  saveMemberTag: async (tag, memberIds) => {
    set(state => ({
      memberTags: state.memberTags.findIndex(t => t.id === tag.id) >= 0
        ? state.memberTags.map(t => t.id === tag.id ? tag : t)
        : [...state.memberTags, tag],
      memberTagMembers: [
        ...state.memberTagMembers.filter(m => m.tag_id !== tag.id),
        ...memberIds.map(member_id => ({ tag_id: tag.id, member_id })),
      ],
    }));
    await runSerializedByKey(`member_tags:${tag.id}`, async () => {
      const expectedUpdatedAt = get().memberTags.find(t => t.id === tag.id)?.updated_at;
      try {
        const newUpdatedAt = await upsertMemberTag(tag, expectedUpdatedAt);
        await replaceMemberTagMembers(tag.id, memberIds);
        set(state => ({ memberTags: syncUpdatedAt(state.memberTags, tag.id, newUpdatedAt) }));
      } catch (e) {
        await handleSaveError(e, get().load);
        throw e;
      }
    });
  },

  deleteMemberTag: async (id, deletedBy) => {
    const now = new Date().toISOString();
    set(state => ({
      memberTags: state.memberTags.map(t =>
        t.id === id ? { ...t, is_deleted: true, deleted_at: now, deleted_by: deletedBy } : t
      ),
    }));
    try {
      await softDeleteMemberTag(id, deletedBy);
    } catch (e) {
      await handleSaveError(e, get().load);
      throw e;
    }
  },

  // ===== Realtime: applyRemoteChange =====
  //
  // 【設計意図】
  // 他クライアントの DB 変更を realtime チャンネルから受け取って store に反映する。
  // 自分の楽観更新と冪等になるよう、updated_at による「手元の方が新しい場合は無視」の
  // stale チェックを入れる。中間テーブルは複合キーで matching。
  //
  // 物理削除は本アプリでは使わない（CLAUDE.md Section 4）が、念のため DELETE ハンドリング
  // を入れて中間テーブルの解除（addX/removeX 系）も反映できるようにする。
  applyRemoteChange: (event) => {
    const row = (event.new ?? event.old) as Record<string, unknown> | null;
    if (!row) return;

    set(state => {
      switch (event.table) {
        case "tasks":
          return { tasks: upsertById(state.tasks, event, row) };
        case "projects":
          return { projects: upsertById(state.projects, event, row) };
        case "todos":
          return { todos: upsertById(state.todos, event, row) };
        case "key_results":
          return { keyResults: upsertById(state.keyResults, event, row) };
        case "task_forces":
          return { taskForces: upsertById(state.taskForces, event, row) };
        case "milestones":
          return { milestones: upsertById(state.milestones, event, row) };
        case "members":
          return { members: upsertById(state.members, event, row) };
        case "task_task_forces":
          return { taskTaskForces: upsertByKeys(state.taskTaskForces, event, row, ["task_id", "tf_id"]) };
        case "task_projects":
          return { taskProjects: upsertByKeys(state.taskProjects, event, row, ["task_id", "project_id"]) };
        case "project_task_forces":
          return { projectTaskForces: upsertByKeys(state.projectTaskForces, event, row, ["project_id", "tf_id"]) };
        default:
          return state;
      }
    });
  },
}));

/**
 * id ベースの単純PKテーブル用 upsert/remove。
 * UPDATE/INSERT は配列内 id を find して replace、なければ push。
 * 楽観更新後の自分自身からのイベント受信は updated_at で no-op 化する。
 */
function upsertById<T extends { id: string; updated_at?: string }>(
  list: T[],
  event: RealtimeChange,
  row: Record<string, unknown>,
): T[] {
  const rowId = row.id as string | undefined;
  if (!rowId) return list;

  if (event.eventType === "DELETE") {
    return list.some(x => x.id === rowId) ? list.filter(x => x.id !== rowId) : list;
  }

  const idx = list.findIndex(x => x.id === rowId);
  if (idx < 0) {
    return [...list, row as unknown as T];
  }
  // stale チェック：手元の updated_at の方が新しい/同じなら no-op
  const existing = list[idx];
  const incomingUpdatedAt = row.updated_at as string | undefined;
  if (existing.updated_at && incomingUpdatedAt && existing.updated_at >= incomingUpdatedAt) {
    return list;
  }
  const next = list.slice();
  next[idx] = row as unknown as T;
  return next;
}

/**
 * 複合キーの中間テーブル用 upsert/remove。
 * 内容に updated_at がないため stale チェック不要・存在チェックのみ。
 */
function upsertByKeys<T>(
  list: T[],
  event: RealtimeChange,
  row: Record<string, unknown>,
  keys: string[],
): T[] {
  const matches = (x: T) => keys.every(k => (x as Record<string, unknown>)[k] === row[k]);

  if (event.eventType === "DELETE") {
    return list.some(matches) ? list.filter(x => !matches(x)) : list;
  }
  // INSERT/UPDATE：既に存在すれば no-op、なければ追加
  return list.some(matches) ? list : [...list, row as unknown as T];
}

// ============================================================
// 全社スーパー管理者用スコープ絞り込み selector
//
// 【設計意図】RLSがsuper-adminに全部署のmembers/projects/tasksを返すようになった
// ため（migration 20260702c）、s.tasks / s.projects を素で購読しているカンバン・
// ガント・リスト・ダッシュボード等の画面は、super-adminログイン時に全部署の
// データが混ざって表示されてしまう。currentGroupId（ログイン時に自分の所属部署
// から設定される・切替UIはまだ無い）で自分のホーム部署だけに絞り込む。
// 非super-adminには実質ノーオペ（元々RLSで自部署にしか絞られていないため
// currentGroupId と必ず一致する）。
//
// 【重要】zustand v5 は useStore(selector) の戻り値を Object.is で比較する
// （React の useSyncExternalStore 経由）。.filter() は呼ぶたびに新しい配列を
// 返すため、メモ化しないと store の状態が変わっていなくても毎回「変化した」と
// 判定され、無限レンダリングループ（React error #185: Maximum update depth
// exceeded）でアプリ全体がクラッシュする。同一の state オブジェクト（zustand は
// set() が起きない限り参照を変えない）に対しては同じ配列参照を返すようキャッシュする。
// ============================================================
function memoizeScopedSelector<T>(filterFn: (s: AppState) => T[]): (s: AppState) => T[] {
  let lastState: AppState | undefined;
  let lastResult: T[] | undefined;
  return (s: AppState) => {
    if (s === lastState && lastResult) return lastResult;
    lastState = s;
    lastResult = filterFn(s);
    return lastResult;
  };
}

export const selectScopedTasks = memoizeScopedSelector((s: AppState): Task[] =>
  s.tasks.filter(t => t.group_id == null || t.group_id === s.currentGroupId));

export const selectScopedProjects = memoizeScopedSelector((s: AppState): Project[] =>
  s.projects.filter(p => p.group_id == null || p.group_id === s.currentGroupId));
