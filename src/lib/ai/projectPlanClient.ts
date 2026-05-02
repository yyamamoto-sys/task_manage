// src/lib/ai/projectPlanClient.ts
//
// 【設計意図】
// AIとの対話でプロジェクト計画を立案し、PJ+タスク一覧をJSON出力する。
// ラボ機能例外ルール：メンバー情報をAIに渡すことを許可。

import { invokeAI } from "./invokeAI";

export type PlanMessage = { role: "user" | "assistant"; content: string };

export interface PlannedTask {
  name: string;
  assignee_short_name: string | null;
  due_date: string | null;
  note: string | null;
}

export interface ProjectPlan {
  project_name: string;
  purpose: string;
  tasks: PlannedTask[];
}

const DIALOGUE_SYSTEM = `あなたはプロジェクト計画のサポートAIです。
ユーザーが新しいプロジェクトを立ち上げる際のヒアリングを行います。

【会話のルール】
- 1ターンに1つの質問のみ（短く・具体的に）
- ユーザーの回答を1文で受け止めてから次の質問をする
- ヒアリングの順序：① 目的・背景 → ② 主な成果物・スコープ → ③ 担当メンバー・期間のイメージ
- 3ターン以内で必要な情報を揃える

最初のターンは必ず次の一文から始めてください：
「どんなプロジェクトを立ち上げたいですか？目的や背景を教えてください。」`;

const FINALIZE_SYSTEM = `あなたはプロジェクト計画AIです。
対話の内容をもとに、プロジェクト計画をJSONのみで出力してください。
コードブロック（\`\`\`）は絶対に使わないこと。

【出力形式】
{
  "project_name": "プロジェクト名（簡潔に20文字以内）",
  "purpose": "目的・背景（1〜2文）",
  "tasks": [
    {
      "name": "タスク名（動詞で始める具体的な行動・20文字以内）",
      "assignee_short_name": "担当者のshort_name（メンバーリストから選ぶ。不明ならnull）",
      "due_date": "YYYY-MM-DD（today基準。不明ならnull）",
      "note": "補足1文（不要ならnull）"
    }
  ]
}

【タスク生成の原則】
- タスクは4〜8件程度
- 1タスクは1〜5日で完了できる粒度
- プロジェクトの流れ（準備→実行→完了）の順で並べる
- 担当者が不明なものはnullにする（無理に割り当てない）`;

async function callAI(system: string, messages: PlanMessage[], maxTokens: number): Promise<string> {
  const res = await invokeAI(system, messages, maxTokens, "project-plan");
  return res.content[0].text;
}

export async function callProjectPlanDialogue(messages: PlanMessage[]): Promise<string> {
  return callAI(DIALOGUE_SYSTEM, messages, 250);
}

function parseJsonSafe<T>(text: string): T {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  return JSON.parse(cleaned) as T;
}

function validatePlan(data: unknown): ProjectPlan {
  if (!data || typeof data !== "object") throw new Error("AIの返答がオブジェクトではありません。");
  const d = data as Record<string, unknown>;
  if (typeof d.project_name !== "string" || !d.project_name.trim()) throw new Error("project_nameが不正です。");
  if (typeof d.purpose !== "string") throw new Error("purposeが不正です。");
  if (!Array.isArray(d.tasks)) throw new Error("tasksが配列ではありません。");
  return {
    project_name: d.project_name.trim(),
    purpose: typeof d.purpose === "string" ? d.purpose.trim() : "",
    tasks: d.tasks.map((item: unknown, i: number) => {
      if (!item || typeof item !== "object") throw new Error(`tasks[${i}]が不正です。`);
      const t = item as Record<string, unknown>;
      return {
        name: typeof t.name === "string" ? t.name.trim() : `タスク${i + 1}`,
        assignee_short_name: typeof t.assignee_short_name === "string" ? t.assignee_short_name : null,
        due_date: typeof t.due_date === "string" && t.due_date ? t.due_date : null,
        note: typeof t.note === "string" ? t.note : null,
      };
    }),
  };
}

export async function callProjectPlanFinalize(params: {
  messages: PlanMessage[];
  memberShortNames: string[];
  today: string;
}): Promise<ProjectPlan> {
  const finalizeMessages: PlanMessage[] = [
    ...params.messages,
    {
      role: "user",
      content: `以上の対話をもとにプロジェクト計画をJSONで出力してください。
メンバーリスト: ${params.memberShortNames.join(", ")}
今日の日付: ${params.today}`,
    },
  ];
  const text = await callAI(FINALIZE_SYSTEM, finalizeMessages, 1500);
  return validatePlan(parseJsonSafe(text));
}
