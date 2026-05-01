// src/lib/ai/krQuarterPlanClient.ts
//
// 【設計意図】
// クォーター計画AI機能の呼び出し口。
// ・対話モード（callQuarterPlanDialogue）：短い問い返しを繰り返す
// ・計画書生成モード（callQuarterPlanGenerate）：JSON形式の計画書を生成する
// invokeAI経由でSupabase Edge Function（ai-consult）を呼ぶ。

import { invokeAI, getContentText, type AIMessageInput } from "./invokeAI";
import type { ProposedTF } from "../supabase/quarterPlanStore";
import {
  QUARTER_PLAN_DIALOGUE_SYSTEM_PROMPT,
  QUARTER_PLAN_GENERATION_SYSTEM_PROMPT,
} from "./krQuarterPlanPrompt";

export type PlanMessage = AIMessageInput;

export interface GeneratedPlan {
  quarter: string;
  summary: string;
  tfs: ProposedTF[];
  overall_risk: string | null;
}

// ===== 対話 AI =====

export async function callQuarterPlanDialogue(messages: PlanMessage[]): Promise<string> {
  const res = await invokeAI(
    QUARTER_PLAN_DIALOGUE_SYSTEM_PROMPT,
    messages,
    400,
  );
  return res.content[0].text;
}

// ===== 計画書生成 AI =====

export async function callQuarterPlanGenerate(
  contextText: string,
  conversation: PlanMessage[],
): Promise<GeneratedPlan> {
  const dialogueLog = conversation
    .filter(m => !getContentText(m.content).includes("【クォーター計画コンテキスト】"))
    .map(m => `${m.role === "user" ? "計画者" : "AI"}: ${getContentText(m.content)}`)
    .join("\n");

  const userMessage = `【コンテキスト】\n${contextText}\n\n【計画対話記録】\n${dialogueLog}\n\n以上から翌クォーターのTF計画書をJSON形式で生成してください。`;

  const res = await invokeAI(
    QUARTER_PLAN_GENERATION_SYSTEM_PROMPT,
    [{ role: "user", content: userMessage }],
    3000,
  );

  return parseGeneratedPlan(res.content[0].text);
}

// ===== JSONパーサー =====

function parseGeneratedPlan(raw: string): GeneratedPlan {
  // コードブロック除去
  const cleaned = raw
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    throw new Error("計画書のJSON解析に失敗しました。再生成してください。");
  }

  const rawTfs = Array.isArray(parsed.tfs) ? (parsed.tfs as Record<string, unknown>[]) : [];
  const tfs: ProposedTF[] = rawTfs.map((tf, i) => ({
    tempId: `tf-${i}-${Date.now()}`,
    tf_number: typeof tf.tf_number === "number" ? tf.tf_number : i + 1,
    action: (["継続", "変更", "廃止", "新設"] as const).includes(tf.action as "継続")
      ? (tf.action as ProposedTF["action"])
      : "継続",
    name: String(tf.name ?? `TF${i + 1}`),
    objective: String(tf.objective ?? ""),
    rationale: String(tf.rationale ?? ""),
    leader_suggestion: tf.leader_suggestion ? String(tf.leader_suggestion) : null,
    key_todos: Array.isArray(tf.key_todos) ? (tf.key_todos as string[]).map(String) : [],
    success_criteria: String(tf.success_criteria ?? ""),
    risk: tf.risk ? String(tf.risk) : null,
  }));

  return {
    quarter: String(parsed.quarter ?? ""),
    summary: String(parsed.summary ?? ""),
    tfs,
    overall_risk: parsed.overall_risk ? String(parsed.overall_risk) : null,
  };
}
