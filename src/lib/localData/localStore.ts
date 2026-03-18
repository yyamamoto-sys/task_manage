// src/lib/localData/localStore.ts
//
// 【設計意図】
// Supabase承認前の暫定ストレージ。
// SupabaseClientと同じインターフェースを持つように設計し、
// Supabase移行時はこのファイルを削除するだけで済むようにする。
//
// データはlocalStorageに保存する。
// ブラウザを閉じてもデータが消えない。
// 複数メンバーが同時に使う場合はデータが共有されないため、
// Supabase移行後に初めてマルチユーザー対応になる。
//
// ⚠ localStorageの容量は5MB程度。大量データは入れないこと。
//
// 使い方：
//   import { localStore } from "./localStore";
//   const members = localStore.get("members");
//   localStore.set("members", updatedMembers);

import {
  SEED_MEMBERS,
  SEED_OBJECTIVE,
  SEED_KEY_RESULTS,
  SEED_TASK_FORCES,
  SEED_PROJECTS,
  SEED_TASKS,
  SEED_PROJECT_TASK_FORCES,
} from "./seed";

// ===== キー定義 =====

const KEYS = {
  INITIALIZED: "app_initialized",
  WIZARD_COMPLETED: "wizard_completed",
  MEMBERS: "members",
  OBJECTIVE: "objective",
  KEY_RESULTS: "key_results",
  TASK_FORCES: "task_forces",
  PROJECT_TASK_FORCES: "project_task_forces",
  PROJECTS: "projects",
  TASKS: "tasks",
  CURRENT_USER: "current_user", // ログイン中のmember_id
} as const;

// ===== 初期化（初回のみシードデータを投入）=====

export function initializeLocalStore(): void {
  if (localStorage.getItem(KEYS.INITIALIZED)) return;

  localStorage.setItem(KEYS.MEMBERS, JSON.stringify(SEED_MEMBERS));
  localStorage.setItem(KEYS.OBJECTIVE, JSON.stringify(SEED_OBJECTIVE));
  localStorage.setItem(KEYS.KEY_RESULTS, JSON.stringify(SEED_KEY_RESULTS));
  localStorage.setItem(KEYS.TASK_FORCES, JSON.stringify(SEED_TASK_FORCES));
  localStorage.setItem(KEYS.PROJECT_TASK_FORCES, JSON.stringify(SEED_PROJECT_TASK_FORCES));
  localStorage.setItem(KEYS.PROJECTS, JSON.stringify(SEED_PROJECTS));
  localStorage.setItem(KEYS.TASKS, JSON.stringify(SEED_TASKS));
  localStorage.setItem(KEYS.INITIALIZED, "true");
}

// ===== 汎用CRUD =====

export const localStore = {
  get<T>(key: string): T[] {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    try { return JSON.parse(raw) as T[]; }
    catch { return []; }
  },

  set<T>(key: string, data: T[]): void {
    localStorage.setItem(key, JSON.stringify(data));
  },

  // 論理削除（is_deleted=trueに設定）
  softDelete(key: string, id: string, deletedBy: string): boolean {
    const items = this.get<Record<string, unknown>>(key);
    const idx = items.findIndex(i => i.id === id);
    if (idx === -1) return false;
    items[idx] = {
      ...items[idx],
      is_deleted: true,
      deleted_at: new Date().toISOString(),
      deleted_by: deletedBy,
      updated_at: new Date().toISOString(),
    };
    this.set(key, items);
    return true;
  },

  // 論理削除を取り消す（復元）
  restore(key: string, id: string): boolean {
    const items = this.get<Record<string, unknown>>(key);
    const idx = items.findIndex(i => i.id === id);
    if (idx === -1) return false;
    items[idx] = {
      ...items[idx],
      is_deleted: false,
      deleted_at: null,
      deleted_by: null,
      updated_at: new Date().toISOString(),
    };
    this.set(key, items);
    return true;
  },
};

// ===== ユーザー選択（ローカルモードのログイン代替）=====
//
// Supabase承認前の暫定認証。
// ブラウザを開いたときにメンバーを選択し、localStorageに保存する。
// Supabase移行後はこの仕組みを削除してSupabase Authに差し替える。

import type { Member } from "./types";

export function getCurrentUser(): Member | null {
  const id = localStorage.getItem(KEYS.CURRENT_USER);
  if (!id) return null;
  const members = localStore.get<Member>(KEYS.MEMBERS);
  return members.find(m => m.id === id) ?? null;
}

export function setCurrentUser(memberId: string): void {
  localStorage.setItem(KEYS.CURRENT_USER, memberId);
}

export function clearCurrentUser(): void {
  localStorage.removeItem(KEYS.CURRENT_USER);
}

// ===== キー定数のエクスポート =====
export { KEYS };
