// src/lib/ai/proposalMapper.ts
//
// 【設計意図】
// AIのProposal[]をUIで表示するための型（UIProposal[]）に変換する。
// action_typeごとに表示ラベル・色を付与する。
// canApplyの計算ロジックもここで一元管理する。

import type { Proposal } from "./responseParser";

// ===== UI表示用型定義 =====

export interface UIProposal {
  proposal_id: string;
  title: string;
  description: string;
  action_type: Proposal["action_type"];
  action_label: string;
  action_color: string;   // CSS変数名
  target_task_ids: string[];
  target_pj_ids: string[];
  suggested_date?: string;
  suggested_end_date?: string;
  shift_days?: number;
  suggested_assignee?: string;
  date_certainty: "exact" | "approximate" | "unknown";
  is_simulation: boolean;
  needs_confirmation: boolean;
  /** date_certainty !== "unknown" && !is_simulation の場合にtrue（「反映する」ボタン活性） */
  canApply: boolean;
}

// ===== action_typeごとの表示設定 =====

const ACTION_TYPE_CONFIG: Record<
  Proposal["action_type"],
  { label: string; color: string }
> = {
  date_change: {
    label: "日程変更",
    color: "var(--color-text-info)",
  },
  assignee: {
    label: "担当変更",
    color: "var(--color-text-purple)",
  },
  risk: {
    label: "リスク警告",
    color: "var(--color-text-warning)",
  },
  no_tasks: {
    label: "タスク未設定",
    color: "var(--color-text-tertiary)",
  },
  deadline_risk: {
    label: "期限リスク",
    color: "var(--color-text-danger)",
  },
  scope_reduce: {
    label: "スコープ縮小",
    color: "var(--color-text-warning)",
  },
  pause: {
    label: "一時停止",
    color: "var(--color-text-secondary)",
  },
  milestone: {
    label: "マイルストーン",
    color: "var(--color-text-info)",
  },
};

/**
 * Proposal[]をUIProposal[]に変換する。
 */
export function mapProposalsToUI(proposals: Proposal[]): UIProposal[] {
  return proposals.map((p) => {
    const config = ACTION_TYPE_CONFIG[p.action_type] ?? {
      label: p.action_type,
      color: "var(--color-text-secondary)",
    };

    return {
      proposal_id: p.proposal_id,
      title: p.title,
      description: p.description,
      action_type: p.action_type,
      action_label: config.label,
      action_color: config.color,
      target_task_ids: p.target_task_ids,
      target_pj_ids: p.target_pj_ids,
      suggested_date: p.suggested_date,
      suggested_end_date: p.suggested_end_date,
      shift_days: p.shift_days,
      suggested_assignee: p.suggested_assignee,
      date_certainty: p.date_certainty,
      is_simulation: p.is_simulation,
      needs_confirmation: p.needs_confirmation,
      canApply: p.date_certainty !== "unknown" && !p.is_simulation,
    };
  });
}
