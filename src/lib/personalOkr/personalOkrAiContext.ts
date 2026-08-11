// src/lib/personalOkr/personalOkrAiContext.ts
//
// 【設計意図】
// AIに渡す「個人OKRの文脈」を1箇所に集約する純粋関数群（Phase 3後半・
// docs/dev/okr-redesign-plan.md §5-1・作業1〜3共通）。
//
// 🔴 546の教訓（CLAUDE.md Section 19・28）を踏まえ、渡すのは以下だけに絞る：
//   このKRの内容（6本文欄）・今月の計画（4欄＋狙いのバンド）・週の目標状態と自己評価
//   （◯△✕）・紐づくタスクの「機械計算済みの要約」（件数のみ・生データは渡さない）・
//   メモの直近数件（呼び出し側が既に件数・文字数を絞ったものを渡す）。
// この入力は「作業1（AI解析・personal_kr_outlooks書き込み）」と「作業3（AIパネルの
// チャット）」の両方で同じ材料として使う（計画書の指示：入力を絞る基準を1箇所にする）。
//
// タスクの生データ（Task[]全体）や過去月のKintone振り返り・部署ナレッジ（Phase 5未実装）は
// 渡さない。会話履歴（チャットのやり取り）はこの文脈とは別にhooks側で組み立てる。

import type { PersonalKrBand, WeekSelfRating } from "../localData/types";
import type { LinkedTaskStatusSummary } from "./aheadTaskStats";

export interface PersonalOkrAiContextWeek {
  label: string;               // "W1"〜"W6"
  goalState: string | null;
  selfRating: WeekSelfRating;
}

export interface PersonalOkrAiTaskSummary extends LinkedTaskStatusSummary {
  /** 紐づくタスクの総数（ユニーク・週をまたいだ重複は除く） */
  linkedTaskCount: number;
}

export interface PersonalOkrAiContextInput {
  krLabel: string;
  krKindLabel: string;
  category: string | null;
  activity: string | null;
  strengthRole: string | null;
  weaknessRole: string | null;
  criteria: string | null;
  supplement: string | null;
  /** 例："8月（2か月目）" */
  monthLabel: string;
  positioning: string | null;
  activities: string | null;
  targetAndEvidence: string | null;
  risks: string | null;
  bandTarget: PersonalKrBand | null;
  weeks: PersonalOkrAiContextWeek[];
  taskSummary: PersonalOkrAiTaskSummary;
  /** 呼び出し側が既に件数・文字数を絞った直近のメモ本文（新しい順） */
  recentMemos: string[];
}

const SELF_RATING_LABEL: Record<Exclude<WeekSelfRating, null>, string> = {
  o: "◯達成", t: "△一部", x: "✕未達",
};

/** AIへ渡すユーザーメッセージ本文（テキストブロック）を組み立てる */
export function buildPersonalOkrAiContextText(input: PersonalOkrAiContextInput): string {
  const lines: string[] = [];

  lines.push(`【対象KR】${input.krLabel}（${input.krKindLabel}）`);

  const facts6: [string, string | null][] = [
    ["対象業務カテゴリ", input.category],
    ["実施内容", input.activity],
    ["得意領域の強化", input.strengthRole],
    ["苦手領域の克服", input.weaknessRole],
    ["達成基準", input.criteria],
    ["補足", input.supplement],
  ];
  const facts6Filled = facts6.filter(([, v]) => !!v);
  if (facts6Filled.length > 0) {
    lines.push("【このKRの内容】");
    for (const [label, v] of facts6Filled) lines.push(`- ${label}：${v}`);
  }

  lines.push(`【${input.monthLabel}の計画】`);
  if (input.positioning) lines.push(`- 位置づけ：${input.positioning}`);
  if (input.activities) lines.push(`- 当月に取り組む内容：${input.activities}`);
  if (input.targetAndEvidence) lines.push(`- 当月末の達成目標と証拠：${input.targetAndEvidence}`);
  if (input.risks) lines.push(`- リスクと依存関係：${input.risks}`);
  lines.push(`- 当月末 狙いのバンド：${input.bandTarget != null ? `${input.bandTarget}%` : "未設定"}`);

  lines.push("【週の目標状態と自己評価】");
  if (input.weeks.length === 0) {
    lines.push("- （週データなし）");
  } else {
    for (const w of input.weeks) {
      const ratingLabel = w.selfRating ? SELF_RATING_LABEL[w.selfRating] : "未評価";
      lines.push(`- ${w.label}：${w.goalState ?? "（目標状態未設定）"}｜${ratingLabel}`);
    }
  }

  lines.push("【紐づくタスクの状況（機械計算済みの要約。タスクの生データは渡していない）】");
  lines.push(
    `- 紐づくタスク${input.taskSummary.linkedTaskCount}件・遅延${input.taskSummary.delayedCount}件・` +
    `停滞${input.taskSummary.stagnantCount}件・先行待ち${input.taskSummary.blockedCount}件`,
  );

  if (input.recentMemos.length > 0) {
    lines.push("【直近のメモ】");
    for (const m of input.recentMemos) lines.push(`- ${m}`);
  }

  return lines.join("\n");
}

/** AIパネルの「このパネルが見ているもの」チップ表示用（モックのai-ctx相当） */
export function buildPersonalOkrAiContextChips(input: PersonalOkrAiContextInput): string[] {
  const chips: string[] = [`${input.krLabel} の内容`, `${input.monthLabel}の計画`];
  if (input.weeks.length > 0) {
    chips.push(`W1〜W${input.weeks.length}の目標状態`, "自己評価 ◯△✕");
  }
  chips.push(`タスク${input.taskSummary.linkedTaskCount}件の実績`);
  if (input.recentMemos.length > 0) chips.push(`メモ${input.recentMemos.length}件`);
  return chips;
}

/** AIパネルのスターター（質問候補）。渡している材料だけで答えられる質問に絞る */
export function buildPersonalOkrAiStarters(input: PersonalOkrAiContextInput): string[] {
  const bandText = input.bandTarget != null ? `バンド${input.bandTarget}` : "当月の狙い";
  return [
    `${bandText}に乗せるために、今週何を優先すべき？`,
    "△や✕になった週の原因はどこにありそう？",
    "残り週の計画をどう組み替えるべき？",
    "捨てる・後回しにできる候補はある？",
  ];
}
