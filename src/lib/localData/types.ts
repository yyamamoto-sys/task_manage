// src/lib/localData/types.ts
// アプリ全体で使う型定義

export interface Member {
  id: string;
  display_name: string;
  short_name: string;
  initials: string;
  teams_account: string;
  color_bg: string;
  color_text: string;
  is_deleted: boolean;
  // audit fields（Supabase移行後に必須化）
  created_at?: string;
  updated_at?: string;
  updated_by?: string;
  deleted_at?: string;
  deleted_by?: string;
}

export interface Objective {
  id: string;
  title: string;
  purpose?: string;     // 何を達成するか（Purpose）
  background?: string;  // 設計の意図や背景
  period: string;
  is_current: boolean;
  // audit fields
  created_at?: string;
  updated_at?: string;
  updated_by?: string;
  archived_at?: string;
}

export interface KeyResult {
  id: string;
  objective_id: string;
  title: string;
  is_deleted: boolean;
  // audit fields
  created_at?: string;
  updated_at?: string;
  updated_by?: string;
  deleted_at?: string;
  deleted_by?: string;
}

export type Quarter = "1Q" | "2Q" | "3Q" | "4Q";

export interface QuarterlyObjective {
  id: string;
  objective_id: string;  // 通期Objectiveへの紐づき
  quarter: Quarter;
  title: string;
  purpose?: string;     // 何を達成するか（Purpose）
  background?: string;  // 設計の意図や背景
  is_deleted: boolean;
  // audit fields
  created_at?: string;
  updated_at?: string;
  updated_by?: string;
  deleted_at?: string;
  deleted_by?: string;
}


export interface TaskForce {
  id: string;
  kr_id: string;
  tf_number: string;
  name: string;
  description?: string;      // TFの目的・詳細（任意）
  background?: string;       // 設定した意図・背景（任意）
  leader_member_id: string;
  is_deleted: boolean;
  // audit fields
  created_at?: string;
  updated_at?: string;
  updated_by?: string;
  deleted_at?: string;
  deleted_by?: string;
}

/** TF達成のための大タスク単位。ToDoの下に実作業Taskが紐づく */
export interface ToDo {
  id: string;
  tf_id: string;           // 紐づくTaskForce
  name?: string;           // 短いタイトル（任意・単一行）
  title: string;           // ToDo内容（複数行テキスト・長文対応）
  due_date: string | null; // 任意
  memo: string;            // 備考（任意）
  is_deleted: boolean;
  // audit fields
  created_at?: string;
  updated_at?: string;
  updated_by?: string;
  deleted_at?: string;
  deleted_by?: string;
}

export interface Project {
  id: string;
  name: string;
  purpose: string;
  contribution_memo: string;
  owner_member_id: string;
  /** 複数オーナー対応（DBのowner_member_ids[]と同期） */
  owner_member_ids: string[];
  status: "active" | "completed" | "archived";
  color_tag: string;
  start_date: string;
  end_date: string;
  is_deleted: boolean;
  // audit fields（updated_atはSupabase移行時の競合検知に使用）
  created_at?: string;
  updated_at?: string;
  updated_by?: string;
  deleted_at?: string;
  deleted_by?: string;
}

export interface Task {
  id: string;
  name: string;
  project_id: string | null; // Projectへの紐づき（任意）
  todo_ids: string[];        // UI専用。DB は todo_id（単数）。fetchAllData で正規化。
  assignee_member_id: string;          // DBの主FK（先頭1人）
  assignee_member_ids: string[];       // UI専用。複数担当者。fetchAllData で正規化。
  status: "todo" | "in_progress" | "done";
  priority: "high" | "mid" | "low" | null;
  start_date: string | null; // 開始日（任意）
  due_date: string | null;
  estimated_hours: number | null;
  comment: string;
  is_deleted: boolean;
  // audit fields（updated_atはSupabase移行時の競合検知に使用）
  created_at?: string;
  updated_at?: string;
  updated_by?: string;
  deleted_at?: string;
  deleted_by?: string;
  /** ステータスがdoneになった日時（doneから外れたらnullに戻す） */
  completed_at?: string | null;
}

export interface Milestone {
  id: string;
  project_id: string;    // 所属PJのID
  name: string;          // マイルストーン名
  date: string;          // YYYY-MM-DD形式
  description?: string;  // 任意の説明
  is_deleted: boolean;
  created_at?: string;
  updated_at?: string;
  updated_by?: string;
  deleted_at?: string;
  deleted_by?: string;
}

export interface ProjectTaskForce {
  project_id: string;
  tf_id: string;
}

export interface QuarterlyKrTaskForce {
  quarterly_objective_id: string; // どの四半期か
  kr_id: string;                  // 通期KRのID
  tf_id: string;
}

/** タスク ↔ タスクフォース（多対多） */
export interface TaskTaskForce {
  task_id: string;
  tf_id: string;
}

/** タスク ↔ 追加プロジェクト（多対多。project_idの主プロジェクト以外の紐づけ） */
export interface TaskProject {
  task_id: string;
  project_id: string;
}

export type ViewMode = "kanban" | "gantt" | "list" | "dashboard" | "admin";

// ===== 変更履歴（CLAUDE.md Section 7）=====

/** 管理画面での変更履歴（2週間保存） */
export interface AdminChangeLog {
  id: string;
  layer: "objective" | "kr" | "tf" | "project" | "member";
  action: "create" | "update" | "delete" | "restore" | "period_switch";
  target_id: string;
  target_name: string;
  /** 変更前後の差分。例: { status: { before: "todo", after: "done" } } */
  diff: Record<string, { before: unknown; after: unknown }>;
  performed_by: string;   // member_id
  performed_at: string;   // ISO8601
  is_conflict_override: boolean;
}

/** タスク変更履歴（競合検知・最低限） */
export interface TaskChangeLog {
  task_id: string;
  updated_at: string;     // ISO8601
  updated_by: string;     // member_id
}

// AI連携専用の型は src/lib/ai/types.ts に移動しました。
// 後方互換のため re-export します。
export type {
  ConsultationType,
  AIProject, AITask, AITaskForce, AIKeyResult, AIOKR,
  MemberWorkload,
} from "../ai/types";
