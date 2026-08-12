// src/lib/ai/guestApplyStore.ts
//
// 【設計意図】
// applyProposal.ts / undoApply.ts はAI提案の反映・Undoのために `supabase.from(...)` を
// 直接呼ぶ（appStore.saveTask等のchoke pointを経由しない。CLAUDE.md Section 6-10の
// 既存仕様）。ゲスト（サンプル閲覧）モードでは client.ts のProxyがこの経路を丸ごと
// ブロックするため、ゲストのときは同じ関数がこのファイルの直接state操作へ分岐する。
//
// 【appStoreのアクション（saveTask/deleteTask等）を呼ばない理由】
// 元のDB直叩きコード自体が、B1依存ゲート・B4ベースライン捕捉・親タスク自動完了などの
// choke point（appStore.saveTask）を経由しない生のUPDATE/INSERTである（AI提案の反映は
// 実ユーザーでも同じ挙動）。ゲスト版もこれと完全に同じ挙動（対象フィールドだけの直接
// 更新・チェックなしの追加）にするため、appStoreのアクション関数は呼ばず
// useAppStore.setState() で直接書き込む。
//
// 【物理削除しない】is_deleted等のフラグ操作のみ（CLAUDE.md Section 4）。

import { useAppStore } from "../../stores/appStore";
import type { Task, Project } from "../localData/types";

export function guestGetTask(id: string): Task | null {
  return useAppStore.getState().tasks.find(t => t.id === id) ?? null;
}

export function guestGetProject(id: string): Project | null {
  return useAppStore.getState().projects.find(p => p.id === id) ?? null;
}

// fields は Record<string, unknown> にする（undoApply.ts の task_field/pj_field が
// `{ [op.field]: op.oldValue }` という動的キーで呼ぶため。Partial<Task>等の厳密な型では
// 動的キーが受け付けられない）。呼び出し側の対象フィールドはいずれも実在の列名であることを
// 前提とする（既存のsupabase.update(dynamicKey)と同じ信頼関係）。

export function guestPatchTask(id: string, fields: Record<string, unknown>, updatedBy: string): void {
  const now = new Date().toISOString();
  useAppStore.setState(state => ({
    tasks: state.tasks.map(t => (t.id === id ? ({ ...t, ...fields, updated_at: now, updated_by: updatedBy } as Task) : t)),
  }));
}

export function guestPatchProject(id: string, fields: Record<string, unknown>, updatedBy: string): void {
  const now = new Date().toISOString();
  useAppStore.setState(state => ({
    projects: state.projects.map(p => (p.id === id ? ({ ...p, ...fields, updated_at: now, updated_by: updatedBy } as Project) : p)),
  }));
}

/** PJ配下タスクの一括フラグ更新（scope_reduce/pauseの論理削除・そのUndoの復元の両方に使う）。 */
export function guestPatchProjectTasks(
  projectId: string,
  matchIsDeleted: boolean,
  fields: Record<string, unknown>,
  updatedBy: string,
): void {
  const now = new Date().toISOString();
  useAppStore.setState(state => ({
    tasks: state.tasks.map(t =>
      t.project_id === projectId && t.is_deleted === matchIsDeleted
        ? ({ ...t, ...fields, updated_at: now, updated_by: updatedBy } as Task)
        : t,
    ),
  }));
}

export function guestInsertTask(task: Task): void {
  useAppStore.setState(state => ({ tasks: [...state.tasks, task] }));
}

export function guestInsertProject(project: Project): void {
  useAppStore.setState(state => ({ projects: [...state.projects, project] }));
}

/** 有効メンバー一覧（add_task/add_projectの担当者名解決用）。 */
export function guestActiveMembers(): { id: string; short_name: string }[] {
  return useAppStore.getState().members
    .filter(m => !m.is_deleted)
    .map(m => ({ id: m.id, short_name: m.short_name }));
}

export function guestMemberShortName(memberId: string): string | null {
  const m = useAppStore.getState().members.find(x => x.id === memberId);
  return m ? m.short_name : null;
}
