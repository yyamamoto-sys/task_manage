// src/lib/ai/todoDecomposeClient.ts
//
// 【設計意図】
// ToDoタイトルをAIに渡し、具体的なタスク候補案をJSON配列で返す。
// OKR/KR/TF/メンバー情報をAIに渡す（ラボ機能例外ルール適用）。

import { invokeAI } from "./invokeAI";

export interface DecomposedTask {
  name: string;
  assignee_short_name: string | null;
  due_date: string | null;
  note: string;
}

const SYSTEM_PROMPT = `あなたはタスク分解の専門AIです。
ToDoのタイトル・所属するTask Force・Key Result・メンバーリストを受け取り、
具体的に実行可能なタス��候補を3〜6件、JSONのみで返します。

【出力形式】（JSONのみ。コードブロック\`\`\`は絶対に使わない）
[
  {
    "name": "タスク名（動詞から始める具体的な行動レベルで）",
    "assignee_short_name": "担当者のshort_name（メンバーリストから選ぶ。不明な場合はnull）",
    "due_date": "YYYY-MM-DD（妥当な期日。不明な場合はnull）",
    "note": "補足・理由（1文）"
  }
]

【タスク分解の原則】
- タスク名は「〇〇をする」「〇〇を確認する」など動詞で始める
- 1タスクは1〜2日で完了できる粒度にする
- 担当者は自然にアサインできそうな人を選ぶ（全員にばらけていい）
- 期日は today からの合理的な日数で設定する（数日〜2週間以内）`;

function parseJsonSafe<T>(text: string): T {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  return JSON.parse(cleaned) as T;
}

function validateDecomposed(data: unknown): DecomposedTask[] {
  if (!Array.isArray(data)) throw new Error("AIの返答が配列ではありません。");
  return data.map((item, i) => {
    if (!item || typeof item !== "object") throw new Error(`item[${i}]がオブジェクトではありません。`);
    const d = item as Record<string, unknown>;
    if (typeof d.name !== "string" || !d.name.trim()) throw new Error(`item[${i}].nameがstringではありません。`);
    return {
      name: d.name.trim(),
      assignee_short_name: typeof d.assignee_short_name === "string" ? d.assignee_short_name : null,
      due_date: typeof d.due_date === "string" && d.due_date ? d.due_date : null,
      note: typeof d.note === "string" ? d.note : "",
    };
  });
}

export async function callTodoDecomposeAI(params: {
  todoTitle: string;
  tfName: string;
  krTitle: string;
  memberShortNames: string[];
  today: string;
}): Promise<DecomposedTask[]> {
  const userMessage = JSON.stringify({
    todo_title: params.todoTitle,
    tf_name: params.tfName,
    kr_title: params.krTitle,
    members: params.memberShortNames,
    today: params.today,
  });

  const res = await invokeAI(SYSTEM_PROMPT, [{ role: "user", content: userMessage }], 1200);
  return validateDecomposed(parseJsonSafe(res.content[0].text));
}
