// src/lib/personalOkr/periodReviewDraftContext.ts
//
// 【設計意図】
// 「全体」タブ（月全体・四半期全体の振り返り。v3.101・CLAUDE.md Section 24 Step Q）の
// AI下書き（全体の振り返り本文）の文脈を組み立てる純粋関数。
// planDraftContext.ts（翌月の計画ドラフト・v3.99）と同じ考え方（クリップ・決定的な削減・
// 記入が無い項目は行ごと出さない）に倣うが、対象がKR単位ではなく「対象期間の全KR横断」
// である点が異なるため独立のファイルとして新設する（personalOkrAiContext.tsは
// 単一KR・当月限定の既存の入力を変えない）。
//
// 🔴 546の教訓（CLAUDE.md Section 19・28）：
// - review_text／gm_commentは各800字でクリップする（仕様書§W4）。
// - 組み立て後の総文字数の上限（目安10000字）を超えたら決定的な順序で削る：
//   ①全エントリの計画4欄の要点 → ②全エントリのタスク内訳（遅延/停滞/先行待ち。件数の
//   合計は残す） → ③全エントリのGMコメント → ④全エントリの振り返り本文、の順に
//   フィールド単位で一括して削る（planDraftContext.tsの「古い月から1件ずつ削る」方式とは
//   異なり、こちらは複数KR×複数月の組み合わせになるため「フィールド種別ごとに一括で削る」
//   方が総量を素早く落とせる。削り順自体は固定・テストで固定する）。

export interface PeriodReviewTaskSummary {
  completedTaskCount: number;
  incompleteTaskCount: number;
  taskStats: { delayedCount: number; stagnantCount: number; blockedCount: number };
}

export interface PeriodReviewKrMonthEntry {
  /** 例："8月" */
  monthLabel: string;
  positioning: string | null;
  activities: string | null;
  targetAndEvidence: string | null;
  risks: string | null;
  /** 🔴 800字でクリップ済みの値を渡すこと（buildPeriodReviewKrMonthEntryが行う） */
  reviewText: string | null;
  selfEvalPct: number | null;
  gmEvalPct: number | null;
  /** 🔴 800字でクリップ済みの値を渡すこと（buildPeriodReviewKrMonthEntryが行う） */
  gmComment: string | null;
  taskSummary: PeriodReviewTaskSummary;
}

export interface PeriodReviewKrEntry {
  krLabel: string;
  weightPct: number;
  /** 月ブロックなら1件、四半期ブロックなら最大3件（古い月から順） */
  months: PeriodReviewKrMonthEntry[];
}

export interface PeriodReviewDraftContextInput {
  /** 例："8月" または "2026年度 3Q" */
  periodLabel: string;
  periodKind: "month" | "quarter";
  krEntries: PeriodReviewKrEntry[];
}

// ===== クリップ（仕様書§W4：各800字） =====

const CLIP_CHARS = 800;

function clip(s: string, n: number = CLIP_CHARS): string {
  return s.length > n ? s.slice(0, n) : s;
}

/**
 * personal_kr_months（1件）から PeriodReviewKrMonthEntry を組み立てる。
 * review_text・gm_commentはここで800字にクリップする。
 */
export function buildPeriodReviewKrMonthEntry(params: {
  monthLabel: string;
  positioning: string | null | undefined;
  activities: string | null | undefined;
  targetAndEvidence: string | null | undefined;
  risks: string | null | undefined;
  reviewText: string | null | undefined;
  selfEvalPct: number | null | undefined;
  gmEvalPct: number | null | undefined;
  gmComment: string | null | undefined;
  taskSummary: PeriodReviewTaskSummary;
}): PeriodReviewKrMonthEntry {
  return {
    monthLabel: params.monthLabel,
    positioning: params.positioning ?? null,
    activities: params.activities ?? null,
    targetAndEvidence: params.targetAndEvidence ?? null,
    risks: params.risks ?? null,
    reviewText: params.reviewText ? clip(params.reviewText) : null,
    selfEvalPct: params.selfEvalPct ?? null,
    gmEvalPct: params.gmEvalPct ?? null,
    gmComment: params.gmComment ? clip(params.gmComment) : null,
    taskSummary: params.taskSummary,
  };
}

// ===== 生成ボタンの非活性条件 =====

/** 全KR・全対象月を通して1つも材料が無ければtrue（生成ボタンを非活性にする判定に使う）。 */
export function isPeriodReviewDraftMaterialEmpty(krEntries: PeriodReviewKrEntry[]): boolean {
  return krEntries.every(kr => kr.months.every(m =>
    m.positioning == null && m.activities == null && m.targetAndEvidence == null && m.risks == null &&
    m.reviewText == null && m.selfEvalPct == null && m.gmEvalPct == null && m.gmComment == null &&
    m.taskSummary.completedTaskCount === 0 && m.taskSummary.incompleteTaskCount === 0,
  ));
}

// ===== モーダル①：材料の要約（機械計算・即時描画） =====

/**
 * モーダルを開いた瞬間にAIを待たず出す、KRごとの1行サマリー。
 * 記入が無い項目はその項目ごと出さない（週次任意化と同じ思想。CLAUDE.md Section 24 Step O）。
 */
export function buildPeriodReviewMaterialSummaryLines(krEntries: PeriodReviewKrEntry[]): string[] {
  return krEntries.map(kr => {
    const monthSegments: string[] = [];
    for (const m of kr.months) {
      const parts: string[] = [];
      if (m.selfEvalPct != null) parts.push(`自己評価${m.selfEvalPct}%`);
      if (m.gmEvalPct != null) parts.push(`GM評価${m.gmEvalPct}%`);
      if (m.reviewText) parts.push("振り返り記入あり");
      const taskTotal = m.taskSummary.completedTaskCount + m.taskSummary.incompleteTaskCount;
      if (taskTotal > 0) parts.push(`タスク完了${m.taskSummary.completedTaskCount}件・未完了${m.taskSummary.incompleteTaskCount}件`);
      if (parts.length > 0) monthSegments.push(`${m.monthLabel}：${parts.join("・")}`);
    }
    const head = `${kr.krLabel}（ウェイト${kr.weightPct}%）`;
    return monthSegments.length > 0 ? `${head}：${monthSegments.join("／")}` : `${head}：記録なし`;
  });
}

// ===== 本文の組み立て =====

function formatField(label: string, value: string | null): string | null {
  return value ? `- ${label}：${value}` : null;
}

function formatMonthEntry(m: PeriodReviewKrMonthEntry): string[] {
  const lines: string[] = [`  ▼ ${m.monthLabel}`];

  const planFields = [
    formatField("位置づけ", m.positioning),
    formatField("取り組む内容", m.activities),
    formatField("当月末の達成目標と証拠", m.targetAndEvidence),
    formatField("リスクと依存関係", m.risks),
  ].filter((l): l is string => l != null);
  if (planFields.length > 0) {
    lines.push("    ＜計画の要点＞");
    for (const l of planFields) lines.push(`    ${l}`);
  }

  if (m.reviewText) lines.push(`    ＜振り返り＞${m.reviewText}`);
  if (m.selfEvalPct != null) lines.push(`    ＜自己評価＞${m.selfEvalPct}%`);
  if (m.gmEvalPct != null) lines.push(`    ＜GM評価＞${m.gmEvalPct}%`);
  if (m.gmComment) lines.push(`    ＜GMコメント＞${m.gmComment}`);

  const { completedTaskCount, incompleteTaskCount, taskStats } = m.taskSummary;
  if (completedTaskCount > 0 || incompleteTaskCount > 0) {
    let taskLine = `    ＜タスク＞完了${completedTaskCount}件・未完了${incompleteTaskCount}件`;
    const detailParts: string[] = [];
    if (taskStats.delayedCount > 0) detailParts.push(`遅延${taskStats.delayedCount}件`);
    if (taskStats.stagnantCount > 0) detailParts.push(`停滞${taskStats.stagnantCount}件`);
    if (taskStats.blockedCount > 0) detailParts.push(`先行待ち${taskStats.blockedCount}件`);
    if (detailParts.length > 0) taskLine += `（うち${detailParts.join("・")}）`;
    lines.push(taskLine);
  }

  return lines;
}

function formatKrEntry(kr: PeriodReviewKrEntry): string[] {
  const lines: string[] = [`▼ ${kr.krLabel}（ウェイト${kr.weightPct}%）`];
  for (const m of kr.months) lines.push(...formatMonthEntry(m));
  return lines;
}

/** AIへ渡すユーザーメッセージ本文（トリミング無し） */
export function buildPeriodReviewDraftContextText(input: PeriodReviewDraftContextInput): string {
  const lines: string[] = [];
  const periodNoun = input.periodKind === "month" ? "月全体" : "四半期全体";
  lines.push(`【対象期間】${input.periodLabel}の${periodNoun}の振り返り`);
  lines.push("");
  lines.push("【対象KR一覧（KRごとの記録）】");
  for (const kr of input.krEntries) lines.push(...formatKrEntry(kr));
  return lines.join("\n");
}

// ===== 総文字数の上限・決定的な削り（フィールド単位で一括削除） =====

/** 目安10000字（仕様書§W4・CLAUDE.md Section 19・28の546対策） */
export const PERIOD_REVIEW_DRAFT_CONTEXT_CHAR_LIMIT = 10000;

function cloneInput(input: PeriodReviewDraftContextInput): PeriodReviewDraftContextInput {
  return {
    ...input,
    krEntries: input.krEntries.map(kr => ({ ...kr, months: kr.months.map(m => ({ ...m, taskSummary: { ...m.taskSummary, taskStats: { ...m.taskSummary.taskStats } } })) })),
  };
}

export interface PeriodReviewDraftContextResult {
  text: string;
  /** 上限超過により何か（計画4欄・タスク内訳・GMコメント・振り返り本文のいずれか）を削ったか */
  trimmed: boolean;
}

/**
 * 総文字数が上限を超えたら、①全エントリの計画4欄の要点 → ②全エントリのタスク内訳
 * （遅延/停滞/先行待ちの内訳のみ。完了/未完了の件数自体は最後まで残す） →
 * ③全エントリのGMコメント → ④全エントリの振り返り本文、の順にフィールド種別ごと一括で
 * 削る。全て削っても超過する場合はそれ以上削らずそのまま返す（極端な件数のときの安全弁）。
 */
export function buildPeriodReviewDraftContext(input: PeriodReviewDraftContextInput): PeriodReviewDraftContextResult {
  let text = buildPeriodReviewDraftContextText(input);
  if (text.length <= PERIOD_REVIEW_DRAFT_CONTEXT_CHAR_LIMIT) return { text, trimmed: false };

  const working = cloneInput(input);
  let trimmed = false;
  const allMonths = () => working.krEntries.flatMap(kr => kr.months);

  // ① 計画4欄の要点を削る
  if (text.length > PERIOD_REVIEW_DRAFT_CONTEXT_CHAR_LIMIT) {
    for (const m of allMonths()) { m.positioning = null; m.activities = null; m.targetAndEvidence = null; m.risks = null; }
    trimmed = true;
    text = buildPeriodReviewDraftContextText(working);
  }

  // ② タスクの内訳（遅延/停滞/先行待ち）を削る。完了/未完了の件数は残す
  if (text.length > PERIOD_REVIEW_DRAFT_CONTEXT_CHAR_LIMIT) {
    for (const m of allMonths()) { m.taskSummary.taskStats = { delayedCount: 0, stagnantCount: 0, blockedCount: 0 }; }
    trimmed = true;
    text = buildPeriodReviewDraftContextText(working);
  }

  // ③ GMコメントを削る
  if (text.length > PERIOD_REVIEW_DRAFT_CONTEXT_CHAR_LIMIT) {
    for (const m of allMonths()) { m.gmComment = null; }
    trimmed = true;
    text = buildPeriodReviewDraftContextText(working);
  }

  // ④ 振り返り本文を削る
  if (text.length > PERIOD_REVIEW_DRAFT_CONTEXT_CHAR_LIMIT) {
    for (const m of allMonths()) { m.reviewText = null; }
    trimmed = true;
    text = buildPeriodReviewDraftContextText(working);
  }

  return { text, trimmed };
}
