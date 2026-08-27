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
import { computeMonthlyAverage, computePeriodReference, averageMonthlyReferences } from "../../../lib/personalOkr/periodReviewReference";
import { isKrActiveInMonth, resolveEffectiveWeightPct, areAllKrMonthsLoaded } from "../../../lib/personalOkr/krMonthScope";
import {
  buildPeriodReviewKrMonthEntry, buildPeriodReviewDraftContext, buildPeriodReviewMaterialSummaryLines,
  type PeriodReviewKrEntry,
} from "../../../lib/personalOkr/periodReviewDraftContext";
import type { ActualActivitiesAvailability } from "../../../lib/personalOkr/actualActivitiesAvailability";
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
  /** 実施記録（actual_activities列）の利用可否（仕様書§W2・2026-08-27・v3.105） */
  actualActivitiesAvailable: ActualActivitiesAvailability;
}

export function PersonalOverallView({
  currentUser, fiscalYear, quarter, monthIndex, krs, monthsByKr, weeksByKr, weekTasksByWeek,
  ensureKrDetailLoaded, ensureWeekTasksLoaded, tasks, taskDependencies,
  periodReviews, periodReviewsLoaded, periodReviewsLoading, periodReviewsError,
  loadPeriodReviews, savePeriodReview, actualActivitiesAvailable,
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

  // 🔴 v3.106：PersonalOkrView.tsxのウェイト合計警告ゲートと同じ判定関数を使う
  // （krMonthScope.tsのareAllKrMonthsLoaded。同じ条件を各所に書き直さない）。
  const loadingKrData = krs.length > 0 && !areAllKrMonthsLoaded(krs, monthsByKr);

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
  // 🔴【2026-08-26・v3.104】対象外のKR（active_month_indexesにこの月を含まない）は除外し、
  // ウェイトは実効ウェイト（月ごとの上書きがあればそれ・無ければ四半期共通値）を使う。
  // v3.101はこの2点を欠いており（対象外KRも並び、四半期共通のkr.weight_pctをそのまま見ていた）、
  // 実装欠陥として今回是正する（仕様書§1・§W4-3）。
  const monthKrRows: KrPeriodRow[] = useMemo(() => krs
    .filter(kr => isKrActiveInMonth(kr, monthIndex))
    .map(kr => {
      const m = findMonthRecord(kr.id, selectedMonthStr);
      const weightPct = resolveEffectiveWeightPct(kr, m, monthIndex) ?? 0;
      return { krId: kr.id, label: kr.label, weightPct, selfEvalPct: m?.self_eval_pct ?? null, gmEvalPct: m?.gm_eval_pct ?? null };
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [krs, monthsByKr, selectedMonthStr, monthIndex]);

  const monthReference = useMemo(() => computePeriodReference(monthKrRows), [monthKrRows]);

  const monthRecord = periodReviews.find(r => r.period_kind === "month" && r.month === selectedMonthStr) ?? null;
  const monthEditable = isMonthEditable(classifyMonth(selectedSlot.monthStart, today), false);

  // 🔴 対象外のKRはこの月のAI下書き文脈・材料要約からも除外する（実効ウェイトも反映）。
  const monthKrEntries: PeriodReviewKrEntry[] = useMemo(() => krs
    .filter(kr => isKrActiveInMonth(kr, monthIndex))
    .map(kr => {
      const m = findMonthRecord(kr.id, selectedMonthStr);
      const taskSummary = computeTaskSummary(kr.id, selectedSlot.monthStart, selectedMonthStr);
      const weightPct = resolveEffectiveWeightPct(kr, m, monthIndex) ?? 0;
      return {
        krLabel: kr.label, weightPct,
        months: [buildPeriodReviewKrMonthEntry({
          monthLabel: `${selectedSlot.monthStart.getMonth() + 1}月`,
          positioning: m?.positioning, activities: m?.activities, targetAndEvidence: m?.target_and_evidence, risks: m?.risks,
          reviewText: m?.review_text, selfEvalPct: m?.self_eval_pct, gmEvalPct: m?.gm_eval_pct, gmComment: m?.gm_comment,
          actualActivities: m?.actual_activities,
          taskSummary,
        })],
      };
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [krs, monthsByKr, weeksByKr, weekTasksByWeek, tasks, taskDependencies, selectedMonthStr, monthIndex]);

  const monthDraftContext = useMemo(
    () => buildPeriodReviewDraftContext({
      periodLabel: `${selectedSlot.monthStart.getMonth() + 1}月`, periodKind: "month", krEntries: monthKrEntries,
      // 🔴 対象期間そのものの実施記録（どのKRにも属さない業務。仕様書§W4）
      overallActualActivities: monthRecord?.actual_activities ?? null,
    }),
    [monthKrEntries, selectedSlot, monthRecord],
  );
  const monthMaterialSummaryLines = useMemo(() => buildPeriodReviewMaterialSummaryLines(monthKrEntries), [monthKrEntries]);

  // ===== 四半期ブロック =====
  // 🔴【2026-08-26・v3.104で算出式を変更】v3.101は「各KRの3か月平均self_eval_pct×四半期ウェイト」
  // だったが、月ごとに対象KR・ウェイトの両方が変わる以上この式は成り立たない。「月ごとに参考値を
  // 出し、それらを平均する」に改めた（periodReviewReference.ts の averageMonthlyReferences 参照。
  // 画面には formulaText として明記する）。
  //
  // quarterKrRows（KRごとの内訳表示専用）は、四半期の3か月のうち1か月でも対象だったKRを一覧し、
  // 参考として「対象だった月だけのself_eval_pct/gm_eval_pctの単純平均」と「四半期共通のweight_pct」
  // を表示する。🔴 この内訳の数値は表示専用の参考情報であり、上のquarterReference（実際の参考値）
  // の算出には使わない（月ごとに対象KR・実効ウェイトの両方が変わるため、KR単位の単一の重みで
  // 四半期の参考値を再現することはできない）。
  const quarterKrRows: KrPeriodRow[] = useMemo(() => krs
    .filter(kr => monthSlots.some(slot => isKrActiveInMonth(kr, slot.monthIndex)))
    .map(kr => {
      const activeSlots = monthSlots.filter(slot => isKrActiveInMonth(kr, slot.monthIndex));
      const selfVals = activeSlots.map(slot => findMonthRecord(kr.id, monthToDateStr(slot.monthStart))?.self_eval_pct ?? null);
      const gmVals = activeSlots.map(slot => findMonthRecord(kr.id, monthToDateStr(slot.monthStart))?.gm_eval_pct ?? null);
      return { krId: kr.id, label: kr.label, weightPct: kr.weight_pct, selfEvalPct: computeMonthlyAverage(selfVals), gmEvalPct: computeMonthlyAverage(gmVals) };
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [krs, monthsByKr, monthSlots]);

  // 四半期の参考値そのもの：3か月それぞれについて、その月の対象KR・実効ウェイトで月次参考値を
  // 求め（monthReferenceと同じ式）、3つの値を単純平均する。
  const quarterReference = useMemo(() => {
    const monthlyRefs = monthSlots.map(slot => {
      const ms = monthToDateStr(slot.monthStart);
      const rows: KrPeriodRow[] = krs
        .filter(kr => isKrActiveInMonth(kr, slot.monthIndex))
        .map(kr => {
          const m = findMonthRecord(kr.id, ms);
          const weightPct = resolveEffectiveWeightPct(kr, m, slot.monthIndex) ?? 0;
          return { krId: kr.id, label: kr.label, weightPct, selfEvalPct: m?.self_eval_pct ?? null, gmEvalPct: m?.gm_eval_pct ?? null };
        });
      return computePeriodReference(rows);
    });
    return averageMonthlyReferences(monthlyRefs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [krs, monthsByKr, monthSlots]);

  const quarterRecord = periodReviews.find(r => r.period_kind === "quarter" && r.fiscal_year === fiscalYear && r.quarter === quarter) ?? null;
  const quarterEditable = isQuarterEditable(fiscalYear, quarter, false, today);

  // 🔴 AI下書き文脈も、四半期を通じて一度も対象にならなかったKRは除外する。月ごとの実効ウェイトは
  // 月内訳（PeriodReviewKrMonthEntry）側には持たせていないため、ここでは対象外の月の実績データ
  // （positioning等）は引き続き含める（過去の記録として文脈から消さない。対象外＝除外するのは
  // 「四半期を通して1度も対象にならなかったKR」のみ）。
  const quarterKrEntries: PeriodReviewKrEntry[] = useMemo(() => krs
    .filter(kr => monthSlots.some(slot => isKrActiveInMonth(kr, slot.monthIndex)))
    .map(kr => ({
      krLabel: kr.label, weightPct: kr.weight_pct,
      months: monthSlots.map(slot => {
        const ms = monthToDateStr(slot.monthStart);
        const m = findMonthRecord(kr.id, ms);
        const taskSummary = computeTaskSummary(kr.id, slot.monthStart, ms);
        return buildPeriodReviewKrMonthEntry({
          monthLabel: `${slot.monthStart.getMonth() + 1}月`,
          positioning: m?.positioning, activities: m?.activities, targetAndEvidence: m?.target_and_evidence, risks: m?.risks,
          reviewText: m?.review_text, selfEvalPct: m?.self_eval_pct, gmEvalPct: m?.gm_eval_pct, gmComment: m?.gm_comment,
          actualActivities: m?.actual_activities,
          taskSummary,
        });
      }),
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [krs, monthsByKr, weeksByKr, weekTasksByWeek, tasks, taskDependencies, monthSlots]);

  const quarterDraftContext = useMemo(
    () => buildPeriodReviewDraftContext({
      periodLabel: `${fiscalYear}年度 ${quarter}`, periodKind: "quarter", krEntries: quarterKrEntries,
      // 🔴 四半期そのものの実施記録（personal_period_reviews.period_kind='quarter'の行。
      // 各月の「全体」記録の集約はしない＝既存のquarterKrEntries同様、この四半期行自体が持つ値）
      overallActualActivities: quarterRecord?.actual_activities ?? null,
    }),
    [quarterKrEntries, fiscalYear, quarter, quarterRecord],
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
        formulaText="Σ(KRの自己評価% × その月の実効ウェイト) ÷ Σ(その月の実効ウェイト)（対象外のKRは含みません）"
        krRows={monthKrRows}
        reference={monthReference}
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
        actualActivitiesAvailable={actualActivitiesAvailable}
      />
      <PersonalPeriodReviewBlock
        periodKind="quarter"
        title={`${fiscalYear}年度 ${quarter} 全体`}
        formulaText="月ごとの参考値（Σ(KRの自己評価%×その月の実効ウェイト)÷Σ(その月の実効ウェイト)）を求め、その3か月の単純平均"
        krRows={quarterKrRows}
        reference={quarterReference}
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
        actualActivitiesAvailable={actualActivitiesAvailable}
      />
    </div>
  );
}
