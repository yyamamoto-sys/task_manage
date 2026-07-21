// src/lib/ai/okrKrAnalysisClient.ts
//
// 【設計意図】
// 1つのKR（Key Result）について、そのKRに紐づく全TFの会議ノート履歴・KRの週次セッション（チェックイン/
// ウィン/freeform）・宣言・各TFのタスクを束ねてAIに渡し、KR全体とTFごとの状態を分析してマークダウンで返す
// （OKR循環ワークフロー Phase B / ③分析結果。④レポート作成の素材にもなる）。
//
// 【AI境界ルール（CLAUDE.md Section 6）】
// この機能は OKR/TF コンテキスト（KRタイトル・TF情報・会議ノート・セッション・宣言）を AI に渡す
// ラボ機能例外に該当する（kr-report / kr-why 等と同列）。intent は "okr-analysis"。
// - 渡してよい：KRタイトル、TF番号/名称/テーマ、会議ノートの各フィールド、kr_sessions/kr_declarations の内容、
//   各TFに紐づくタスクの状況、メンバーの short_name
// - 渡さない：Objective の本文。contribution_memo（PJ側のKR貢献メモ）は参照しない。

import { invokeAI, type AIMessageInput } from "./invokeAI";

export interface KrAnalysisNoteEntry {
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
export interface KrAnalysisTask {
  name: string;
  status: "todo" | "in_progress" | "done";
  priority: "high" | "mid" | "low" | null;
  assignee: string;
  due_date: string | null;
  updated_at?: string;
}
export interface KrAnalysisTf {
  number: string;
  name: string;
  theme: string;
  noteHistory: KrAnalysisNoteEntry[]; // 新しい週順
  tasks: KrAnalysisTask[];
}
export interface KrAnalysisSession {
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
export interface KrAnalysisDeclaration {
  week_start: string;
  member: string;
  content: string;
  due_date: string | null;
  result: "achieved" | "partial" | "not_achieved" | null;
  result_note: string;
}
export interface KrAnalysisInput {
  kr: { title: string };
  tfs: KrAnalysisTf[];
  sessions: KrAnalysisSession[];      // 新しい週順
  declarations: KrAnalysisDeclaration[]; // 新しい週順
  today: string;
}

const SYSTEM_PROMPT = `あなたはOKR推進の分析AIです。1つの Key Result（KR）について、
そのKRに紐づく全TF（タスクフォース）の会議ノート履歴・週次セッション（チェックイン/ウィン/freeform）・
宣言の達成状況・各TFのタスクを受け取り、KR全体とTFごとの「今の状態」を客観的に分析します。

【分析の観点】
- 進捗・ペース：各TFの会議ノートの「現在のプロセス状態(%)」の推移、タスクの完了状況、必達定義への距離
- 仮説の検証状況：「先週動かした仮説」→「実際に起きたこと」の往復が回っているか、検証から何が分かったか
- シグナル推移：チェックイン/ウィンの 🟢🟡🔴 の連続パターン
- 宣言の遂行：宣言が達成/一部/未達のどれが多いか、特定メンバーに偏っていないか
- リスク・ボトルネック：止まっているタスク、期日の集中、未決のまま残っている論点、TF間の依存
- 次サイクル（来週・次月）への示唆

【出力形式】マークダウン。コードブロックは使わない。見出しは ## / ### 。箇条書きは - 。
全体で日本語1500〜2500字程度。次の構成で：

## KR全体のひとことで言うと
このKRの状態を1〜2文で。「順調」「やや遅れ気味」「要注意」など率直に。TF横断で見えるパターンも。

## KR全体の進捗・リスク
- TF横断で見たペース・シグナル・宣言の状況、TF間で噛み合っていない点、注意すべきリスクを3〜6件

### TFごとの状況
（与えられた各TFについて、TF番号と名称を見出しにして以下を簡潔に）
#### TF{番号} {名称}
- 状態：1文（順調/遅れ気味/要注意）
- 進捗とペース：%の推移・タスク・必達定義との距離（具体的な数字）
- 気になる点：具体的なタスク名・論点・担当者名を1〜3件
- 次の一手：誰が・何を を1〜3件（会議ノートの「次にやる一手」も踏まえる）

## レポート作成のための要点
（④レポート作成にそのまま使える形で）
- 進捗シグナル（このKR全体）と根拠
- 今週の主要課題（2〜3点）
- 今週必達アクション TOP2〜3（誰が・何を・いつまでに）
- 次の一手の提案（仮説変更/打ち手変更/強度変更/対象変更のどれかの観点で）

【ルール】
- 与えられた事実だけを根拠にする。推測で断定しない（「〜かもしれません」を使う）
- メンバー名は与えられた short_name をそのまま使う
- 担当者欄に「・」が含まれる場合は共同担当（例：「山本・田中」=2名）。負荷を1人に帰属させないこと
- データが少ない場合は無理に分析せず「まだ判断材料が少ない」と正直に書く

【freeform セッション（type==="freeform"）の扱い】
- シグナルは持たないが、summary（議論サマリ）/decisions（決定事項）/kr_mentions（言及KR）
  が会議の本質情報。これらを「KR全体の進捗・リスク」「次の一手」に積極的に反映すること`;

function clip(s: string, n: number): string { return s.replace(/\s+/g, " ").trim().slice(0, n); }

function buildUserMessage(input: KrAnalysisInput): string {
  const L: string[] = [];
  const sigJa: Record<string, string> = { green: "🟢順調", yellow: "🟡注意", red: "🔴要対応" };
  const typeJa: Record<string, string> = { checkin: "チェックイン", win_session: "ウィン", freeform: "OKR議論" };
  const resJa: Record<string, string> = { achieved: "達成", partial: "一部達成", not_achieved: "未達" };
  const statJa: Record<string, string> = { todo: "未着手", in_progress: "進行中", done: "完了" };
  const prioJa: Record<string, string> = { high: "高", mid: "中", low: "低" };

  L.push(`【今日】${input.today}`);
  L.push(`【KR】${input.kr.title}`);
  L.push("");

  for (const tf of input.tfs) {
    L.push(`========== TF${tf.number} ${tf.name} ==========`);
    if (tf.theme) L.push(`【このTFのテーマ】${clip(tf.theme, 300)}`);
    L.push(`【会議ノートの履歴（新しい週順・${tf.noteHistory.length}件）】`);
    if (tf.noteHistory.length === 0) L.push("（ノートなし）");
    for (const n of tf.noteHistory) {
      L.push(`▼ ${n.week_start} の週`);
      if (n.target_definition) L.push(`  必達の定義：${clip(n.target_definition, 200)}`);
      if (n.hypotheses) L.push(`  ①先週動かした仮説：${clip(n.hypotheses, 300)}`);
      if (n.facts) L.push(`  ②起きたこと：${clip(n.facts, 400)}`);
      if (n.next_actions) L.push(`  ③次の一手：${clip(n.next_actions, 300)}`);
      L.push(`  ④現在の状態：${n.progress_pct != null ? n.progress_pct + "%" : "（%未記入）"}${n.progress_reason ? " — " + clip(n.progress_reason, 250) : ""}`);
      if (n.todo) L.push(`  TODO：${clip(n.todo, 250)}`);
    }
    L.push(`【このTFに紐づくタスク（${tf.tasks.length}件）】`);
    if (tf.tasks.length === 0) L.push("（タスクなし）");
    for (const t of tf.tasks) {
      L.push(`  - [${statJa[t.status] ?? t.status}] ${t.name} / 担当:${t.assignee || "未設定"}${t.priority ? ` / 優先:${prioJa[t.priority]}` : ""} / 期日:${t.due_date || "未設定"}${t.status === "in_progress" && t.updated_at ? ` / 最終更新:${t.updated_at.slice(0, 10)}` : ""}`);
    }
    L.push("");
  }

  L.push(`【週次セッション（このKR・新しい週順・${input.sessions.length}件）】`);
  if (input.sessions.length === 0) L.push("（セッションなし）");
  for (const s of input.sessions) {
    L.push(`- ${s.week_start} / ${typeJa[s.type] ?? s.type} / ${s.signal ? sigJa[s.signal] : "シグナルなし"}`);
    if (s.signal_comment) L.push(`    コメント：${clip(s.signal_comment, 200)}`);
    if (s.learnings) L.push(`    学び：${clip(s.learnings, 200)}`);
    if (s.external_changes) L.push(`    外部環境変化：${clip(s.external_changes, 150)}`);
    if (s.summary) L.push(`    議論サマリ：${clip(s.summary, 250)}`);
    if (s.decisions) L.push(`    決定事項：${clip(s.decisions, 200)}`);
  }
  L.push("");
  L.push(`【宣言の遂行（新しい週順・${input.declarations.length}件）】`);
  if (input.declarations.length === 0) L.push("（宣言の記録なし）");
  for (const d of input.declarations) {
    L.push(`- ${d.week_start}週 ${d.member}：${clip(d.content, 150)}${d.due_date ? `（期日${d.due_date}）` : ""}${d.result ? ` → ${resJa[d.result] ?? d.result}${d.result_note ? "（" + clip(d.result_note, 80) + "）" : ""}` : ""}`);
  }
  L.push("");
  L.push("以上のKRについて、指定の形式で分析してください。");
  return L.join("\n");
}

/** KRの状況をAIに分析させ、マークダウンのレポート文字列を返す。 */
export async function analyzeKr(input: KrAnalysisInput): Promise<string> {
  const messages: AIMessageInput[] = [{ role: "user", content: buildUserMessage(input) }];
  const res = await invokeAI(SYSTEM_PROMPT, messages, 3000, "okr-analysis");
  return res.content[0].text;
}
