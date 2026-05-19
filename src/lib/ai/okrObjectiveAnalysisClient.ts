// src/lib/ai/okrObjectiveAnalysisClient.ts
//
// 【設計意図】
// Objective（年間目標）全体を俯瞰した AI 分析。配下の各KRの「最新のKR分析」＋ 直近セッション・宣言 ＋
// 全KRのタスクサマリを束ねて、Objective達成への全体見立て・KR間バランス・横断リスクを抽出する。
// （OKR循環ワークフロー Phase B 仕上げ。AIIntent は既存の "okr-analysis" を流用）
//
// 【AI境界ルール】
// O/KR/TF を AI に渡して良いルール改定（2026-05-13）後の機能。OKR関連情報を全面的に活用する。

import { invokeAI, type AIMessageInput } from "./invokeAI";

export interface ObjectiveAnalysisKrInput {
  id: string;
  title: string;
  /** KR配下の TFリスト（番号・名前・テーマ） */
  tfs: { number: string; name: string; theme?: string }[];
  /** 直近のKR分析（あれば）。これがあるとObjective分析の素材として最も濃い */
  latestKrAnalysis?: { content: string; created_at: string } | null;
  /** 直近のセッション（新しい順・最大数件） */
  sessions: {
    week_start: string;
    type: "checkin" | "win_session" | "freeform";
    signal: "green" | "yellow" | "red" | null;
    signal_comment: string;
    learnings: string;
    // freeform 固有：自由形式のOKR議論で会議の本質情報。type==="freeform" のみ意味あり
    summary?: string;
    decisions?: string;
    kr_mentions?: string;
  }[];
  /** タスクのサマリ */
  taskSummary: { total: number; done: number; in_progress: number; todo: number; overdue: number };
}

export interface ObjectiveAnalysisInput {
  objective: { title: string; purpose?: string; period?: string };
  krs: ObjectiveAnalysisKrInput[];
  today: string;
}

const SYSTEM_PROMPT = `あなたはOKR推進の分析AIです。1つの Objective（年間目標）の全体を俯瞰し、
配下の各KRの最新の分析・週次セッション・タスク状況を束ねて、Objective達成への見立てと
KR間のバランス・横断的なリスク・全体としての次の一手をまとめます。

【出力形式】マークダウン。コードブロックは使わない。見出しは ## / ### 。箇条書きは - 。
全体で日本語1500〜2500字程度、次の構成で：

## Objective 全体のひとことで言うと
状態を1〜2文で。年間目標に対して順調か／遅れか／要対応か。横断で見えるパターンも。

## KR間のバランスと横断リスク
- KR間で温度差・進捗のばらつきがあるか、リソース・期日が一方に偏っていないか、KR間の依存・矛盾はないか、3〜6件

### 各KRの状態
（与えられた各KRごとに、KRタイトルを見出しにして以下を簡潔に）
#### {KRタイトル}
- 状態：1文（順調/遅れ気味/要注意）。KR分析の所感を反映
- 直近セッションのシグナル推移：1文
- 注目ポイント：1〜2件（タスクの集中・止まっている論点など）

## 全体としての次の一手
- Objective達成に向けた今後の打ち手を3〜5件。「誰が・何を」が言えるものは明記。KR横断で効くものを優先

## レポート/共有に使える要点
- Objective全体の進捗の言い方（1〜2文）
- 今月の主要トピック（2〜3件）
- 全体に向けた申し送り事項（2〜3件）

【ルール】
- 与えられた事実だけを根拠にする。推測で断定しない
- 各KRの「最新のKR分析」が与えられている場合は、それを最重要の素材として扱う（再構成・要約は不要、KRごとの所感を Objective視点で繋ぐ）
- データが少ない場合は無理に分析せず「判断材料が少ない」と書く`;

function clip(s: string, n: number): string { return s.replace(/\s+/g, " ").trim().slice(0, n); }

function buildUserMessage(input: ObjectiveAnalysisInput): string {
  const L: string[] = [];
  const sigJa: Record<string, string> = { green: "🟢順調", yellow: "🟡注意", red: "🔴要対応" };
  const typeJa: Record<string, string> = { checkin: "チェックイン", win_session: "ウィン", freeform: "OKR議論" };

  L.push(`【今日】${input.today}`);
  L.push(`【Objective】${input.objective.title}${input.objective.period ? `（${input.objective.period}）` : ""}`);
  if (input.objective.purpose) L.push(`【Objectiveの目的】${clip(input.objective.purpose, 400)}`);
  L.push("");
  L.push(`このObjective配下のKRは ${input.krs.length} 件です。`);
  L.push("");

  for (const kr of input.krs) {
    L.push(`========== KR: ${kr.title} ==========`);
    if (kr.tfs.length > 0) L.push(`配下TF：${kr.tfs.map(t => `TF${t.number} ${t.name}`).join(" / ")}`);
    const t = kr.taskSummary;
    L.push(`タスク状況：合計${t.total}（完了${t.done} / 進行中${t.in_progress} / 未着手${t.todo} / 期限超過${t.overdue}）`);

    if (kr.latestKrAnalysis) {
      L.push("");
      L.push(`【このKRの最新KR分析（${kr.latestKrAnalysis.created_at.slice(0, 10)}）】`);
      L.push(kr.latestKrAnalysis.content); // 既にマークダウンの分析結果。そのまま渡す
    } else {
      L.push("【このKRの最新KR分析】なし（③ KR分析が未実行）");
    }

    L.push("");
    L.push(`【このKRの直近セッション（${kr.sessions.length}件）】`);
    if (kr.sessions.length === 0) L.push("（なし）");
    for (const s of kr.sessions) {
      L.push(`- ${s.week_start} / ${typeJa[s.type] ?? s.type} / ${s.signal ? sigJa[s.signal] : "—"}${s.signal_comment ? ` ｜ ${clip(s.signal_comment, 160)}` : ""}${s.learnings ? ` ｜ 学び：${clip(s.learnings, 180)}` : ""}`);
      // freeform は議論サマリ・決定事項・言及KRを追加で渡す（会議の本質情報）
      if (s.type === "freeform") {
        if (s.summary)     L.push(`    議論サマリ：${clip(s.summary, 220)}`);
        if (s.decisions)   L.push(`    決定事項：${clip(s.decisions.replace(/\n+/g, " / "), 220)}`);
        if (s.kr_mentions) L.push(`    言及KR：${clip(s.kr_mentions.replace(/\n+/g, " / "), 180)}`);
      }
    }
    L.push("");
  }

  L.push("以上のObjectiveについて、指定の形式で分析してください。");
  return L.join("\n");
}

/** Objectiveの状況をAIに分析させ、マークダウンのレポート文字列を返す。 */
export async function analyzeObjective(input: ObjectiveAnalysisInput): Promise<string> {
  const messages: AIMessageInput[] = [{ role: "user", content: buildUserMessage(input) }];
  const res = await invokeAI(SYSTEM_PROMPT, messages, 3500, "okr-analysis");
  return res.content[0].text;
}
