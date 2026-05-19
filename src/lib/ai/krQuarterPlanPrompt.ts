// src/lib/ai/krQuarterPlanPrompt.ts
//
// 【設計意図】
// クォーター計画AIの：クォーター計算ユーティリティ・コンテキスト型・
// AIへ渡す構造化テキスト生成・システムプロンプト定数を集約する。
// KR/TF/セッションデータをAIに渡す（ラボ機能例外ルール適用）。

import type { KrSession } from "../supabase/krSessionStore";

// ===== クォーター計算ユーティリティ =====

const QUARTER_MONTHS: Record<number, string> = {
  1: "1〜3月", 2: "4〜6月", 3: "7〜9月", 4: "10〜12月",
};

export function getQuarterFromDate(date: Date): number {
  const m = date.getMonth() + 1;
  return m <= 3 ? 1 : m <= 6 ? 2 : m <= 9 ? 3 : 4;
}

export function getQuarterValue(date: Date = new Date()): string {
  return `${date.getFullYear()}-${getQuarterFromDate(date)}Q`;
}

export function getQuarterLabel(value: string): string {
  const [year, qStr] = value.split("-");
  const q = parseInt(qStr);
  return `${year}年${qStr}（${QUARTER_MONTHS[q] ?? ""}）`;
}

export function nextQuarterValue(value: string): string {
  const [year, qStr] = value.split("-");
  const q = parseInt(qStr);
  if (q === 4) return `${parseInt(year) + 1}-1Q`;
  return `${year}-${q + 1}Q`;
}

export function previousQuarterValue(value: string): string {
  const [year, qStr] = value.split("-");
  const q = parseInt(qStr);
  if (q === 1) return `${parseInt(year) - 1}-4Q`;
  return `${year}-${q - 1}Q`;
}

/** クォーター値（"2026-2Q"）の開始日・終了日（YYYY-MM-DD）を返す。 */
export function quarterDateRange(value: string): { start: string; end: string } {
  const [yearStr, qStr] = value.split("-");
  const year = parseInt(yearStr);
  const q = parseInt(qStr);
  const startMonth = (q - 1) * 3 + 1; // 1 / 4 / 7 / 10
  const start = new Date(year, startMonth - 1, 1);
  const end = new Date(year, startMonth + 2, 0); // その四半期の最終月の末日
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { start: fmt(start), end: fmt(end) };
}

export function getQuarterOptions(base: Date = new Date()): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  let current = getQuarterValue(base);
  for (let i = 0; i < 4; i++) {
    options.push({ value: current, label: getQuarterLabel(current) });
    current = nextQuarterValue(current);
  }
  return options;
}

// ===== 型定義 =====

export interface TFStat {
  tf_number: string;
  name: string;
  total_tasks: number;
  done_tasks: number;
  in_progress_tasks: number;
  todo_tasks: number;
  completion_pct: number;  // 0〜100
}

export interface SignalEntry {
  week_start: string;
  session_type: "checkin" | "win_session" | "freeform";
  signal: "green" | "yellow" | "red" | null;
  signal_comment: string;
  /** freeform 限定：自由形式OKR議論のサマリ・決定事項（クォーター計画 AI の素材） */
  summary?: string;
  decisions?: string;
}

export interface QuarterPlanContext {
  today: string;
  current_quarter: string;    // "2026-2Q"
  prev_quarter: string;       // "2026-1Q"（target_quarter の1つ前）
  target_quarter: string;     // "2026-3Q"
  objective_title: string;
  objective_purpose: string;
  kr_title: string;
  tf_stats: TFStat[];
  signal_history: SignalEntry[];
  win_learnings: string;
  checkin_highlights: string;
  /** 前クォーターの会議ノート（各TFのテーマ・必達定義・①〜④・TODO）。マークダウン整形済み */
  prev_notes_text: string;
  /** 前クォーターの宣言と結果。マークダウン整形済み */
  prev_declarations_text: string;
  /** 前クォーターに生成された AI 分析（KR分析・Objective分析）。マークダウン整形済み */
  prev_analyses_text: string;
  members: string[];
  issue_focus: string;
}

// ===== コンテキスト構築 =====

const SIGNAL_LABEL: Record<string, string> = {
  green: "🟢", yellow: "🟡", red: "🔴",
};

export function buildContextText(ctx: QuarterPlanContext): string {
  const tfBlock = ctx.tf_stats.length > 0
    ? ctx.tf_stats.map(tf => {
        const pct = tf.total_tasks > 0 ? `（${tf.completion_pct}%達成）` : "（タスクなし）";
        return `TF${tf.tf_number} ${tf.name}\n  タスク達成：${tf.done_tasks}/${tf.total_tasks}件 ${pct}`;
      }).join("\n")
    : "（TF未登録）";

  const recentSignals = ctx.signal_history.slice(0, 12);
  const typeLabelMap: Record<SignalEntry["session_type"], string> = {
    checkin: "チェックイン", win_session: "ウィン", freeform: "OKR議論",
  };
  const signalBlock = recentSignals.length > 0
    ? recentSignals.map(s => {
        const dot = s.signal ? SIGNAL_LABEL[s.signal] : "—";
        const typeLabel = typeLabelMap[s.session_type] ?? s.session_type;
        const comment = s.signal_comment ? `「${s.signal_comment.slice(0, 60)}${s.signal_comment.length > 60 ? "…" : ""}」` : "";
        const extras: string[] = [];
        if (s.session_type === "freeform") {
          if (s.summary)   extras.push(`サマリ：${s.summary.slice(0, 80)}${s.summary.length > 80 ? "…" : ""}`);
          if (s.decisions) extras.push(`決定：${s.decisions.replace(/\n+/g, " / ").slice(0, 80)}`);
        }
        return `${s.week_start} ${typeLabel} ${dot} ${comment}${extras.length > 0 ? "  " + extras.join(" / ") : ""}`;
      }).join("\n")
    : "（記録なし）";

  const learningsBlock = ctx.win_learnings.trim() || "（記録なし）";
  const highlightBlock = ctx.checkin_highlights.trim() || "（記録なし）";
  const memberList = ctx.members.join("、") || "（未登録）";
  const focusBlock = ctx.issue_focus.trim() || "（指定なし）";

  return `【クォーター計画コンテキスト】
計画日：${ctx.today}
今クォーター：${ctx.current_quarter}
前クォーター：${ctx.prev_quarter}
計画対象クォーター：${ctx.target_quarter}

【Objective】
${ctx.objective_title}
${ctx.objective_purpose ? `（目的）${ctx.objective_purpose}` : ""}

【対象KR】
${ctx.kr_title}

【今クォーターのTF実績（タスク達成率）】
${tfBlock}

【シグナル推移（直近最大12週）】
${signalBlock}

【前クォーターの会議ノート（各TFの必達定義・先週動かした仮説・実際に起きたこと・次の一手・現在の状態・TODO）】
${ctx.prev_notes_text.trim() || "（記録なし）"}

【前クォーターの宣言と結果（誰が何を宣言し達成/未達か）】
${ctx.prev_declarations_text.trim() || "（記録なし）"}

【前クォーターのAI分析（KR単位＆Objective単位の蓄積）】
${ctx.prev_analyses_text.trim() || "（記録なし）"}

【ウィンセッションの学び・外部環境変化（全期間からの抜粋）】
${learningsBlock}

【チェックインのシグナルコメント（全期間からの抜粋）】
${highlightBlock}

【計画者が注力したい課題・テーマ】
${focusBlock}

【メンバー】
${memberList}`;
}

// ===== システムプロンプト =====

/**
 * 計画セッションの「最初の応答」専用プロンプト。
 * AI は与えられた前クォーターの全データ（会議ノート・セッション・宣言・分析・タスク実績）を
 * 総動員し、まずしっかりした分析を提示してから、計画立案のための最初の問いを1つ投げる。
 */
export const QUARTER_PLAN_INITIAL_ANALYSIS_SYSTEM_PROMPT = `あなたはOKR戦略ファシリテーターAIです。
ユーザーは翌クォーターの Task Force（TF）計画を立てようとしています。
最初のメッセージで、ユーザーから渡されるコンテキスト（前クォーターの会議ノート・週次セッション・
宣言と達成状況・蓄積された AI 分析・タスク実績・シグナル推移）を「総動員」して、
**まずしっかりした分析を提示してから**、計画立案のための最初の問いを1つだけ投げてください。

【最初の応答のフォーマット（マークダウン。コードブロックは使わない）】

## 前クォーター（{prev_quarter}）の振り返り
- このKRの全体感を3〜5文。達成度・シグナル推移のパターン・主要な学び・残った論点をデータに基づいて。
- 配下KR分析・Objective分析が蓄積されていれば、それを最大限活用し、再分析ではなく要点の統合を行う。

### TFごとの状況
（コンテキストに含まれる各TFについて）
#### TF{番号} {名称}
- 状態：1文（順調/遅れ気味/要対応）。タスク達成率・シグナル・宣言達成状況を根拠に。
- 翌Q検討の論点：1〜2件。「このTFを継続/変更/廃止/分割するべきか」の判断材料を提示。

## 翌クォーター（{target_quarter}）計画で押さえるべき論点
- 3〜5件の論点を箇条書き。前Qデータから読み取れる、計画で必ず議論すべき点。
- 計画者が指定した「注力したい課題・テーマ」がある場合は最優先で組み込む。

## 最初に決めたいこと
1〜2文で「まずはこの点を決めましょう」と提示し、**最後に問いを1つ**投げる。
例：「最も低達成率だったTF2について、翌Qで継続するか・縮小するか・廃止するか、まずはどうお考えですか？」

【厳守事項】
- データに基づかない断定はしない（数字や記録の言及を根拠に）
- 解決策の押し付けはしない。判断材料を提示して問う形にする
- 前クォーターの記録が少なくても、与えられた情報を最大限活用してできる範囲で分析する
- 「分析」は再構成・要点抽出。同じことを繰り返さず、計画判断に直結する形にまとめる`;

export const QUARTER_PLAN_DIALOGUE_SYSTEM_PROMPT = `あなたはOKR戦略ファシリテーターAIです。
クォーター末の計画セッションで、翌クォーターの
Task Force（TF）計画を立てる対話を支援します。

【コンテキストの読み方】
最初のユーザーメッセージにクォーター計画コンテキストが含まれます：
- 現在・翌クォーターの情報
- 今QのTF一覧・タスク達成率
- 週次シグナル推移（チェックイン・ウィンセッション）
- ウィンセッションの学び・外部環境変化
- 計画者が注力したい課題

【対話の目的】
「翌クォーターはどのTFを継続・変更・廃止し、何を新設するか？」を決める。

【進め方】
1. 最初の返答：今Qで最も課題のあったTF（低達成率または🔴シグナル多）を
   取り上げ、翌Q継続するかを問う
2. TFごとに継続/変更/廃止を決めていく（1ターン1TF）
3. 変更・新設TFの名称・目的・主担当を具体化する
4. リソース制約を常に意識する（「〇名のチームで3TFは多すぎる懸念があります」等）
5. 全TFの方針が固まったら「計画書を生成できます」と伝える

【返答ルール（厳守）】
- 必ず「データに基づく観察（1文）」+「具体的な問い（1文）」の計2文のみ
- 観察は数字を使う：「TF2の達成率が25%、3週連続🔴シグナルでした」
- 問いは選択肢を提示する：「翌Qで継続・縮小・廃止のどれが適切でしょうか？」
- 承認・評価コメント禁止（「なるほど」「おっしゃる通り」等）
- 解決策の押し付け禁止
- 3文以上の返答禁止
- 複数TFの同時議論禁止`;

export const QUARTER_PLAN_GENERATION_SYSTEM_PROMPT = `あなたはOKR計画書生成AIです。
以下のコンテキストと対話記録を受け取り、翌クォーターのTask Force計画を
JSON形式で出力してください。

出力形式（純粋なJSONのみ。コードブロック・前後の説明文は不要）：
{
  "quarter": "2026-3Q",
  "summary": "翌Qの全体方針（2〜3文）",
  "tfs": [
    {
      "tf_number": 1,
      "action": "継続",
      "name": "TF名（10文字以内）",
      "objective": "このTFが達成すべき状態（1文）",
      "rationale": "根拠（前Qデータを根拠に、1文）",
      "leader_suggestion": "メンバー短縮名またはnull",
      "key_todos": ["ToDo1", "ToDo2", "ToDo3"],
      "success_criteria": "完了の定義（1文）",
      "risk": "主なリスク（1文）またはnull"
    }
  ],
  "overall_risk": "全体リスク（1文）またはnull"
}

制約：
- actionは "継続" | "変更" | "廃止" | "新設" のいずれか
- 廃止TFも action="廃止" で含める（記録のため）
- tf_numberは1から連番
- key_todosは2〜4件
- leader_suggestionはコンテキストのメンバーリストから選ぶ（不明ならnull）`;
