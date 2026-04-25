// src/lib/ai/types.ts
// AI連携専用の型定義（CLAUDE.md Section 6）。
// ドメイン型（Member / Project / Task など）は src/lib/localData/types.ts を参照。
// 注意: 循環依存を避けるため localData/types.ts はインポートせず型をインライン定義する。

export type ConsultationType =
  | "change"         // 変更の影響整理（デフォルト）
  | "simulate"       // What-If シミュレーション
  | "diagnose"       // 現状診断
  | "deadline_check" // 締め切り逆算（target_deadline必須）
  | "scope_change";  // PJ停止・スコープ縮小

/** AIに渡すプロジェクト情報（contribution_memoは含めない） */
export interface AIProject {
  pj_id: string;
  pj_name: string;
  pj_purpose: string;
  pj_status: "active" | "completed" | "archived";
  pj_end_date: string | null;
  pj_progress: { total: number; done: number; in_progress: number; todo: number };
  pj_owners: string[];
  tasks: AITask[];
}

export interface AITask {
  task_id: string;
  task_name: string;
  assignee: string;
  status: "todo" | "in_progress" | "done";
  priority: "high" | "mid" | "low" | null;
  due_date: string | null;
  estimated_hours: number | null;
  comment: string;
  completed_at: string | null;
}

export interface AITaskForce {
  tf_id: string;
  tf_number: string;
  name: string;
  leader: string;
}

export interface AIKeyResult {
  kr_id: string;
  title: string;
  task_forces: AITaskForce[];
}

export interface AIOKR {
  objective_id: string;
  title: string;
  period: string;
  key_results: AIKeyResult[];
}

export interface MemberWorkload {
  member_id: string;
  short_name: string;
  todo_count: number;
  in_progress_count: number;
  total_estimated_hours: number | null;
  tasks_with_estimate: number;
  tasks_without_estimate: number;
}
