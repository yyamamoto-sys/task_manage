// src/lib/ai/okrTfAnalysisClient.ts
//
// 【設計意図】
// 1つのTF（タスクフォース）の状況を、会議ノートの履歴・KRセッション（チェックイン/ウィン/freeform）・
// 宣言・TFのタスクを束ねてAIに渡し、健全性・仮説の検証状況・リスク・負荷・次サイクルへの示唆を
// マークダウンで返してもらう「TF単位のAI分析」のクライアント（OKR循環ワークフロー Phase B / ③分析結果）。
//
// 【AI境界ルール（CLAUDE.md Section 6）】
// この機能は OKR/TF コンテキスト（KRタイトル・TF情報・会議ノート・セッション・宣言）を AI に渡す
// ラボ機能例外に該当する（kr-report / kr-why 等と同列）。intent は "okr-tf-analysis"。
// - 渡してよい：KRタイトル、TF番号/名称/テーマ、会議ノートの各フィールド、kr_sessions/kr_declarations の内容、
//   そのTFに紐づくタスクの状況、メンバーの short_name
// - 渡さない：Objective の本文（必要ないため）。contribution_memo（PJ側のKR貢献メモ）はそもそも参照しない。

import { invokeAI, type AIMessageInput } from "./invokeAI";

export interface TfAnalysisNoteEntry {
  week_start: string;
  target_definition: string;
  eval_criteria: string;
  hypotheses: string;
  facts: string;
  next_actions: string;
  progress_pct: number | null;
  progress_reason: string;
  todo: string;
}
export interface TfAnalysisSession {
  week_start: string;
  type: "checkin" | "win_session" | "freeform";
  signal: "green" | "yellow" | "red" | null;
  signal_comment: string;
  learnings: string;
  external_changes: string;
  summary: string;
  decisions: string;
  kr_mentions: string;
}
export interface TfAnalysisDeclaration {
  week_start: string;
  member: string;
  content: string;
  due_date: string | null;
  result: "achieved" | "partial" | "not_achieved" | null;
  result_note: string;
}
export interface TfAnalysisTask {
  name: string;
  status: "todo" | "in_progress" | "done";
  priority: "high" | "mid" | "low" | null;
  assignee: string;
  due_date: string | null;
  updated_at?: string;
}
export interface TfAnalysisInput {
  tf: { number: string; name: string; theme: string };
  kr: { title: string };
  noteHistory: TfAnalysisNoteEntry[];   // 新しい週順
  sessions: TfAnalysisSession[];          // 新しい週順
  declarations: TfAnalysisDeclaration[];  // 新しい週順
  tasks: TfAnalysisTask[];
  today: string;
}

const SYSTEM_PROMPT = `あなたはOKR推進の分析AIです。1つのタスクフォース（TF）について、
会議ノートの履歴・週次セッション（チェックイン/ウィン/freeform）・宣言の達成状況・TFのタスクを受け取り、
その TF の「今の状態」を客観的に分析します。

【分析の観点】
- 進捗・ペース：会議ノートの「現在のプロセス状態(%)」の推移、タスクの完了状況、必達定義への距離
- 仮説の検証状況：「先週動かした仮説」→「実際に起きたこと」の往復が回っているか、検証から何が分かったか
- シグナル推移：チェックイン/ウィンの 🟢🟡🔴 の連続パターン
- 宣言の遂行：宣言が達成/一部/未達のどれが多いか、特定メンバーに偏っていないか
- リスク・ボトルネック：止まっているタスク、期日の集中、未決のまま残っている論点
- 次サイクル（来週・次月）への示唆

【出力形式】マークダウン。コードブロックは使わない。見出しは ## 。箇条書きは - 。
以下の6セクションで簡潔に（全体で日本語1000〜1500字程度）：

## ひとことで言うと
このTFの状態を1〜2文で。「順調」「やや遅れ気味」「要注意」など率直に。

## 進捗とペース
%の推移・タスク・必達定義との距離を2〜3文。具体的な数字を根拠に。

## 仮説の検証状況
仮説→事実→次の一手 のサイクルが回っているか、検証で分かったことを2〜4文。

## シグナルと宣言
シグナルの推移（連続🔴など）と宣言の遂行状況を1〜3文。偏りがあれば指摘。

## 気になる点・リスク
- 具体的なタスク名・論点・担当者名を挙げて2〜4件。事実ベースで。

## 次の一手（来週・次月へ）
- 具体的アクションを2〜4件。「誰が・何を」が言えるものは明記。会議ノートの「次にやる一手」も踏まえる。

【ルール】
- 与えられた事実だけを根拠にする。推測で断定しない（「〜かもしれません」を使う）
- メンバー名は与えられた short_name をそのまま使う
- データが少ない場合は無理に分析せず「まだ判断材料が少ない」と正直に書く`;

function buildUserMessage(input: TfAnalysisInput): string {
  const L: string[] = [];
  const sigJa: Record<string, string> = { green: "🟢順調", yellow: "🟡注意", red: "🔴要対応" };
  const typeJa: Record<string, string> = { checkin: "チェックイン", win_session: "ウィン", freeform: "OKR議論" };
  const resJa: Record<string, string> = { achieved: "達成", partial: "一部達成", not_achieved: "未達" };
  const statJa: Record<string, string> = { todo: "未着手", in_progress: "進行中", done: "完了" };
  const prioJa: Record<string, string> = { high: "高", mid: "中", low: "低" };

  L.push(`【今日】${input.today}`);
  L.push("");
  L.push(`【KR】${input.kr.title}`);
  L.push(`【TF】TF${input.tf.number} ${input.tf.name}`);
  if (input.tf.theme) L.push(`【このTFのテーマ】${input.tf.theme}`);
  L.push("");

  L.push(`【会議ノートの履歴（新しい週順・最大${input.noteHistory.length}件）】`);
  if (input.noteHistory.length === 0) L.push("（ノートなし）");
  for (const n of input.noteHistory) {
    L.push(`▼ ${n.week_start} の週`);
    if (n.target_definition) L.push(`  必達の定義：${n.target_definition.replace(/\s+/g, " ").slice(0, 200)}`);
    if (n.hypotheses) L.push(`  ①先週動かした仮説：${n.hypotheses.replace(/\s+/g, " ").slice(0, 300)}`);
    if (n.facts) L.push(`  ②起きたこと：${n.facts.replace(/\s+/g, " ").slice(0, 400)}`);
    if (n.next_actions) L.push(`  ③次の一手：${n.next_actions.replace(/\s+/g, " ").slice(0, 300)}`);
    L.push(`  ④現在の状態：${n.progress_pct != null ? n.progress_pct + "%" : "（%未記入）"}${n.progress_reason ? " — " + n.progress_reason.replace(/\s+/g, " ").slice(0, 250) : ""}`);
    if (n.todo) L.push(`  TODO：${n.todo.replace(/\s+/g, " ").slice(0, 250)}`);
  }
  L.push("");

  L.push(`【週次セッション（このKR・新しい週順・最大${input.sessions.length}件）】`);
  if (input.sessions.length === 0) L.push("（セッションなし）");
  for (const s of input.sessions) {
    const parts = [`${s.week_start}`, typeJa[s.type] ?? s.type, s.signal ? sigJa[s.signal] : "シグナルなし"];
    L.push(`- ${parts.join(" / ")}`);
    if (s.signal_comment) L.push(`    コメント：${s.signal_comment.replace(/\s+/g, " ").slice(0, 200)}`);
    if (s.learnings) L.push(`    学び：${s.learnings.replace(/\s+/g, " ").slice(0, 200)}`);
    if (s.external_changes) L.push(`    外部環境変化：${s.external_changes.replace(/\s+/g, " ").slice(0, 150)}`);
    if (s.summary) L.push(`    議論サマリ：${s.summary.replace(/\s+/g, " ").slice(0, 250)}`);
    if (s.decisions) L.push(`    決定事項：${s.decisions.replace(/\s+/g, " ").slice(0, 200)}`);
  }
  L.push("");

  L.push(`【宣言の遂行（新しい週順・最大${input.declarations.length}件）】`);
  if (input.declarations.length === 0) L.push("（宣言の記録なし）");
  for (const d of input.declarations) {
    L.push(`- ${d.week_start}週 ${d.member}：${d.content.replace(/\s+/g, " ").slice(0, 150)}${d.due_date ? `（期日${d.due_date}）` : ""}${d.result ? ` → ${resJa[d.result] ?? d.result}${d.result_note ? "（" + d.result_note.replace(/\s+/g, " ").slice(0, 80) + "）" : ""}` : ""}`);
  }
  L.push("");

  L.push(`【このTFに紐づくタスク（${input.tasks.length}件）】`);
  if (input.tasks.length === 0) L.push("（タスクなし）");
  for (const t of input.tasks) {
    L.push(`- [${statJa[t.status] ?? t.status}] ${t.name} / 担当:${t.assignee || "未設定"}${t.priority ? ` / 優先:${prioJa[t.priority]}` : ""} / 期日:${t.due_date || "未設定"}${t.status === "in_progress" && t.updated_at ? ` / 最終更新:${t.updated_at.slice(0, 10)}` : ""}`);
  }
  L.push("");
  L.push("以上のTFについて、指定の形式で分析してください。");
  return L.join("\n");
}

/** TFの状況をAIに分析させ、マークダウンのレポート文字列を返す。 */
export async function analyzeTf(input: TfAnalysisInput): Promise<string> {
  const messages: AIMessageInput[] = [{ role: "user", content: buildUserMessage(input) }];
  const res = await invokeAI(SYSTEM_PROMPT, messages, 2200, "okr-tf-analysis");
  return res.content[0].text;
}
