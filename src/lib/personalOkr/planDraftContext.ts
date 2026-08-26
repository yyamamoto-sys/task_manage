// src/lib/personalOkr/planDraftContext.ts
//
// 【設計意図】
// 個人OKR「前月をふまえて下書き」（翌月の計画ドラフト・v3.99）のAI文脈を組み立てる
// 純粋関数群。personalOkrAiContext.ts（当月の実行支援＝AI解析・AIパネル用）は目的が
// 違う（当月1か月分だけを見る）ため、そちらを改造せずここに新設する。
// 🔴 ただし週の行の組み立て（buildFilledWeekLines）・タスクの機械集計
// （summarizeLinkedTaskStatus・computeReviewMaterial）は既存関数をそのまま再利用し、
// 同じ計算を書き直さない（CLAUDE.md「コピペ実装は1つだけ改良される」の教訓）。
//
// 🔴 546の教訓（CLAUDE.md Section 19・28）を踏まえ、渡す量を絞る：
// - review_text・gm_commentは各1200字でクリップする（既存のclip()相当の作法）。
// - メモ・タスクの絞り方は呼び出し側（PersonalKrPanel.tsx）が既存の慣例
//   （直近3件・各300字／機械集計の件数のみ）に従って渡す。
// - 組み立て後の総文字数が上限（PLAN_DRAFT_CONTEXT_CHAR_LIMIT）を超えたら、古い月から
//   順に「週の記録→メモ→計画4欄」の順で削る（buildPlanDraftContext）。決定的な順序で
//   動くことをテストで固定する。

import type { PersonalKrBand, PersonalKrMonth } from "../localData/types";
import type { PersonalOkrAiContextWeek } from "./personalOkrAiContext";
import { buildFilledWeekLines } from "./personalOkrAiContext";

// ===== 型定義 =====

export interface PlanDraftMonthTaskSummary {
  completedTaskCount: number;
  incompleteTaskCount: number;
  taskStats: { delayedCount: number; stagnantCount: number; blockedCount: number };
}

export interface PlanDraftPastMonth {
  /** 例："7月（1か月目）" */
  monthLabel: string;
  positioning: string | null;
  activities: string | null;
  targetAndEvidence: string | null;
  risks: string | null;
  bandTarget: PersonalKrBand | null;
  bandOverride: PersonalKrBand | null;
  /** 🔴 1200字でクリップ済みの値を渡すこと（buildPlanDraftPastMonthEntryが行う） */
  reviewText: string | null;
  selfEvalPct: number | null;
  gmEvalPct: number | null;
  /** 🔴 1200字でクリップ済みの値を渡すこと（buildPlanDraftPastMonthEntryが行う） */
  gmComment: string | null;
  weeks: PersonalOkrAiContextWeek[];
  taskSummary: PlanDraftMonthTaskSummary;
}

export interface PlanDraftCurrentMonthPlan {
  positioning: string | null;
  activities: string | null;
  targetAndEvidence: string | null;
  risks: string | null;
}

/** 計画欄の4フィールド（PersonalOkrPlanDraftModal.tsxの反映対象・確認対象と共通の形） */
export interface PlanDraftFields {
  positioning: string;
  activities: string;
  targetAndEvidence: string;
  risks: string;
}

// 🔴 PersonalOkrPlanDraftModal.tsxの各textareaの見出しと同じ文言にする（確認ダイアログの
// 列挙と、実際に書き換わる欄の見出しが食い違わないようにするため）。
const PLAN_FIELD_LABELS: { key: keyof PlanDraftFields; label: string }[] = [
  { key: "positioning", label: "位置づけ" },
  { key: "activities", label: "取り組む内容" },
  { key: "targetAndEvidence", label: "当月末の達成目標と、その証拠" },
  { key: "risks", label: "リスクと依存関係" },
];

/**
 * 「計画欄に反映」時、既に記入がある欄のラベル一覧を返す（確認ダイアログの文面用）。
 * 🔴 反映は「全欄反映の一択」（空欄だけに入れる／全欄に入れる、の選択は作らない）だが、
 * どの欄が実際に書き換わるか（＝現在すでに何か書かれている欄）は具体的に列挙する（§2-2）。
 * 空配列＝確認不要（既存の記入が無い）。
 */
export function resolveOverwrittenPlanFieldLabels(existing: PlanDraftFields): string[] {
  return PLAN_FIELD_LABELS.filter(f => existing[f.key].trim().length > 0).map(f => f.label);
}

export interface PlanDraftContextInput {
  krLabel: string;
  krKindLabel: string;
  fiscalYear: number;
  /** 例："3Q" */
  quarter: string;
  category: string | null;
  activity: string | null;
  strengthRole: string | null;
  weaknessRole: string | null;
  criteria: string | null;
  supplement: string | null;
  /** 例："8月（2か月目／全3か月）" */
  targetMonthLabel: string;
  /** これから計画する月のmonth_index（1〜3）。残り月数の計算に使う */
  targetMonthIndex: 1 | 2 | 3;
  /** 当四半期の過去月すべて。古い月から順（呼び出し側が並べて渡す） */
  pastMonths: PlanDraftPastMonth[];
  /** 当月（targetMonthIndex）に既に書かれている計画。記入が1つも無ければnullを渡す */
  currentMonthPlan: PlanDraftCurrentMonthPlan | null;
  /** 呼び出し側が既に件数・文字数を絞った直近のメモ本文（新しい順） */
  recentMemos: string[];
}

// ===== クリップ（既存のclip()相当の作法。このファイル専用のローカル定数） =====

const REVIEW_TEXT_CLIP_CHARS = 1200;
const GM_COMMENT_CLIP_CHARS = 1200;

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) : s;
}

/**
 * PersonalKrMonth（DBから読んだ過去月の1レコード）から PlanDraftPastMonth を組み立てる。
 * review_text・gm_commentはここで1200字にクリップする。
 */
export function buildPlanDraftPastMonthEntry(params: {
  monthLabel: string;
  monthRecord: PersonalKrMonth | null;
  weeks: PersonalOkrAiContextWeek[];
  taskSummary: PlanDraftMonthTaskSummary;
}): PlanDraftPastMonth {
  const r = params.monthRecord;
  return {
    monthLabel: params.monthLabel,
    positioning: r?.positioning ?? null,
    activities: r?.activities ?? null,
    targetAndEvidence: r?.target_and_evidence ?? null,
    risks: r?.risks ?? null,
    bandTarget: r?.band_target ?? null,
    bandOverride: r?.band_override ?? null,
    reviewText: r?.review_text ? clip(r.review_text, REVIEW_TEXT_CLIP_CHARS) : null,
    selfEvalPct: r?.self_eval_pct ?? null,
    gmEvalPct: r?.gm_eval_pct ?? null,
    gmComment: r?.gm_comment ? clip(r.gm_comment, GM_COMMENT_CLIP_CHARS) : null,
    weeks: params.weeks,
    taskSummary: params.taskSummary,
  };
}

// ===== 材料が無いかの判定（生成ボタンの非活性条件） =====

/**
 * 「材料が無い」ときだけ生成を非活性にする（§2-4）。
 * KR定義の6欄が全て空 かつ 過去月のいずれにも計画4欄・振り返り本文・自己評価％・
 * 上長コメントの記入が無い場合にtrue。🔴 1か月目（pastMonths=[]）でもKR定義があれば
 * 生成できるようにするため、pastMonths単独では判定しない（krFieldsEmptyとのAND）。
 */
export function isPlanDraftMaterialEmpty(krFieldsEmpty: boolean, pastMonths: PlanDraftPastMonth[]): boolean {
  const pastMonthHasMaterial = pastMonths.some(m =>
    m.positioning != null || m.activities != null || m.targetAndEvidence != null || m.risks != null ||
    m.reviewText != null || m.selfEvalPct != null || m.gmComment != null,
  );
  return krFieldsEmpty && !pastMonthHasMaterial;
}

// ===== モーダル①：材料の要約（機械計算・即時描画） =====

/**
 * モーダルを開いた瞬間にAIを待たず出す、過去月ごとの1行サマリー。
 * 記入が無い項目はその項目ごと出さない（週次任意化と同じ思想。CLAUDE.md Section 24 Step O）。
 */
export function buildPlanDraftMaterialSummaryLines(pastMonths: PlanDraftPastMonth[]): string[] {
  return pastMonths.map(m => {
    const parts: string[] = [];
    if (m.selfEvalPct != null) parts.push(`自己評価${m.selfEvalPct}%`);
    if (m.gmEvalPct != null) parts.push(`GM評価${m.gmEvalPct}%`);
    if (m.reviewText) parts.push("振り返り記入あり");
    const segments: string[] = [];
    if (parts.length > 0) segments.push(parts.join("・"));
    const taskTotal = m.taskSummary.completedTaskCount + m.taskSummary.incompleteTaskCount;
    if (taskTotal > 0) {
      segments.push(`タスク完了${m.taskSummary.completedTaskCount}件・未完了${m.taskSummary.incompleteTaskCount}件`);
    }
    return segments.length > 0 ? `${m.monthLabel}：${segments.join("／")}` : m.monthLabel;
  });
}

// ===== 本文の組み立て =====

function formatField(label: string, value: string | null): string | null {
  return value ? `- ${label}：${value}` : null;
}

function formatBandLine(bandTarget: PersonalKrBand | null, bandOverride: PersonalKrBand | null): string | null {
  if (bandTarget == null && bandOverride == null) return null;
  let line = "  ＜狙いのバンド＞";
  if (bandTarget != null) line += `${bandTarget}%`;
  if (bandOverride != null) line += `（決定：${bandOverride}%）`;
  return line;
}

function formatPastMonth(m: PlanDraftPastMonth): string[] {
  const lines: string[] = [`▼ ${m.monthLabel}`];

  const planFields = [
    formatField("位置づけ", m.positioning),
    formatField("取り組む内容", m.activities),
    formatField("当月末の達成目標と証拠", m.targetAndEvidence),
    formatField("リスクと依存関係", m.risks),
  ].filter((l): l is string => l != null);
  if (planFields.length > 0) {
    lines.push("  ＜計画＞");
    for (const l of planFields) lines.push(`  ${l}`);
  }

  const bandLine = formatBandLine(m.bandTarget, m.bandOverride);
  if (bandLine) lines.push(bandLine);

  if (m.reviewText) lines.push(`  ＜振り返り＞${m.reviewText}`);
  if (m.selfEvalPct != null) lines.push(`  ＜自己評価＞${m.selfEvalPct}%`);
  if (m.gmEvalPct != null) lines.push(`  ＜上長評価＞${m.gmEvalPct}%`);
  if (m.gmComment) lines.push(`  ＜上長コメント＞${m.gmComment}`);

  const weekLines = buildFilledWeekLines(m.weeks);
  if (weekLines.length > 0) {
    lines.push("  ＜週の記録＞");
    for (const l of weekLines) lines.push(`  ${l}`);
  }

  const { completedTaskCount, incompleteTaskCount, taskStats } = m.taskSummary;
  let taskLine = `  ＜タスク＞完了${completedTaskCount}件・未完了${incompleteTaskCount}件`;
  const detailParts: string[] = [];
  if (taskStats.delayedCount > 0) detailParts.push(`遅延${taskStats.delayedCount}件`);
  if (taskStats.stagnantCount > 0) detailParts.push(`停滞${taskStats.stagnantCount}件`);
  if (taskStats.blockedCount > 0) detailParts.push(`先行待ち${taskStats.blockedCount}件`);
  if (detailParts.length > 0) taskLine += `（うち${detailParts.join("・")}）`;
  lines.push(taskLine);

  return lines;
}

/** AIへ渡すユーザーメッセージ本文（テキストブロック）を組み立てる（トリミング無し） */
export function buildPlanDraftContextText(input: PlanDraftContextInput): string {
  const lines: string[] = [];

  lines.push(`【対象KR（四半期を通じた目標）】${input.krLabel}（${input.krKindLabel}・FY${input.fiscalYear} ${input.quarter}）`);
  const facts6: [string, string | null][] = [
    ["対象業務カテゴリ", input.category],
    ["実施内容", input.activity],
    ["得意領域の強化", input.strengthRole],
    ["苦手領域の克服", input.weaknessRole],
    ["達成基準", input.criteria],
    ["補足", input.supplement],
  ];
  for (const [label, v] of facts6) {
    const line = formatField(label, v);
    if (line) lines.push(line);
  }

  const remainingMonths = 4 - input.targetMonthIndex;
  lines.push("");
  lines.push("【四半期の進み方】");
  lines.push(`- これから計画する月：${input.targetMonthLabel}。残り${remainingMonths}か月（当月を含む）`);

  if (input.pastMonths.length > 0) {
    lines.push("");
    lines.push("【過去月の実績】");
    for (const m of input.pastMonths) lines.push(...formatPastMonth(m));
  }

  if (input.currentMonthPlan) {
    const fields = [
      formatField("位置づけ", input.currentMonthPlan.positioning),
      formatField("取り組む内容", input.currentMonthPlan.activities),
      formatField("当月末の達成目標と証拠", input.currentMonthPlan.targetAndEvidence),
      formatField("リスクと依存関係", input.currentMonthPlan.risks),
    ].filter((l): l is string => l != null);
    if (fields.length > 0) {
      lines.push("");
      lines.push("【当月に既に書かれている計画】");
      lines.push(...fields);
    }
  }

  if (input.recentMemos.length > 0) {
    lines.push("");
    lines.push("【直近のメモ】");
    for (const m of input.recentMemos) lines.push(`- ${m}`);
  }

  return lines.join("\n");
}

// ===== 総文字数の上限・決定的な削り =====

/** 目安8000字（CLAUDE.md Section 19・28の546対策）。厳密な保証ではなく決定的な削減の目標値 */
export const PLAN_DRAFT_CONTEXT_CHAR_LIMIT = 8000;

function cloneInput(input: PlanDraftContextInput): PlanDraftContextInput {
  return {
    ...input,
    pastMonths: input.pastMonths.map(m => ({ ...m, weeks: [...m.weeks] })),
    recentMemos: [...input.recentMemos],
  };
}

export interface PlanDraftContextResult {
  text: string;
  /** 上限超過により何か（週の記録・メモ・計画4欄のいずれか）を削ったか */
  trimmed: boolean;
}

/**
 * 総文字数が上限を超えたら、古い月から順に「週の記録→メモ→計画4欄」の順で決定的に削る。
 * pastMonthsは呼び出し側が古い順に渡す前提（このファイルでは並べ替えない）。
 */
export function buildPlanDraftContext(input: PlanDraftContextInput): PlanDraftContextResult {
  let text = buildPlanDraftContextText(input);
  if (text.length <= PLAN_DRAFT_CONTEXT_CHAR_LIMIT) return { text, trimmed: false };

  const working = cloneInput(input);
  let trimmed = false;

  // ① 古い月から順に週の記録を削る
  for (const m of working.pastMonths) {
    if (text.length <= PLAN_DRAFT_CONTEXT_CHAR_LIMIT) break;
    if (m.weeks.length === 0) continue;
    m.weeks = [];
    trimmed = true;
    text = buildPlanDraftContextText(working);
  }

  // ② メモを削る
  if (text.length > PLAN_DRAFT_CONTEXT_CHAR_LIMIT && working.recentMemos.length > 0) {
    working.recentMemos = [];
    trimmed = true;
    text = buildPlanDraftContextText(working);
  }

  // ③ 古い月から順に計画4欄を削る
  for (const m of working.pastMonths) {
    if (text.length <= PLAN_DRAFT_CONTEXT_CHAR_LIMIT) break;
    if (m.positioning == null && m.activities == null && m.targetAndEvidence == null && m.risks == null) continue;
    m.positioning = null;
    m.activities = null;
    m.targetAndEvidence = null;
    m.risks = null;
    trimmed = true;
    text = buildPlanDraftContextText(working);
  }

  return { text, trimmed };
}
