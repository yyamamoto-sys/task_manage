// src/lib/project/projectRowMenu.ts
//
// 【設計意図】
// サイドバーのPJ行に付く「⋮」メニューの項目を組み立てる純粋関数。
// - 表示するか（PJの作成・編集はゲストにも開放済み。CLAUDE.md Section 23・2026-08-12。
//   canGuestEdit(isGuest, "project") で判定する）
// - 何を出すか（設定は常に・状態変更は編集権限がある人だけ・すでにcompleted/archivedなら
//   「↩ activeに戻す」1つだけを出す。complete/archiveを同時に出さない）
// を1箇所にまとめ、UI側（ProjectRowMenu.tsx）はこの結果をそのまま描画するだけにする。
// ラベル文言はi18n対象のためここでは持たない（UI側でidからt()のキーへ変換する）。

import { canGuestEdit } from "../guest/guestCapability";

export type ProjectRowMenuActionId = "settings" | "complete" | "archive" | "restore";

export interface ProjectRowMenuItem {
  id: ProjectRowMenuActionId;
  /** 絵文字アイコン（i18n不要・見た目のみ） */
  icon: string;
}

export interface BuildProjectRowMenuItemsOptions {
  project: { status: "active" | "completed" | "archived" };
  /** ProjectSettingsModalの基本情報編集と同じ権限条件（canEditProjectBasicInfo）の結果 */
  canEdit: boolean;
  /** ゲストメンバーか。PJ編集は開放済みだが、判定はcanGuestEdit経由に集約する */
  isGuest: boolean;
}

export function buildProjectRowMenuItems(
  { project, canEdit, isGuest }: BuildProjectRowMenuItemsOptions,
): ProjectRowMenuItem[] {
  if (!canGuestEdit(isGuest, "project")) return [];

  const items: ProjectRowMenuItem[] = [{ id: "settings", icon: "⚙" }];
  if (!canEdit) return items;

  if (project.status === "active") {
    items.push({ id: "complete", icon: "✅" });
    items.push({ id: "archive", icon: "🗄" });
  } else {
    // completed / archived のどちらでも「↩ activeに戻す」1つだけを出す
    items.push({ id: "restore", icon: "↩" });
  }
  return items;
}
