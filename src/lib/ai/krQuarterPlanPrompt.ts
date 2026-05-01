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
  session_type: "checkin" | "win_session";
  signal: "green" | "yellow" | "red" | null;
  signal_comment: string;
}

export interface QuarterPlanContext {
  today: string;
  current_quarter: string;    // "2026-2Q"
  target_quarter: string;     // "2026-3Q"
  planner_role: "GM" | "AGM" | "OM";
  objective_title: string;
  kr_title: string;
  tf_stats: TFStat[];
  signal_history: SignalEntry[];
  win_learnings: string;
  checkin_highlights: string;
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
  const signalBlock = recentSignals.length > 0
    ? recentSignals.map(s => {
        const dot = s.signal ? SIGNAL_LABEL[s.signal] : "—";
        const typeLabel = s.session_type === "checkin" ? "チェックイン" : "ウィン";
        const comment = s.signal_comment ? `「${s.signal_comment.slice(0, 60)}${s.signal_comment.length > 60 ? "…" : ""}」` : "";
        return `${s.week_start} ${typeLabel} ${dot} ${comment}`;
      }).join("\n")
    : "（記録なし）";

  const learningsBlock = ctx.win_learnings.trim() || "（記録なし）";
  const highlightBlock = ctx.checkin_highlights.trim() || "（記録なし）";
  const memberList = ctx.members.join("、") || "（未登録）";
  const focusBlock = ctx.issue_focus.trim() || "（指定なし）";

  return `【クォーター計画コンテキスト】
計画日：${ctx.today}
計画者役割：${ctx.planner_role}
今クォーター：${ctx.current_quarter}
計画対象クォーター：${ctx.target_quarter}

【Objective】
${ctx.objective_title}

【対象KR】
${ctx.kr_title}

【今クォーターのTF実績】
${tfBlock}

【シグナル推移（直近最大12週）】
${signalBlock}

【ウィンセッションの学び・外部環境変化】
${learningsBlock}

【チェックインのシグナルコメント】
${highlightBlock}

【計画者が注力したい課題】
${focusBlock}

【メンバー】
${memberList}`;
}

// ===== システムプロンプト =====

export const QUARTER_PLAN_DIALOGUE_SYSTEM_PROMPT = `あなたはOKR戦略ファシリテーターAIです。
クォーター末の計画セッションで、マネージャー（GM/AGM/OM）が翌クォーターの
Task Force（TF）計画を立てる対話を支援します。

【コンテキストの読み方】
最初のユーザーメッセージにクォーター計画コンテキストが含まれます：
- 現在・翌クォーターの情報と計画者役割
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
