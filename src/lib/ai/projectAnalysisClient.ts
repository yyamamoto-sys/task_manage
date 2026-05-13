// src/lib/ai/projectAnalysisClient.ts
//
// 【設計意図】
// 1つのプロジェクトの状況（PJ概要・タスク一覧・マイルストーン・担当者名）をAIに渡し、
// 健全性の評価／進捗ペース／リスク・ボトルネック／負荷バランス／次の一手 を
// マークダウンで返してもらう「PJごとのAI分析」機能のクライアント。
//
// 【AI境界ルール（CLAUDE.md Section 6）】
// この機能が AI に渡してよいのは PJ / Task / Milestone / メンバーの short_name のみ。
// - ❌ KR / TF / Objective の情報は一切渡さない
// - ❌ project.contribution_memo（KR貢献メモ）は渡さない
// - ✅ project.name / purpose / status / 日程、task の各フィールド、milestone の name/date は渡してよい
//   （これらは "task-management"（payloadBuilder）と同等の範囲）
// intent は "project-analysis"。

import { invokeAI, type AIMessageInput } from "./invokeAI";

export interface ProjectAnalysisInput {
  project: {
    name: string;
    purpose: string;
    status: string;
    start_date: string;
    end_date: string;
    owner_short_names: string[];
  };
  tasks: {
    name: string;
    status: "todo" | "in_progress" | "done";
    priority: "high" | "mid" | "low" | null;
    assignee_short_name: string;
    start_date: string | null;
    due_date: string | null;
    estimated_hours: number | null;
    comment: string;
    created_at?: string;
    updated_at?: string;
    completed_at?: string | null;
  }[];
  milestones: { name: string; date: string; description?: string }[];
  members_short_names: string[];
  today: string;
}

const SYSTEM_PROMPT = `あなたは経験豊富なプロジェクトマネジメントの分析AIです。
1つのプロジェクトの概要・タスク一覧・マイルストーン・担当者を受け取り、
そのプロジェクトの「今の状態」を客観的に分析します。

【分析の観点】
- 進捗：完了/進行中/未着手の比率、完了ペース（completed_at の分布）が健全か
- 期日：期限切れ・直近に集中している期日・期日未設定のタスクの偏り
- 滞留：進行中のまま updated_at が長く動いていないタスク
- 負荷：担当者ごとのタスク件数・優先度の偏り（特定の人に集中していないか）
- マイルストーン：直近のマイルストーンに対して間に合いそうか
- リスク：上記から見えてくるボトルネック・抜け漏れ

【出力形式】マークダウン。コードブロックは使わない。見出しは ## 。箇条書きは - 。
以下の5セクションで簡潔に（全体で日本語800〜1200字程度）：

## ひとことで言うと
このプロジェクトの状態を1〜2文で。「順調」「やや遅れ気味」「要注意」など率直に。

## 進捗とペース
完了率・進行中の数・完了ペースの所感を2〜3文。具体的な数字を根拠に。

## 気になる点・リスク
- 具体的なタスク名や担当者名を挙げて2〜4件。事実ベースで。

## 負荷バランス
担当者ごとの偏りを1〜2文。偏っていなければ「概ね均等」と書く。

## 次の一手
- 来週やるべき具体的アクションを2〜4件。「誰が・何を」が言えるものは明記。

【ルール】
- 与えられた事実だけを根拠にする。推測で断定しない（「〜かもしれません」を使う）
- 担当者名は与えられた short_name をそのまま使う
- データが少ない場合は無理に分析せず「まだ判断材料が少ない」と正直に書く`;

function buildUserMessage(input: ProjectAnalysisInput): string {
  const p = input.project;
  const lines: string[] = [];
  lines.push(`【今日】${input.today}`);
  lines.push("");
  lines.push("【プロジェクト概要】");
  lines.push(`- 名前：${p.name}`);
  if (p.purpose) lines.push(`- 目的：${p.purpose}`);
  lines.push(`- ステータス：${p.status}`);
  if (p.start_date || p.end_date) lines.push(`- 期間：${p.start_date || "未設定"} 〜 ${p.end_date || "未設定"}`);
  if (p.owner_short_names.length) lines.push(`- オーナー：${p.owner_short_names.join("、")}`);
  lines.push("");
  lines.push(`【メンバー】${input.members_short_names.join("、") || "（登録なし）"}`);
  lines.push("");
  lines.push(`【タスク一覧（${input.tasks.length}件）】`);
  if (input.tasks.length === 0) {
    lines.push("（タスクなし）");
  } else {
    const statusJa: Record<string, string> = { todo: "未着手", in_progress: "進行中", done: "完了" };
    const prioJa: Record<string, string> = { high: "高", mid: "中", low: "低" };
    for (const t of input.tasks) {
      const parts = [
        `[${statusJa[t.status] ?? t.status}]`,
        t.name,
        `担当:${t.assignee_short_name || "未設定"}`,
        t.priority ? `優先:${prioJa[t.priority] ?? t.priority}` : null,
        t.due_date ? `期日:${t.due_date}` : "期日:未設定",
        t.start_date ? `開始:${t.start_date}` : null,
        t.estimated_hours != null ? `見積:${t.estimated_hours}h` : null,
        t.status === "in_progress" && t.updated_at ? `最終更新:${t.updated_at.slice(0, 10)}` : null,
        t.status === "done" && t.completed_at ? `完了日:${t.completed_at.slice(0, 10)}` : null,
        t.comment ? `メモ:${t.comment.replace(/\s+/g, " ").slice(0, 80)}` : null,
      ].filter(Boolean);
      lines.push(`- ${parts.join(" / ")}`);
    }
  }
  lines.push("");
  lines.push(`【マイルストーン（${input.milestones.length}件）】`);
  if (input.milestones.length === 0) {
    lines.push("（設定なし）");
  } else {
    for (const m of input.milestones) {
      lines.push(`- ${m.date}：${m.name}${m.description ? `（${m.description}）` : ""}`);
    }
  }
  lines.push("");
  lines.push("以上のプロジェクトについて、指定の形式で分析してください。");
  return lines.join("\n");
}

/** PJの状況をAIに分析させ、マークダウンのレポート文字列を返す。 */
export async function analyzeProject(input: ProjectAnalysisInput): Promise<string> {
  const messages: AIMessageInput[] = [{ role: "user", content: buildUserMessage(input) }];
  const res = await invokeAI(SYSTEM_PROMPT, messages, 1800, "project-analysis");
  return res.content[0].text;
}
