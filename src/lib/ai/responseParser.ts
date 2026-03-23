// src/lib/ai/responseParser.ts
//
// 【設計意図】
// AIから返ってきたJSONテキストをパースし、型チェックを行う。
// 不正なJSONや型エラーの場合はAIError("INVALID_RESPONSE")をthrowする。

import { AIError } from "./apiClient";

// ===== Proposal型定義 =====

export interface Proposal {
  proposal_id: string;
  title: string;
  description: string;
  action_type:
    | "date_change"
    | "assignee"
    | "risk"
    | "no_tasks"
    | "deadline_risk"
    | "scope_reduce"
    | "pause"
    | "milestone";
  target_task_ids: string[];
  target_pj_ids: string[];
  suggested_date?: string;
  suggested_assignee?: string;
  date_certainty: "exact" | "approximate" | "unknown";
  is_simulation: boolean;
  needs_confirmation: boolean;
}

export interface AIResponseData {
  proposals: Proposal[];
  follow_up_suggestions: string[];
}

// ===== バリデーション =====

const VALID_ACTION_TYPES = [
  "date_change",
  "assignee",
  "risk",
  "no_tasks",
  "deadline_risk",
  "scope_reduce",
  "pause",
  "milestone",
] as const;

const VALID_DATE_CERTAINTY = ["exact", "approximate", "unknown"] as const;

function validateProposal(p: unknown, index: number): Proposal {
  if (!p || typeof p !== "object") {
    throw new AIError(
      "INVALID_RESPONSE",
      `proposals[${index}] がオブジェクトではありません`,
    );
  }

  const obj = p as Record<string, unknown>;

  if (typeof obj.proposal_id !== "string" || !obj.proposal_id) {
    throw new AIError(
      "INVALID_RESPONSE",
      `proposals[${index}].proposal_id が不正です`,
    );
  }
  if (typeof obj.title !== "string" || !obj.title) {
    throw new AIError(
      "INVALID_RESPONSE",
      `proposals[${index}].title が不正です`,
    );
  }
  if (typeof obj.description !== "string") {
    throw new AIError(
      "INVALID_RESPONSE",
      `proposals[${index}].description が不正です`,
    );
  }
  if (!VALID_ACTION_TYPES.includes(obj.action_type as Proposal["action_type"])) {
    throw new AIError(
      "INVALID_RESPONSE",
      `proposals[${index}].action_type "${obj.action_type}" は無効な値です`,
    );
  }
  if (!Array.isArray(obj.target_task_ids)) {
    throw new AIError(
      "INVALID_RESPONSE",
      `proposals[${index}].target_task_ids が配列ではありません`,
    );
  }
  if (!Array.isArray(obj.target_pj_ids)) {
    throw new AIError(
      "INVALID_RESPONSE",
      `proposals[${index}].target_pj_ids が配列ではありません`,
    );
  }
  if (!VALID_DATE_CERTAINTY.includes(obj.date_certainty as Proposal["date_certainty"])) {
    throw new AIError(
      "INVALID_RESPONSE",
      `proposals[${index}].date_certainty "${obj.date_certainty}" は無効な値です`,
    );
  }
  if (typeof obj.is_simulation !== "boolean") {
    throw new AIError(
      "INVALID_RESPONSE",
      `proposals[${index}].is_simulation が真偽値ではありません`,
    );
  }
  if (typeof obj.needs_confirmation !== "boolean") {
    throw new AIError(
      "INVALID_RESPONSE",
      `proposals[${index}].needs_confirmation が真偽値ではありません`,
    );
  }

  return {
    proposal_id: obj.proposal_id as string,
    title: obj.title as string,
    description: obj.description as string,
    action_type: obj.action_type as Proposal["action_type"],
    target_task_ids: (obj.target_task_ids as unknown[]).map(String),
    target_pj_ids: (obj.target_pj_ids as unknown[]).map(String),
    suggested_date:
      typeof obj.suggested_date === "string" ? obj.suggested_date : undefined,
    suggested_assignee:
      typeof obj.suggested_assignee === "string"
        ? obj.suggested_assignee
        : undefined,
    date_certainty: obj.date_certainty as Proposal["date_certainty"],
    is_simulation: obj.is_simulation as boolean,
    needs_confirmation: obj.needs_confirmation as boolean,
  };
}

/**
 * AIの生レスポンス文字列（JSON）をパースしてAIResponseDataを返す。
 * パース失敗・型エラーの場合はAIError("INVALID_RESPONSE")をthrow。
 */
export function parseAIResponse(rawText: string): AIResponseData {
  // AIがコードブロックで囲んで返す場合があるため除去する
  const cleaned = rawText
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new AIError(
      "INVALID_RESPONSE",
      "AIのレスポンスをJSONとしてパースできませんでした",
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw new AIError("INVALID_RESPONSE", "AIのレスポンスがオブジェクトではありません");
  }

  const obj = parsed as Record<string, unknown>;

  if (!Array.isArray(obj.proposals)) {
    throw new AIError(
      "INVALID_RESPONSE",
      "AIのレスポンスに proposals 配列がありません",
    );
  }

  const proposals: Proposal[] = obj.proposals.map((p, i) =>
    validateProposal(p, i)
  );

  const followUpSuggestions: string[] = Array.isArray(obj.follow_up_suggestions)
    ? (obj.follow_up_suggestions as unknown[]).filter(
        (s): s is string => typeof s === "string"
      )
    : [];

  return { proposals, follow_up_suggestions: followUpSuggestions };
}
