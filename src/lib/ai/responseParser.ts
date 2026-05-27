// src/lib/ai/responseParser.ts
//
// 【設計意図】
// AIから返ってきたJSONテキストをパースし、型チェックを行う。
// 不正なJSONや型エラーの場合はAIError("INVALID_RESPONSE")をthrowする。

import { AIError } from "./apiClient";

// ===== Proposal型定義 =====

/** add_project 用：作成するPJに紐づく初期タスク */
export interface NewProjectTaskInput {
  name: string;
  suggested_assignee?: string;
  suggested_start_date?: string;
  suggested_due_date?: string;
}

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
    | "milestone"
    | "info"
    | "add_task"
    | "add_project";
  target_task_ids: string[];
  target_pj_ids: string[];
  suggested_date?: string;
  suggested_start_date?: string;
  suggested_end_date?: string;
  shift_days?: number;
  suggested_assignee?: string;
  date_certainty: "exact" | "approximate" | "unknown";
  is_simulation: boolean;
  needs_confirmation: boolean;
  /** add_project 用：作成するPJに紐づく初期タスク */
  new_project_tasks?: NewProjectTaskInput[];
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
  "info",
  "add_task",
  "add_project",
] as const;

const VALID_DATE_CERTAINTY = ["exact", "approximate", "unknown"] as const;

/**
 * new_project_tasks を寛容にパースする。
 * 配列でなければ []。各要素は name が文字列のもののみ採用し、他フィールドは任意。
 */
function parseNewProjectTasks(raw: unknown): NewProjectTaskInput[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const tasks: NewProjectTaskInput[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (typeof o.name !== "string" || !o.name.trim()) continue;
    tasks.push({
      name: o.name,
      suggested_assignee:
        typeof o.suggested_assignee === "string" ? o.suggested_assignee : undefined,
      suggested_start_date:
        typeof o.suggested_start_date === "string" ? o.suggested_start_date : undefined,
      suggested_due_date:
        typeof o.suggested_due_date === "string" ? o.suggested_due_date : undefined,
    });
  }
  return tasks;
}

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
  // description は欠落しても落とさず、return 側で "" に補完する（必須は title / action_type / proposal_id のみ）
  if (!VALID_ACTION_TYPES.includes(obj.action_type as Proposal["action_type"])) {
    throw new AIError(
      "INVALID_RESPONSE",
      `proposals[${index}].action_type "${obj.action_type}" は無効な値です`,
    );
  }

  // ここから下は欠落・null でもレスポンス全体を壊さず、安全な既定値にフォールバックする。
  // （info / risk など日付や対象に無関係な提案では date_certainty・target_* 等が
  //   省略・null で返ることがあるため。必須は proposal_id / title / action_type のみ）
  const actionType = obj.action_type as Proposal["action_type"];

  // date_certainty：有効値以外（null・欠落含む）は "unknown" 扱い
  const dateCertainty: Proposal["date_certainty"] =
    VALID_DATE_CERTAINTY.includes(obj.date_certainty as Proposal["date_certainty"])
      ? (obj.date_certainty as Proposal["date_certainty"])
      : "unknown";

  // needs_confirmation：未指定なら「DBを変更する提案は確認必須・それ以外は不要」を既定に
  // （安全側に倒す。明示の boolean があればそれを優先）
  const MUTATING_ACTIONS: Proposal["action_type"][] = [
    "date_change", "assignee", "add_task", "add_project", "scope_reduce", "pause", "milestone",
  ];
  const needsConfirmation =
    typeof obj.needs_confirmation === "boolean"
      ? obj.needs_confirmation
      : MUTATING_ACTIONS.includes(actionType);

  return {
    proposal_id: obj.proposal_id as string,
    title: obj.title as string,
    description: typeof obj.description === "string" ? obj.description : "",
    action_type: actionType,
    target_task_ids: Array.isArray(obj.target_task_ids)
      ? (obj.target_task_ids as unknown[]).map(String)
      : [],
    target_pj_ids: Array.isArray(obj.target_pj_ids)
      ? (obj.target_pj_ids as unknown[]).map(String)
      : [],
    suggested_date:
      typeof obj.suggested_date === "string" ? obj.suggested_date : undefined,
    suggested_start_date:
      typeof obj.suggested_start_date === "string" ? obj.suggested_start_date : undefined,
    suggested_end_date:
      typeof obj.suggested_end_date === "string" ? obj.suggested_end_date : undefined,
    shift_days:
      typeof obj.shift_days === "number" ? obj.shift_days : undefined,
    suggested_assignee:
      typeof obj.suggested_assignee === "string"
        ? obj.suggested_assignee
        : undefined,
    date_certainty: dateCertainty,
    is_simulation: obj.is_simulation === true,
    needs_confirmation: needsConfirmation,
    new_project_tasks: parseNewProjectTasks(obj.new_project_tasks),
  };
}

/**
 * AIの生レスポンス文字列（JSON）をパースしてAIResponseDataを返す。
 * パース失敗・型エラーの場合はAIError("INVALID_RESPONSE")をthrow。
 */
export function parseAIResponse(rawText: string): AIResponseData {
  // AIがコードブロックで囲んで返す場合があるため除去する
  // マルチライン（s フラグ）で先頭の ```json または ``` と末尾の ``` をまとめて除去する
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/is, "")
    .replace(/\s*```\s*$/is, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // フォールバック：AIがJSONの前後に説明文を付けて返した場合に備え、
    // 本文中の最初の "{" 〜 最後の "}" を取り出して再パースする。
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        parsed = JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        throw new AIError(
          "INVALID_RESPONSE",
          "AIのレスポンスをJSONとしてパースできませんでした",
        );
      }
    } else {
      throw new AIError(
        "INVALID_RESPONSE",
        "AIのレスポンスをJSONとしてパースできませんでした",
      );
    }
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
