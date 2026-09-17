// src/lib/history/fieldLabels.ts
//
// 【設計意図】
// entity_change_logs の diff を画面表示する際の「項目名の日本語化」「値の読みやすい表示」を
// 純粋関数に切り出す（CLAUDE.md Section 57）。ChangeHistorySection.tsx から呼ぶ。

import type { Member } from "../localData/types";
import type { EntityChangeLogEntityType } from "../localData/types";
import { TASK_STATUS_LABEL, TASK_PRIORITY_LABEL } from "../taskMeta";

const TASK_FIELD_LABELS: Record<string, string> = {
  name: "タスク名",
  status: "ステータス",
  priority: "優先度",
  assignee_member_id: "担当者",
  assignee_member_ids: "担当者",
  start_date: "開始日",
  due_date: "期日",
  estimated_hours: "見積工数",
  comment: "メモ・コメント",
  project_id: "プロジェクト",
  todo_ids: "ToDo紐づけ",
  parent_task_id: "親タスク",
  is_deleted: "削除状態",
};

const PROJECT_FIELD_LABELS: Record<string, string> = {
  name: "PJ名",
  purpose: "目的",
  contribution_memo: "貢献メモ",
  owner_member_id: "オーナー",
  start_date: "開始日",
  end_date: "終了日",
  status: "ステータス",
  color_tag: "カラー",
  is_deleted: "削除状態",
};

/** プロジェクトの status のラベル（ProjectSettingsModal.tsx の STATUS_LABELS と同じ対応）。
 *  別ファイルからのimportで結合度を上げないよう、ここに同じ内容を小さく持つ。 */
const PROJECT_STATUS_LABEL: Record<string, string> = {
  active: "進行中",
  completed: "完了",
  archived: "アーカイブ",
};

export function fieldLabel(entityType: EntityChangeLogEntityType, field: string): string {
  const map = entityType === "task" ? TASK_FIELD_LABELS : PROJECT_FIELD_LABELS;
  return map[field] ?? field;
}

function memberLabel(members: Member[], id: unknown): string {
  if (typeof id !== "string" || !id) return "（未設定）";
  const m = members.find(mem => mem.id === id);
  return m ? m.short_name : `不明なメンバー（${id.slice(0, 8)}…）`;
}

function formatArray(entityType: EntityChangeLogEntityType, field: string, value: unknown, members: Member[]): string {
  const arr = Array.isArray(value) ? value : [];
  if (arr.length === 0) return "（未設定）";
  if (field === "assignee_member_ids") return arr.map(id => memberLabel(members, id)).join("、");
  if (field === "todo_ids") return `${arr.length}件`;
  return arr.map(v => String(v)).join("、");
}

/**
 * diffの1値（before または after）を、利用者が読める文字列に変換する。
 * @param members 担当者・オーナーのID→表示名変換に使う（無くても壊れない。不明表示になるだけ）
 */
export function formatChangeValue(
  entityType: EntityChangeLogEntityType,
  field: string,
  value: unknown,
  members: Member[],
): string {
  if (value === null || value === undefined || value === "") return "（未設定）";
  if (Array.isArray(value)) return formatArray(entityType, field, value, members);
  if (typeof value === "boolean") return value ? "はい" : "いいえ";

  if (entityType === "task" && field === "status" && typeof value === "string") {
    return TASK_STATUS_LABEL[value as keyof typeof TASK_STATUS_LABEL] ?? value;
  }
  if (entityType === "task" && field === "priority" && typeof value === "string") {
    return TASK_PRIORITY_LABEL[value] ?? value;
  }
  if (entityType === "project" && field === "status" && typeof value === "string") {
    return PROJECT_STATUS_LABEL[value] ?? value;
  }
  if ((field === "assignee_member_id" || field === "owner_member_id") && typeof value === "string") {
    return memberLabel(members, value);
  }

  return String(value);
}
