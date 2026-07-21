// src/lib/ai/allProjectsAnalysisClient.ts
//
// 【設計意図】
// 全PJを横断して「ポートフォリオ視点」の AI 分析を行うクライアント。
// 単一PJの projectAnalysisClient.ts とは異なり、複数プロジェクト間の
// 優先度・リソース配分・横断リスクを分析する。
//
// 渡すデータ: 全アクティブPJの概要＋タスク統計（担当者名・ステータス別件数）。
// intent: "all-projects-analysis"

import { invokeAI, type AIMessageInput } from "./invokeAI";

export interface AllProjectsPjSummary {
  name: string;
  purpose: string;
  status: string;
  start_date: string;
  end_date: string;
  owner_short_names: string[];
  task_stats: {
    total: number;
    todo: number;
    in_progress: number;
    done: number;
    /** 保留（一旦停止・将来また検討する可能性あり） */
    on_hold: number;
    /** 中止（方針転換等でもう実施しない） */
    cancelled: number;
    overdue: number;
    no_due: number;
    stagnant: number;
  };
  assignee_loads: { short_name: string; active: number }[];
  next_milestone?: { name: string; date: string };
}

export interface AllProjectsAnalysisInput {
  projects: AllProjectsPjSummary[];
  members_short_names: string[];
  today: string;
}

const SYSTEM_PROMPT = `あなたは経験豊富なポートフォリオマネジメントの分析AIです。
チームが抱える複数のプロジェクト全体を俯瞰し、
「今チームが何を優先すべきか」「どこにリスクが集まっているか」「誰に負荷が偏っているか」
をポートフォリオ視点で客観的に分析します。

【分析の観点】
- 全体の健全性：アクティブPJ全体の完了率・期限超過率・滞留件数のサマリー
- リスク集中：特定のPJや担当者にリスク・未完了が集まっていないか
- 優先順位：今週特に注意すべきPJはどれか（期限超過・ボトルネック）
- リソース：メンバーへの負荷の偏り（複数PJにまたがる視点で）
- アクション：チーム全体として来週やるべき最重要アクション

【出力形式】マークダウン。コードブロックは使わない。見出しは ## 。箇条書きは - 。
以下の5セクションで簡潔に（全体で日本語900〜1400字程度）：

## 全体サマリー
PJポートフォリオ全体を1〜3文で。「順調」「特定PJに注意」「複数PJでリスク」など。

## 今すぐ注意すべきPJ
- 期限超過・停滞・リソース枯渇など、優先的に対処すべきPJを2〜3件。理由も添えて。

## メンバー負荷の偏り
担当者ごとの複数PJをまたいだ負荷状況を2〜4文。特に複数PJにまたがる担当者の過負荷に注目。

## 横断リスク
複数PJにまたがるリスクや共通の問題パターンがあれば2〜3件。

## チーム全体の次の一手
- 来週チームとして取るべき具体的アクションを2〜4件。「誰が・何を」が言えるものは明記。

【ルール】
- 与えられた事実だけを根拠にする。推測で断定しない（「〜かもしれません」を使う）
- 担当者名は与えられた short_name をそのまま使う
- データが少ない場合は無理に分析せず「まだ判断材料が少ない」と正直に書く
- タスク件数ゼロのPJは「活動なし」と触れるにとどめ、詳細分析はしない`;

function buildUserMessage(input: AllProjectsAnalysisInput): string {
  const lines: string[] = [];
  lines.push(`【今日】${input.today}`);
  lines.push(`【チームメンバー】${input.members_short_names.join("、") || "（登録なし）"}`);
  lines.push("");
  lines.push(`【プロジェクト一覧（${input.projects.length}件）】`);
  lines.push("");

  for (const pj of input.projects) {
    const s = pj.task_stats;
    lines.push(`### ${pj.name}`);
    if (pj.purpose) lines.push(`- 目的：${pj.purpose}`);
    lines.push(`- ステータス：${pj.status}`);
    if (pj.start_date || pj.end_date) lines.push(`- 期間：${pj.start_date || "未設定"} 〜 ${pj.end_date || "未設定"}`);
    if (pj.owner_short_names.length) lines.push(`- オーナー：${pj.owner_short_names.join("、")}`);
    const pausedPart = (s.on_hold > 0 || s.cancelled > 0) ? ` / 保留:${s.on_hold} / 中止:${s.cancelled}` : "";
    lines.push(`- タスク：全${s.total}件（未着手:${s.todo} / 進行中:${s.in_progress} / 完了:${s.done}${pausedPart}）`);
    if (s.overdue > 0)  lines.push(`- 期限超過：${s.overdue}件`);
    if (s.stagnant > 0) lines.push(`- 滞留（進行中のまま長期間更新なし）：${s.stagnant}件`);
    if (s.no_due > 0)   lines.push(`- 期日未設定：${s.no_due}件`);
    if (pj.assignee_loads.length > 0) {
      const loads = pj.assignee_loads.map(l => `${l.short_name}(${l.active})`).join("、");
      lines.push(`- 未完了タスク担当：${loads}`);
    }
    if (pj.next_milestone) lines.push(`- 次のマイルストーン：${pj.next_milestone.date} ${pj.next_milestone.name}`);
    lines.push("");
  }

  lines.push("以上のプロジェクトポートフォリオについて、指定の形式で分析してください。");
  return lines.join("\n");
}

/** 全PJを横断して AI にポートフォリオ分析させ、マークダウンのレポート文字列を返す。 */
export async function analyzeAllProjects(input: AllProjectsAnalysisInput): Promise<string> {
  const messages: AIMessageInput[] = [{ role: "user", content: buildUserMessage(input) }];
  const res = await invokeAI(SYSTEM_PROMPT, messages, 2200, "all-projects-analysis");
  return res.content[0].text;
}
