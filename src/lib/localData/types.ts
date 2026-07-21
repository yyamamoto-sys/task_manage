// src/lib/localData/types.ts
// アプリ全体で使う型定義

/** 期限アラートの通知方法（ユーザーごとに選択） */
export type NotifyPref = "none" | "browser" | "teams";

/** マルチテナントのグループ（部署単位）。全データはグループに属する */
export interface Group {
  id: string;
  name: string;
  /** この部署専用のTeams Webhook URL（週次期限通知の投稿先）。未設定なら全社共通のTEAMS_WEBHOOK_URLにフォールバック */
  teams_webhook_url?: string | null;
  is_deleted: boolean;
  deleted_at?: string;
  deleted_by?: string;
  created_at?: string;
  updated_at?: string;
  updated_by: string;
}

export interface Member {
  id: string;
  display_name: string;
  short_name: string;
  initials: string;
  teams_account: string;
  /** Supabase Auth のメールアドレスと突き合わせてログイン時に自動マッチングする（任意） */
  email?: string | null;
  /** 期限通知の受け取り方。未設定（マイグレ前の行）は "none" 扱い */
  notify_pref?: NotifyPref;
  /** 管理者権限フラグ。true のメンバーが1人以上いる場合、管理画面は is_admin=true のみアクセス可 */
  is_admin?: boolean;
  /** 全社スーパー管理者フラグ。部署をまたいだ権限（is_adminとは独立・直交するロール） */
  is_super_admin?: boolean;
  color_bg: string;
  color_text: string;
  is_deleted: boolean;
  /** 所属グループID（マルチテナント対応） */
  group_id?: string | null;
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
  /** 所属する四半期。未設定(legacy)は現在の四半期として扱う（lib/okr/tfQuarter.ts） */
  quarter?: Quarter;
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
  /** PJに参加するメンバーID配列。オーナーとは別の「関与者」。空配列も可・未設定でも可。 */
  member_ids?: string[];
  /** 各メンバーの役割テキスト。キー=member_id、値=役割（例：{"uuid": "PJリーダー"}） */
  member_roles?: Record<string, string>;
  status: "active" | "completed" | "archived";
  color_tag: string;
  start_date: string;
  end_date: string;
  is_deleted: boolean;
  /** 所属グループID（マルチテナント対応） */
  group_id?: string | null;
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
  /** on_hold=保留（一旦停止・将来また検討する可能性あり）、cancelled=中止（方針転換等でもう実施しない） */
  status: "todo" | "in_progress" | "done" | "on_hold" | "cancelled";
  priority: "high" | "mid" | "low" | null;
  start_date: string | null; // 開始日（任意）
  due_date: string | null;
  estimated_hours: number | null;
  comment: string;
  is_deleted: boolean;
  /** 所属グループID（マルチテナント対応） */
  group_id?: string | null;
  // audit fields（updated_atはSupabase移行時の競合検知に使用）
  created_at?: string;
  updated_at?: string;
  updated_by?: string;
  deleted_at?: string;
  deleted_by?: string;
  /** ステータスがdoneになった日時（doneから外れたらnullに戻す） */
  completed_at?: string | null;
  /** 親タスク（2階層固定）。null/未設定=大タスク（最上位）、値あり=小タスク */
  parent_task_id?: string | null;
  /** 同一親（またはPJ直下）内での手動並び順 */
  display_order?: number;
  /** 自由入力タグ（例：「懇親会」「レイアウト」）。同一PJ内でのグルーピング/ソートに使う。DBは text[]（migration 20260604） */
  tags?: string[];
  /** メンション通知の確定スナップショット。モーダルを閉じたときだけ更新。useMentionNotifications がこれを監視する（migration 20260608） */
  finalized_mentions?: string[];
  /** 当初計画の開始日（B4：ベースライン差分）。start_date/due_dateが初めて両方揃った時点で凍結、以後は自動更新しない */
  baseline_start_date?: string | null;
  /** 当初計画の期日（B4：ベースライン差分）。start_date/due_dateが初めて両方揃った時点で凍結、以後は自動更新しない */
  baseline_due_date?: string | null;
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

/**
 * タスク依存関係（先行→後続）。B1（依存ゲート）で使用。
 * predecessor = 先に完了すべきタスク、successor = それを待つタスク。
 * FS（Finish-to-Start）依存1種のみ・親子関係（parent_task_id）とは独立した別概念。
 */
export interface TaskDependency {
  id: string;
  predecessor_task_id: string;
  successor_task_id: string;
  is_deleted: boolean;
  /** 所属グループID（マルチテナント対応。新規テーブルのため必須） */
  group_id?: string | null;
  created_at?: string;
  created_by?: string;
  updated_at?: string;
  updated_by?: string;
  deleted_at?: string;
  deleted_by?: string;
}

/** メンバータグ：複数メンバーをまとめて担当者として扱う仕組み */
export type MemberTagKind = "static" | "all_members" | "kr_members" | "tf_members";

export interface MemberTag {
  id: string;
  name: string;
  description: string;
  /** タグの種別。Phase Tag-1 は static のみ実利用 */
  kind: MemberTagKind;
  /** kr_members/tf_members の参照先 ID（Phase Tag-3 で使用） */
  source_id: string | null;
  is_deleted: boolean;
  created_at?: string;
  updated_at?: string;
  updated_by?: string;
  deleted_at?: string;
  deleted_by?: string;
}

/** メンバータグ ↔ メンバー（多対多） */
export interface MemberTagMember {
  tag_id: string;
  member_id: string;
}

export type ViewMode = "kanban" | "gantt" | "list" | "dashboard" | "admin" | "workload";

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
