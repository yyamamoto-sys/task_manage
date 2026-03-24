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
  is_deleted: boolean;
  // audit fields
  created_at?: string;
  updated_at?: string;
  updated_by?: string;
  deleted_at?: string;
  deleted_by?: string;
}

export interface QuarterlyKeyResult {
  id: string;
  quarterly_objective_id: string;
  title: string;
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
  leader_member_id: string;
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
  project_id: string;
  assignee_member_id: string;
  status: "todo" | "in_progress" | "done";
  priority: "high" | "mid" | "low" | null;
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
}

export interface ProjectTaskForce {
  project_id: string;
  tf_id: string;
}

export interface QuarterlyKrTaskForce {
  quarterly_kr_id: string;
  tf_id: string;
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

// ===== AI連携（CLAUDE.md Section 6）=====

export type ConsultationType =
  | "change"         // 変更の影響整理（デフォルト）
  | "simulate"       // What-If シミュレーション
  | "diagnose"       // 現状診断
  | "deadline_check" // 締め切り逆算（target_deadline必須）
  | "scope_change";  // PJ停止・スコープ縮小

/** AIに渡すプロジェクト情報（contribution_memoは含めない） */
export interface AIProject {
  pj_id: string;       // shortId（UUID非公開）
  pj_name: string;
  pj_purpose: string;  // contribution_memoは含めない（CLAUDE.md Section 2参照）
  pj_status: Project["status"];
  tasks: AITask[];
}

export interface AITask {
  task_id: string;     // shortId（UUID非公開）
  task_name: string;
  assignee: string;    // short_name
  status: Task["status"];
  priority: Task["priority"];
  due_date: string | null;
  estimated_hours: number | null;
  comment: string;     // sanitizeComment() 適用済みであること
}

export interface MemberWorkload {
  member_id: string;
  short_name: string;
  todo_count: number;
  in_progress_count: number;
  total_estimated_hours: number | null;
}
