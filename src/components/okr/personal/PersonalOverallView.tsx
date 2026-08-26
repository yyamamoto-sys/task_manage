// src/components/okr/personal/PersonalOverallView.tsx
//
// 【設計意図】
// 「全体」タブ（月全体・四半期全体の振り返り。v3.101・CLAUDE.md Section 24 Step Q）の本体。
// KRタブ列の先頭に追加した「全体」タブを選んだときに描画される。
// 縦に2ブロック（月全体・四半期全体）を PersonalPeriodReviewBlock（同じコンポーネントを
// period_kind違いで2回使う）で表示する。
//
// 🔴🔴 最重要（仕様書§W2）：personal_period_reviews テーブルが未適用（マイグレーション
// 未適用の窓）でも、このコンポーネントは例外を投げずに案内を表示するだけに留める。
// 呼び出し元（PersonalOkrView.tsx）・KRタブ側のstate（usePersonalOkrUiStoreのkrs/monthsByKr等）
// には一切触れないため、この機能の未適用がKRタブ側の動作に影響することはない。
//
// 🔴 「全体」タブは常に実データ（activeKrs）を見る。ツアーのサンプル差し込み
// （tourPreviewSample）はKRタブ側だけの仕組みで、この画面には適用しない（対象期に実KRが
// 0件のときは「参考値を出せません」の空状態がそのまま出るだけで、クラッシュはしない）。
//
// 🔴 タスクの機械集計（紐づくタスクの完了/未完了・遅延/停滞/先行待ち）は、既存の
// computeMonthWeekSegments/buildWeekCards/computeWeekCardsLinkedTasks/computeReviewMaterialを
// そのまま再利用する（新しい計算を書き直さない）。週の紐づけ（personal_kr_week_tasks）が
// まだ読み込まれていない週があれば、このコンポーネントがensureWeekTasksLoadedを呼んで
// 遅延読み込みする（KR単体パネルと同様、必要になった時点で読む設計）。

import { useEffect, useMemo } from "react";
import type { Member, PersonalKr, PersonalKrMonth, PersonalKrWeek, PersonalKrWeekTask, PersonalPeriodReview, Quarter, Task, TaskDependency } from "../../../lib/localData/types";
import { quarterMonthSlots, monthToDateStr, classifyMonth, isMonthEditable, isQuarterEditable } from "../../../lib/personalOkr/quarterMonths";
import { computeMonthWeekSegments } from "../../../lib/date/monthWeeks";
import { buildWeekCards, computeWeekCardsLinkedTasks } from "../../../lib/personalOkr/weekLayout";
import { computeReviewMaterial } from "../../../lib/personalOkr/reviewMaterial";
import type { KrPeriodRow } from "../../../lib/personalOkr/periodReviewReference";
import { computeMonthlyAverage } from "../../../lib/personalOkr/periodReviewReference";
import {
  buildPeriodReviewKrMonthEntry, buildPeriodReviewDraftContext, buildPeriodReviewMaterialSummaryLines,
  type PeriodReviewKrEntry,
} from "../../../lib/personalOkr/periodReviewDraftContext";
import { PersonalPeriodReviewBlock } from "./PersonalPeriodReviewBlock";

interface Props {
  currentUser: Member;
  fiscalYear: number;
  quarter: Quarter;
  monthIndex: 1 | 2 | 3;
  krs: PersonalKr[]; // 対象期（fiscalYear・quarter）に絞り込み済みの実データ（activeKrs）
  monthsByKr: Record<string, PersonalKrMonth[]>;
  weeksByKr: Record<string, PersonalKrWeek[]>;
  weekTasksByWeek: Record<string, PersonalKrWeekTask[]>;
  ensureKrDetailLoaded: (krId: string) => Promise<void>;
  ensureWeekTasksLoaded: (weekId: string) => Promise<void>;
  tasks: Task[];
  taskDependencies: TaskDependency[];
  periodReviews: PersonalPeriodReview[];
  periodReviewsLoaded: boolean;
  periodReviewsLoading: boolean;
  periodReviewsError: string | null;
  loadPeriodReviews: () => Promise<void>;
  savePeriodReview: (review: PersonalPeriodReview, expectedUpdatedAt?: string) => Promise<void>;
}

export function PersonalOverallView({
  currentUser, fiscalYear, quarter, monthIndex, krs, monthsByKr, weeksByKr, weekTasksByWeek,
  ensureKrDetailLoaded, ensureWeekTasksLoaded, tasks, taskDependencies,
  periodReviews, periodReviewsLoaded, periodReviewsLoading, periodReviewsError,
  loadPeriodReviews, savePeriodReview,
}: Props) {
  const today = useMemo(() => new Date(), []);
  const monthSlots = useMemo(() => quarterMonthSlots(fiscalYear, quarter), [fiscalYear, quarter]);
  const selectedSlot = monthSlots[monthIndex - 1];
  const selectedMonthStr = monthToDateStr(selectedSlot.monthStart);

  useEffect(() => { if (!periodReviewsLoaded && !periodReviewsLoading) loadPeriodReviews(); }, [periodReviewsLoaded, periodReviewsLoading, loadPeriodReviews]);

  // 対象期の全KRの月次計画・週データを読み込む（既にロード済みならensureKrDetailLoaded自体が
  // 即returnするため、KRタブで既に開いたことがあるKRの再読み込みは発生しない）。
  useEffect(() => {
    for (const kr of krs) void ensureKrDetailLoaded(kr.id);
  }, [krs, ensureKrDetailLoaded]);

  // 週とタスクの紐づけ（personal_kr_week_tasks）を、対象期の3か月ぶんまとめて遅延読み込みする
  // （月ブロック・四半期ブロックのどちらのタスク機械集計にも使うため、常に3か月ぶん読む）。
  const monthStrs = useMemo(() => monthSlots.map(s => monthToDateStr(s.monthStart)), [monthSlots]);
  useEffect(() => {
    for (const kr of krs) {
      for (const w of weeksByKr[kr.id] ?? []) {
        if (monthStrs.includes(w.month) && weekTasksByWeek[w.id] === undefined) void ensureWeekTasksLoaded(w.id);
      }
    }
  }, [krs, weeksByKr, weekTasksByWeek, monthStrs, ensureWeekTasksLoaded]);

  const loadingKrData = krs.length > 0 && krs.some(kr => monthsByKr[kr.id] === undefined);

  /** 対象KR・対象月の PersonalKrMonth（無ければnull） */
  const findMonthRecord = (krId: string, monthStr: string): PersonalKrMonth | null =>
    (monthsByKr[krId] ?? []).find(m => m.month === monthStr) ?? null;

  /** 対象KR・対象月のタスク機械集計（既存の週セグメント・週紐づけ計算をそのまま再利用） */
  const computeTaskSummary = (krId: string, monthStart: Date, monthStr: string) => {
    const segments = computeMonthWeekSegments(monthStart);
    const existingWeeks = (weeksByKr[krId] ?? []).filter(w => w.month === monthStr);
    const weekCards = buildWeekCards(segments, existingWeeks);
    const linkedTasks = computeWeekCardsLinkedTasks(weekCards, weekTasksByWeek, tasks);
    const material = computeReviewMaterial(segments, existingWeeks, linkedTasks, tasks, taskDependencies, today);
    return {
      completedTaskCount: material.completedTaskCount,
      incompleteTaskCount: material.incompleteTaskCount,
      taskStats: material.taskStats,
    };
  };

  // ===== 月ブロック =====
  const monthKrRows: KrPeriodRow[] = useMemo(() => krs.map(kr => {
    const m = findMonthRecord(kr.id, selectedMonthStr);
    return { krId: kr.id, label: kr.label, weightPct: kr.weight_pct, selfEvalPct: m?.self_eval_pct ?? null, gmEvalPct: m?.gm_eval_pct ?? null };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [krs, monthsByKr, selectedMonthStr]);

  const monthRecord = periodReviews.find(r => r.period_kind === "month" && r.month === selectedMonthStr) ?? null;
  const monthEditable = isMonthEditable(classifyMonth(selectedSlot.monthStart, today), false);

  const monthKrEntries: PeriodReviewKrEntry[] = useMemo(() => krs.map(kr => {
    const m = findMonthRecord(kr.id, selectedMonthStr);
    const taskSummary = computeTaskSummary(kr.id, selectedSlot.monthStart, selectedMonthStr);
    return {
      krLabel: kr.label, weightPct: kr.weight_pct,
      months: [buildPeriodReviewKrMonthEntry({
        monthLabel: `${selectedSlot.monthStart.getMonth() + 1}月`,
        positioning: m?.positioning, activities: m?.activities, targetAndEvidence: m?.target_and_evidence, risks: m?.risks,
        reviewText: m?.review_text, selfEvalPct: m?.self_eval_pct, gmEvalPct: m?.gm_eval_pct, gmComment: m?.gm_comment,
        taskSummary,
      })],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [krs, monthsByKr, weeksByKr, weekTasksByWeek, tasks, taskDependencies, selectedMonthStr]);

  const monthDraftContext = useMemo(
    () => buildPeriodReviewDraftContext({ periodLabel: `${selectedSlot.monthStart.getMonth() + 1}月`, periodKind: "month", krEntries: monthKrEntries }),
    [monthKrEntries, selectedSlot],
  );
  const monthMaterialSummaryLines = useMemo(() => buildPeriodReviewMaterialSummaryLines(monthKrEntries), [monthKrEntries]);

  // ===== 四半期ブロック =====
  const quarterKrRows: KrPeriodRow[] = useMemo(() => krs.map(kr => {
    const selfVals = monthStrs.map(ms => findMonthRecord(kr.id, ms)?.self_eval_pct ?? null);
    const gmVals = monthStrs.map(ms => findMonthRecord(kr.id, ms)?.gm_eval_pct ?? null);
    return { krId: kr.id, label: kr.label, weightPct: kr.weight_pct, selfEvalPct: computeMonthlyAverage(selfVals), gmEvalPct: computeMonthlyAverage(gmVals) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [krs, monthsByKr, monthStrs]);

  const quarterRecord = periodReviews.find(r => r.period_kind === "quarter" && r.fiscal_year === fiscalYear && r.quarter === quarter) ?? null;
  const quarterEditable = isQuarterEditable(fiscalYear, quarter, false, today);

  const quarterKrEntries: PeriodReviewKrEntry[] = useMemo(() => krs.map(kr => ({
    krLabel: kr.label, weightPct: kr.weight_pct,
    months: monthSlots.map(slot => {
      const ms = monthToDateStr(slot.monthStart);
      const m = findMonthRecord(kr.id, ms);
      const taskSummary = computeTaskSummary(kr.id, slot.monthStart, ms);
      return buildPeriodReviewKrMonthEntry({
        monthLabel: `${slot.monthStart.getMonth() + 1}月`,
        positioning: m?.positioning, activities: m?.activities, targetAndEvidence: m?.target_and_evidence, risks: m?.risks,
        reviewText: m?.review_text, selfEvalPct: m?.self_eval_pct, gmEvalPct: m?.gm_eval_pct, gmComment: m?.gm_comment,
        taskSummary,
      });
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  })), [krs, monthsByKr, weeksByKr, weekTasksByWeek, tasks, taskDependencies, monthSlots]);

  const quarterDraftContext = useMemo(
    () => buildPeriodReviewDraftContext({ periodLabel: `${fiscalYear}年度 ${quarter}`, periodKind: "quarter", krEntries: quarterKrEntries }),
    [quarterKrEntries, fiscalYear, quarter],
  );
  const quarterMaterialSummaryLines = useMemo(() => buildPeriodReviewMaterialSummaryLines(quarterKrEntries), [quarterKrEntries]);

  if (periodReviewsError) {
    return (
      <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--color-text-tertiary)", fontSize: "13px", background: "var(--color-bg-secondary)", border: "1px solid var(--color-border-primary)", borderTop: "none", borderRadius: "0 0 var(--radius-md) var(--radius-md)" }}>
        この機能はデータベースへの適用がまだです（管理者に連絡してください）。
      </div>
    );
  }

  if (!periodReviewsLoaded) {
    return (
      <div style={{ padding: "40px 0", textAlign: "center", color: "var(--color-text-tertiary)", fontSize: "12px" }}>読み込み中…</div>
    );
  }

  return (
    <div>
      <PersonalPeriodReviewBlock
        periodKind="month"
        title={`${selectedSlot.monthStart.getMonth() + 1}月の全体`}
        formulaText="Σ(KRの自己評価% × ウェイト) ÷ Σ(ウェイト)"
        krRows={monthKrRows}
        loadingKrData={loadingKrData}
        currentUser={currentUser}
        record={monthRecord}
        editable={monthEditable}
        fiscalYear={fiscalYear}
        quarter={quarter}
        month={selectedMonthStr}
        onSave={savePeriodReview}
        draftMaterialSummaryLines={monthMaterialSummaryLines}
        draftContextText={monthDraftContext.text}
      />
      <PersonalPeriodReviewBlock
        periodKind="quarter"
        title={`${fiscalYear}年度 ${quarter} 全体`}
        formulaText="Σ(KRの自己評価%の3か月平均 × ウェイト) ÷ Σ(ウェイト)"
        krRows={quarterKrRows}
        loadingKrData={loadingKrData}
        currentUser={currentUser}
        record={quarterRecord}
        editable={quarterEditable}
        fiscalYear={fiscalYear}
        quarter={quarter}
        month={null}
        onSave={savePeriodReview}
        draftMaterialSummaryLines={quarterMaterialSummaryLines}
        draftContextText={quarterDraftContext.text}
      />
    </div>
  );
}
