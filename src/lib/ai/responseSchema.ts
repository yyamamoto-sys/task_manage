// src/lib/ai/responseSchema.ts
//
// 【設計意図】
// AI相談（メイン相談）の返答を Anthropic の構造化出力（output_config.format・json_schema）で
// 強制するためのスキーマ。responseParser.ts の AIResponseData / Proposal と1対1で対応させる。
// プロパティの表は `Record<keyof 型, …>` で書いてあるので、型に項目を足す・消すとここが
// コンパイルエラーになる。enum の値の一致は responseSchema.test.ts が検査する。
//
// Anthropic のスキーマ制約（2026-11 時点・docs の structured-outputs）：
// - オブジェクトは additionalProperties:false 必須
// - minLength / maxLength / minimum / maximum 等は 400 になるので使わない
// - required に無い項目（任意項目）は全スキーマ合計で24個まで
// - 再帰スキーマは不可（new_subtasks の要素は new_project_tasks と同じ形を展開して書く）
// tool_choice で1ツールを強制する方式は Sonnet 5.5 が 400 を返すため使えない。

import type { AIResponseData, NewProjectTaskInput, Proposal } from "./responseParser";

type JsonSchema = Record<string, unknown>;

export const SCHEMA_ACTION_TYPES = [
  "date_change", "assignee", "risk", "no_tasks", "deadline_risk", "scope_reduce", "pause",
  "milestone", "info", "add_task", "add_project", "bulk_rename", "bulk_status",
] as const satisfies readonly Proposal["action_type"][];

export const SCHEMA_DATE_CERTAINTY = ["exact", "approximate", "unknown"] as const satisfies readonly Proposal["date_certainty"][];

export const SCHEMA_TASK_STATUSES = [
  "todo", "in_progress", "done", "on_hold", "cancelled",
] as const satisfies readonly NonNullable<Proposal["new_status"]>[];

const str: JsonSchema = { type: "string" };
const strArray: JsonSchema = { type: "array", items: str };

const NEW_TASK_PROPERTIES: Record<keyof NewProjectTaskInput, JsonSchema> = {
  name: str,
  suggested_assignee: str,
  suggested_start_date: str,
  suggested_due_date: str,
  suggested_description: str,
};
const NEW_TASK_REQUIRED: (keyof NewProjectTaskInput)[] = ["name"];

const newTaskSchema: JsonSchema = {
  type: "object",
  properties: NEW_TASK_PROPERTIES,
  required: NEW_TASK_REQUIRED,
  additionalProperties: false,
};

export const PROPOSAL_PROPERTIES: Record<keyof Proposal, JsonSchema> = {
  proposal_id: str,
  title: str,
  description: str,
  action_type: { type: "string", enum: [...SCHEMA_ACTION_TYPES] },
  target_task_ids: strArray,
  target_pj_ids: strArray,
  suggested_date: str,
  suggested_start_date: str,
  suggested_end_date: str,
  shift_days: { type: "integer" },
  suggested_assignee: str,
  date_certainty: { type: "string", enum: [...SCHEMA_DATE_CERTAINTY] },
  is_simulation: { type: "boolean" },
  needs_confirmation: { type: "boolean" },
  new_project_tasks: { type: "array", items: newTaskSchema },
  new_subtasks: { type: "array", items: newTaskSchema },
  parent_task: str,
  find: str,
  replace: str,
  new_status: { type: "string", enum: [...SCHEMA_TASK_STATUSES] },
};

export const PROPOSAL_REQUIRED: (keyof Proposal)[] = [
  "proposal_id", "title", "description", "action_type", "target_task_ids", "target_pj_ids",
  "date_certainty", "is_simulation", "needs_confirmation",
];

export const RESPONSE_PROPERTIES: Record<keyof AIResponseData, JsonSchema> = {
  reply: str,
  proposals: {
    type: "array",
    items: {
      type: "object",
      properties: PROPOSAL_PROPERTIES,
      required: PROPOSAL_REQUIRED,
      additionalProperties: false,
    },
  },
  follow_up_suggestions: strArray,
};

/** output_config.format.schema に渡すスキーマ本体 */
export const CONSULTATION_RESPONSE_SCHEMA: JsonSchema = {
  type: "object",
  properties: RESPONSE_PROPERTIES,
  required: ["reply", "proposals", "follow_up_suggestions"] satisfies (keyof AIResponseData)[],
  additionalProperties: false,
};
