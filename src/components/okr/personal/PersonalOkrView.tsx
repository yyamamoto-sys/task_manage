// src/components/okr/personal/PersonalOkrView.tsx
//
// 【設計意図】
// OKRモード「自分」タブの本体。個人四半期KRのタブ一覧（ウェイト付き）→ 選択中KRの
// PersonalKrPanel（月切替・今月の計画・週の目標状態・メモ）を描画する。
// docs/dev/okr-redesign-plan.md §7・CLAUDE.md Section 24 が正本。
//
// 状態はappStore（全アプリの単一真実）ではなく専用のusePersonalOkrUiStore（zustand。
// このコンポーネントがReact.lazyで分割されているため、import自体が「自分」タブを
// 開いた瞬間まで遅延する＝OKRモードを使わない人にこのテーブル群のクエリを発生させない。
// CLAUDE.md Section 19）を使う。
//
// 🔴 v3.100：KR切替（KRタブ・新規作成/編集後の自動選択）・月切替・四半期切替は、
// MainLayoutの guardedNavigate を経由しない内部状態の変更で、PersonalKrPanel/
// MonthReviewBlock（未保存編集を持ちうる）をこのコンポーネントは再マウントしないまま
// 中身だけ差し替える（v3.55でkey={selectedKr.id}を外した設計）。そのため、これらの
// 切替自体をguardedSwitch()でガードし、未保存の変更があれば確認する
// （CLAUDE.md Section 46）。四半期・年の切替でKR一覧が丸ごと変わり選択中KRが
// 自動的に補正される（下のuseEffect）ため、四半期の切替もガード対象に含める。
// 年（fiscalYear）の入力欄は1文字入力ごとにonChangeが発火する自由入力のため、
// キー入力のたびに確認ダイアログを出すのは現実的でなくガード対象から意図的に外した
// （実際に年を変えて別の期のKRへ切り替える操作は稀）。

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAppStore, selectScopedTasks, selectScopedTaskDependencies } from "../../../stores/appStore";
import { usePersonalOkrUiStore } from "../../../stores/personalOkrUiStore";
import type { Member, PersonalKr, PersonalKrMonth, PersonalKrOutlook, Quarter, Task, TaskDependency } from "../../../lib/localData/types";
import type { PersonalOkrAiContextInput } from "../../../lib/personalOkr/personalOkrAiContext";
import { currentQuarter } from "../../../lib/date";
import { isWeightTotalWarning } from "../../../lib/personalOkr/weightCheck";
import { listAvailablePersonalKrPeriods } from "../../../lib/personalOkr/availablePeriods";
import { quarterMonthSlots, resolveDefaultMonthIndex, monthToDateStr } from "../../../lib/personalOkr/quarterMonths";
import { isKrActiveInMonth, resolveEffectiveWeightPct, sumEffectiveWeightPct, areAllKrMonthsLoaded } from "../../../lib/personalOkr/krMonthScope";
import { shouldInjectOkrTourPreviewSample } from "../../../lib/personalOkr/tourPreviewSample";
import { confirmDiscardUnsavedEdits } from "../../../lib/editing/unsavedEditorRegistry";
import { useTour } from "../../tour/TourProvider";
import { OKR_TOUR_ID } from "../../tour/tours";
import { CustomSelect } from "../../common/CustomSelect";
import { PersonalKrFormModal } from "./PersonalKrFormModal";
import { PersonalKrPanel } from "./PersonalKrPanel";
import { PersonalOkrImportModal } from "./PersonalOkrImportModal";
import { PersonalOkrAiPanel } from "./PersonalOkrAiPanel";
import { PersonalOverallView } from "./PersonalOverallView";

/** 「全体」タブの選択を表す sentinel（KRのidと衝突しない固定文字列）。v3.101・Section 24 Step Q。 */
const OVERALL_TAB_ID = "__overall__";

/** ツアー用サンプル：個人OKRサンプル本体＋週に紐づく実演用タスク（dataset.ts側）。
 *  どちらも動的importでのみ読み込む（Section 19。personalOkrDataset.test.ts／
 *  dataset.test.ts が静的import禁止を機械検査する）。型だけは`import("...")`型構文で
 *  参照する（`import type ... from "..."`は静的import検査の正規表現にひっかかるため）。 */
type DemoPersonalOkrData = import("../../../lib/demo/personalOkrDataset").DemoPersonalOkrData;
interface OkrTourPreviewData {
  personal: DemoPersonalOkrData;
  tasks: Task[];
  taskDependencies: TaskDependency[];
}

/** 何のキーで問い合わせても null を返すダミーの解析結果マップ。ツアーのサンプルKRの
 *  personal_kr_id は実DBに存在しないため、実データのensureOutlookLoadedを呼ばせず
 *  「AI解析：未実施」を即時に出すための差し込み値（PersonalKrPanel.tsx参照）。 */
function buildPreviewOutlookMap(krs: PersonalKr[], monthStrs: string[]): Record<string, PersonalKrOutlook | null> {
  const map: Record<string, PersonalKrOutlook | null> = {};
  for (const kr of krs) for (const m of monthStrs) map[`${kr.id}::${m}`] = null;
  return map;
}

// 🔴🔴 サンプル表示中に PersonalKrPanel へ渡す「保存経路そのものを塞ぐ」ための共有no-op。
// 実データのstoreアクション（saveMonth/saveWeek/saveMemo/linkWeekTask/unlinkWeekTask/
// ensureOutlookLoaded/onRunOutlookAnalysis/ensureWeekTasksLoaded）を一切呼ばない
// （呼び出し経路自体が実データのアクションへ到達しない＝「保存経路を完全に塞ぐ」の実装）。
// 引数の型はハンドラごとに違うため `any[]` で受けるが、戻り値の型（Promise<void> / void）は
// 呼び出し先のPropsの型にそのまま代入可能。モジュールスコープの単一インスタンスにして
// レンダーごとに新しい関数を作らない。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PREVIEW_NOOP_ASYNC = async (..._args: any[]): Promise<void> => { /* サンプル表示中は保存しない */ };
const PREVIEW_NOOP = (): void => { /* サンプル表示中は編集しない */ };

const QUARTER_OPTIONS: { value: Quarter; label: string }[] = [
  { value: "1Q", label: "1Q（1〜3月）" },
  { value: "2Q", label: "2Q（4〜6月）" },
  { value: "3Q", label: "3Q（7〜9月）" },
  { value: "4Q", label: "4Q（10〜12月）" },
];

interface Props {
  currentUser: Member;
}

export function PersonalOkrView({ currentUser }: Props) {
  const keyResults = useAppStore(s => s.keyResults);
  const taskForces = useAppStore(s => s.taskForces);
  const objectives = useAppStore(s => s.objectives);
  const todos = useAppStore(s => s.todos);
  const currentGroupId = useAppStore(s => s.currentGroupId);
  const tasks = useAppStore(selectScopedTasks);
  const taskDependencies = useAppStore(selectScopedTaskDependencies);

  const krs = usePersonalOkrUiStore(s => s.krs);
  const krsLoaded = usePersonalOkrUiStore(s => s.krsLoaded);
  const krsLoading = usePersonalOkrUiStore(s => s.krsLoading);
  const krsError = usePersonalOkrUiStore(s => s.krsError);
  const loadKrs = usePersonalOkrUiStore(s => s.loadKrs);
  const ensureKrDetailLoaded = usePersonalOkrUiStore(s => s.ensureKrDetailLoaded);
  const ensurePeriodMonthsLoaded = usePersonalOkrUiStore(s => s.ensurePeriodMonthsLoaded);
  const detailLoadingKrId = usePersonalOkrUiStore(s => s.detailLoadingKrId);
  const monthsByKr = usePersonalOkrUiStore(s => s.monthsByKr);
  const weeksByKr = usePersonalOkrUiStore(s => s.weeksByKr);
  const memosByKr = usePersonalOkrUiStore(s => s.memosByKr);
  const weekTasksByWeek = usePersonalOkrUiStore(s => s.weekTasksByWeek);
  const ensureWeekTasksLoaded = usePersonalOkrUiStore(s => s.ensureWeekTasksLoaded);
  const saveKr = usePersonalOkrUiStore(s => s.saveKr);
  const deleteKr = usePersonalOkrUiStore(s => s.deleteKr);
  const saveMonth = usePersonalOkrUiStore(s => s.saveMonth);
  const saveWeek = usePersonalOkrUiStore(s => s.saveWeek);
  const saveMemo = usePersonalOkrUiStore(s => s.saveMemo);
  const linkWeekTask = usePersonalOkrUiStore(s => s.linkWeekTask);
  const unlinkWeekTask = usePersonalOkrUiStore(s => s.unlinkWeekTask);
  const outlookByKrMonth = usePersonalOkrUiStore(s => s.outlookByKrMonth);
  const outlookAnalyzingKeys = usePersonalOkrUiStore(s => s.outlookAnalyzingKeys);
  const outlookErrorByKey = usePersonalOkrUiStore(s => s.outlookErrorByKey);
  const ensureOutlookLoaded = usePersonalOkrUiStore(s => s.ensureOutlookLoaded);
  const runOutlookAnalysis = usePersonalOkrUiStore(s => s.runOutlookAnalysis);
  const reviewDraftByKrMonth = usePersonalOkrUiStore(s => s.reviewDraftByKrMonth);
  const reviewDraftAnalyzingKeys = usePersonalOkrUiStore(s => s.reviewDraftAnalyzingKeys);
  const reviewDraftErrorByKey = usePersonalOkrUiStore(s => s.reviewDraftErrorByKey);
  const ensureReviewDraftLoaded = usePersonalOkrUiStore(s => s.ensureReviewDraftLoaded);
  const runReviewDraft = usePersonalOkrUiStore(s => s.runReviewDraft);
  const periodReviews = usePersonalOkrUiStore(s => s.periodReviews);
  const periodReviewsLoaded = usePersonalOkrUiStore(s => s.periodReviewsLoaded);
  const periodReviewsLoading = usePersonalOkrUiStore(s => s.periodReviewsLoading);
  const periodReviewsError = usePersonalOkrUiStore(s => s.periodReviewsError);
  const loadPeriodReviews = usePersonalOkrUiStore(s => s.loadPeriodReviews);
  const savePeriodReview = usePersonalOkrUiStore(s => s.savePeriodReview);
  const actualActivitiesAvailable = usePersonalOkrUiStore(s => s.actualActivitiesAvailable);
  const ensureActualActivitiesChecked = usePersonalOkrUiStore(s => s.ensureActualActivitiesChecked);

  // ===== OKRモードのガイドツアー（CLAUDE.md Section 24） =====
  // 🔴 このコンポーネントが実際にマウントされた時点で「OKRモードへ初めて入った」と
  // みなし、未完了なら自動で開始する（既存の初回ゲート＝OkrModeIntroModalの承認直後・
  // ゲストの直接入室のどちらでも、appModeが"okr"になった結果としてここへ到達するため、
  // 起動口を1箇所に集約できる）。他のツアーが進行中のときは横取りしない。
  const tour = useTour();
  useEffect(() => {
    if (!tour.isRunning && !tour.isCompleted(OKR_TOUR_ID)) tour.start(OKR_TOUR_ID);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const isOkrTourRunning = tour.activeTourId === OKR_TOUR_ID;

  // ===== AIパネル（Phase 3後半・計画モードと同じ右パネルの型を流用） =====
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [aiPanelWidth, setAiPanelWidth] = useState(380);
  const [aiPanelResizing, setAiPanelResizing] = useState(false);
  const [aiContext, setAiContext] = useState<PersonalOkrAiContextInput | null>(null);

  useEffect(() => { if (!krsLoaded) loadKrs(); }, [krsLoaded, loadKrs]);
  // 🔴 実施記録（actual_activities列）の利用可否を1回だけ確認する（仕様書§W2・v3.105）。
  // KRタブを開くより前に確認を始めておくことで、実際に画面へたどり着く頃には解決している
  // 想定（ensureActualActivitiesChecked自体が確定済みなら何もしない・冪等）。
  useEffect(() => { void ensureActualActivitiesChecked(); }, [ensureActualActivitiesChecked]);

  // ===== KR切替・月切替・四半期切替のガード（CLAUDE.md Section 46・v3.100） =====
  // MainLayout.tsxのguardedNavigateと同じ考え方（未保存の編集があれば確認してから
  // 実際の状態変更を行う）だが、このコンポーネント固有の遷移のみを対象にするため
  // 独立した薄い関数として持つ（入れ子呼び出しが無いため navigationConfirmedRef の
  // ような再入防止は不要）。
  const guardedSwitch = useCallback(async (action: () => void): Promise<void> => {
    const proceed = await confirmDiscardUnsavedEdits();
    if (proceed) action();
  }, []);

  const [fiscalYear, setFiscalYear] = useState(() => new Date().getFullYear());
  const [quarter, setQuarter] = useState<Quarter>(() => currentQuarter());

  // 🔴 月の選択は「対象期」行に置き、KRタブをまたいで共有する（2026-08-12・山本さんの報告：
  // 「7月にチェックを入れた後に他のKRに切り替えるとすべて8月に戻される」への対応。以前は
  // PersonalKrPanel側のローカルstateで、KR切替時にkey={selectedKr.id}でコンポーネントごと
  // 作り直されるたびに当月へリセットされていた）。年・四半期を変えたときは、その四半期の
  // 既定月（当月が含まれていればそれ・無ければ先頭の月）に追従させる。
  const today = useMemo(() => new Date(), []);
  const monthSlots = useMemo(() => quarterMonthSlots(fiscalYear, quarter), [fiscalYear, quarter]);
  const [monthIndex, setMonthIndex] = useState<1 | 2 | 3>(() => resolveDefaultMonthIndex(fiscalYear, quarter, today));
  useEffect(() => {
    setMonthIndex(resolveDefaultMonthIndex(fiscalYear, quarter, today));
  }, [fiscalYear, quarter, today]);
  const monthOptions = useMemo(
    () => monthSlots.map(s => ({ value: String(s.monthIndex), label: `${s.monthStart.getMonth() + 1}月` })),
    [monthSlots],
  );

  const activeKrs = useMemo(
    () => krs
      .filter(k => !k.is_deleted && k.fiscal_year === fiscalYear && k.quarter === quarter)
      .sort((a, b) => a.display_order - b.display_order),
    [krs, fiscalYear, quarter],
  );

  // ===== 対象期の全KRの月レコード先読み（v3.106） =====
  // 🔴 KR単位のensureKrDetailLoaded（当該KRのタブを開いたときだけ月レコードを読む）だけに
  // 任せると、未訪問のKRのウェイトがウェイト合計の警告で四半期共通値へフォールバックし、
  // 実際には100%に調整済みでも警告が出続ける不具合になる（利用者報告そのもの）。
  // KR一覧（activeKrs＝対象期の全KR）が確定した時点・対象期を切り替えた時点で、
  // 1クエリでまとめて先読みする（週・週タスクは対象外＝従来どおり遅延読み込み）。
  // サンプル表示中（previewSample）は実データのKR一覧が0件のままのため、
  // activeKrs.length===0の分岐で自動的に何もしない（明示チェックは不要）。
  const activeKrIds = useMemo(() => activeKrs.map(k => k.id), [activeKrs]);
  useEffect(() => {
    if (activeKrIds.length === 0) return;
    void ensurePeriodMonthsLoaded(activeKrIds);
  }, [activeKrIds, ensurePeriodMonthsLoaded]);

  // ===== OKRツアーのサンプル差し込み（CLAUDE.md Section 24。実データへの書き込み厳禁） =====
  // 🔴 判定は「ツアー実行中か」×「対象期のKRが0本か」の2点だけ（純粋関数に切り出し・テスト済み）。
  // krsLoaded を条件に足しているのは「実データの取得（Supabaseフェッチ）が終わる前の
  // 一瞬だけ0本に見える」誤検出を避けるため（実際にKRがある人が再生した場合の一瞬の
  // ちらつき防止。判定基準自体は変えていない）。
  const shouldPreview = krsLoaded && shouldInjectOkrTourPreviewSample(isOkrTourRunning, activeKrs.length);
  const [previewSample, setPreviewSample] = useState<OkrTourPreviewData | null>(null);
  useEffect(() => {
    if (!shouldPreview) { setPreviewSample(null); return; }
    let cancelled = false;
    Promise.all([
      import("../../../lib/demo/personalOkrDataset"),
      import("../../../lib/demo/dataset"),
    ]).then(([personalMod, datasetMod]) => {
      if (cancelled) return;
      const personal = personalMod.buildDemoPersonalOkrDataset();
      const demo = datasetMod.buildDemoDataset();
      setPreviewSample({ personal, tasks: demo.tasks, taskDependencies: demo.taskDependencies });
    });
    return () => { cancelled = true; };
  }, [shouldPreview]);

  // 差し込み中はこの2つの変数だけを「サンプルか実データか」の切替点にする（以降のJSX・
  // PersonalKrPanelへの受け渡しは displayKrs／displayTasks 経由に統一し、activeKrs（実データ）を
  // 直接参照し続ける箇所を増やさない）。ただし PersonalKrFormModal の existingKrsInPeriod・
  // PersonalOkrImportModal の allPersonalKrs は「新しく作る実KRのウェイト集計」に使うため、
  // 意図的に activeKrs（実データ）のままにする（サンプルの重み40/35/25を実KR作成の判断材料に
  // 混ぜないため）。
  const displayKrs = previewSample ? previewSample.personal.krs : activeKrs;
  const displayMonthsByKr = previewSample ? previewSample.personal.monthsByKr : monthsByKr;
  const displayWeeksByKr = previewSample ? previewSample.personal.weeksByKr : weeksByKr;
  const displayMemosByKr = previewSample ? previewSample.personal.memosByKr : memosByKr;
  const displayWeekTasksByWeek = previewSample ? previewSample.personal.weekTasksByWeek : weekTasksByWeek;
  const displayTasks = previewSample ? previewSample.tasks : tasks;
  const displayTaskDependencies = previewSample ? previewSample.taskDependencies : taskDependencies;
  // AI解析：サンプルKRのidは実DBに存在しないため、常に「未実施」で確定させる（実データの
  // ensureOutlookLoadedを呼ばせず、outlookRow===undefinedによる無限スケルトン表示を避ける）。
  const previewOutlookByKrMonth = useMemo(
    () => previewSample
      ? buildPreviewOutlookMap(previewSample.personal.krs, monthSlots.map(s => monthToDateStr(s.monthStart)))
      : null,
    [previewSample, monthSlots],
  );

  // 🔴【2026-08-26・v3.104】その月の対象外のKRはタブ一覧から消す（仕様書§0-1・§W4-1）。
  // 未適用（active_month_indexesがundefined）のときは全月対象として扱う（krMonthScope.ts）。
  const monthStrForIndex = useMemo(() => monthToDateStr(monthSlots[monthIndex - 1].monthStart), [monthSlots, monthIndex]);
  const monthActiveDisplayKrs = useMemo(
    () => displayKrs.filter(kr => isKrActiveInMonth(kr, monthIndex)),
    [displayKrs, monthIndex],
  );
  const monthRecordByKrIdForMonth = useMemo(() => {
    const map: Record<string, PersonalKrMonth | null | undefined> = {};
    for (const kr of monthActiveDisplayKrs) {
      map[kr.id] = (displayMonthsByKr[kr.id] ?? []).find(m => m.month === monthStrForIndex && !m.is_deleted) ?? null;
    }
    return map;
  }, [monthActiveDisplayKrs, displayMonthsByKr, monthStrForIndex]);

  const [selectedKrId, setSelectedKrId] = useState<string | null>(null);
  useEffect(() => {
    // 🔴 v3.101：「全体」タブ選択中はKRの自動選択の対象外にする（対象期のKRが増減しても
    // 「全体」タブから勝手にKRタブへ切り替わらないようにするため）。
    if (selectedKrId === OVERALL_TAB_ID) return;
    // 🔴 v3.104：選択候補は「その月の対象KR」に限定する（月切替で選択中KRが対象外になった
    // 場合の自動補正もここで行う。この自動補正自体はguardedSwitchで包まない＝トリガー元の
    // 月・四半期切替が既にguardedSwitch経由で未保存確認を済ませている前提のため
    // ＝v3.100と同じ考え方。CLAUDE.md Section 46）。
    if (monthActiveDisplayKrs.length === 0) { setSelectedKrId(null); return; }
    if (!monthActiveDisplayKrs.some(k => k.id === selectedKrId)) setSelectedKrId(monthActiveDisplayKrs[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthActiveDisplayKrs]);

  // 🔴 サンプル表示中はensureKrDetailLoaded（実データのSupabaseフェッチ）を呼ばない
  // （サンプルidは実DBに存在せず、無駄な問い合わせ＋storeへの空データ書き込みになるため）。
  // 「全体」タブ選択中もここでは呼ばない（PersonalOverallView.tsx自身が対象期の全KR分を
  // まとめて呼ぶため、選択中KR1件だけを対象にするこのeffectとは責務が異なる）。
  useEffect(() => {
    if (previewSample) return;
    if (selectedKrId && selectedKrId !== OVERALL_TAB_ID) ensureKrDetailLoaded(selectedKrId);
  }, [selectedKrId, ensureKrDetailLoaded, previewSample]);

  const [formModal, setFormModal] = useState<{ mode: "create" | "edit"; initial: PersonalKr | null } | null>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);
  // 🔴 v3.104：ウェイト合計の判定単位は「その月の対象KRの合計」（仕様書§0-1）。実効ウェイト
  // （月ごとの上書きがあればそれ）を使う。
  const weightTotal = useMemo(
    () => sumEffectiveWeightPct(monthActiveDisplayKrs, monthRecordByKrIdForMonth, monthIndex),
    [monthActiveDisplayKrs, monthRecordByKrIdForMonth, monthIndex],
  );
  const selectedKr = monthActiveDisplayKrs.find(k => k.id === selectedKrId) ?? null;
  // 🔴 対象期にKRが0件のとき、実際にKRが存在する期を候補として出す（取込が別の年度・
  // 四半期に書き込まれていた場合に利用者が詰まないための安全網。CLAUDE.md Section 24）
  const availablePeriods = useMemo(() => listAvailablePersonalKrPeriods(krs), [krs]);

  const tabStyle = (active: boolean): React.CSSProperties => ({
    fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap", textAlign: "left",
    border: "1px solid transparent", borderBottom: "none",
    background: active ? "var(--color-bg-secondary)" : "transparent",
    borderColor: active ? "var(--color-border-primary)" : "transparent",
    padding: "10px 15px 9px", borderRadius: "var(--radius-sm) var(--radius-sm) 0 0",
    color: active ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
    marginBottom: "-1px",
  });

  return (
    <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "auto", padding: "14px 20px 26px" }}>
      {/* 期の選択 */}
      {/* 🔴 flexShrink:0が必須（CLAUDE.md Section 21と同種の罠の裏返し）：この行はoverflow指定を
          持たないため元から潰れていなかったが、将来overflow系のスタイルを足す変更が入っても
          安全なように明示しておく。下のKRタブの帯（overflowX:autoを持つため自動最小サイズが0に
          なり、選択中KRの中身が縦に長いとタブの帯自体が高さ0まで潰れてタブが見えなくなる事故が
          実機で発生した。2026-08-12・v3.53で修正）と対称にする。 */}
      <div data-tour-id="okr-period" style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px", flexWrap: "wrap", flexShrink: 0 }}>
        <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>対象期</span>
        <input
          type="number"
          value={fiscalYear}
          onChange={e => setFiscalYear(Number(e.target.value) || fiscalYear)}
          style={{ width: "84px", fontSize: "12px", padding: "5px 8px", border: "1px solid var(--color-border-secondary)", borderRadius: "var(--radius-sm)", background: "var(--color-bg-primary)", color: "var(--color-text-primary)" }}
        />
        <CustomSelect value={quarter} onChange={v => void guardedSwitch(() => setQuarter(v as Quarter))} options={QUARTER_OPTIONS} style={{ width: "150px" }} />
        <CustomSelect value={String(monthIndex)} onChange={v => void guardedSwitch(() => setMonthIndex(Number(v) as 1 | 2 | 3))} options={monthOptions} style={{ width: "88px" }} />
        <span style={{ flex: 1 }} />
        {previewSample && (
          <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--color-brand)", background: "var(--color-brand-light)", border: "1px solid var(--color-brand-border)", borderRadius: "var(--radius-full)", padding: "3px 10px" }}>
            🔍 これはサンプル表示です（保存されません）
          </span>
        )}
        {/* 🔴 v3.106：全KR分の月レコードが揃うまで警告を出さない（誤った合計を一瞬でも
            見せないため。areAllKrMonthsLoadedはPersonalOverallView.tsxのloadingKrData判定と
            共通化した1つの純粋関数）。 */}
        {!previewSample && monthActiveDisplayKrs.length > 0
          && areAllKrMonthsLoaded(monthActiveDisplayKrs, displayMonthsByKr)
          && isWeightTotalWarning(weightTotal) && (
          <span style={{ fontSize: "11px", color: "var(--color-text-warning)" }}>
            ⚠ この月のウェイト合計 {weightTotal}%（100%ではありません。Kintoneが正本のため警告のみです）
          </span>
        )}
      </div>

      {/* KRタブ */}
      {/* 🔴 flexShrink:0が必須。overflowX:"auto"を持つフレックスアイテムは自動最小サイズが0になる
          （CLAUDE.md Section 21が本文にminHeight:0を要求するのと同じCSSの規則の裏返し）ため、
          親の高さが選択中KRの中身（PersonalKrPanel。縦に長い）に対して不足すると、flex-shrinkの
          対象としてこの帯だけが真っ先に高さ0まで潰れ、「KRタブが1つも表示されない」ように見える
          （実機で発生・2026-08-12。「＋KRを追加」「📥 Kintoneから取込」ボタンも同じ帯の中にあり
          一緒に消えていたことから特定した）。 */}
      <div data-tour-id="okr-kr-tabs" style={{ display: "flex", gap: "2px", overflowX: "auto", borderBottom: "1px solid var(--color-border-primary)", flexShrink: 0 }}>
        {/* 🔴 v3.101：「全体」タブ。KRタブの並びは変えず、先頭に固定で追加する（仕様書§W3）。 */}
        <button onClick={() => void guardedSwitch(() => setSelectedKrId(OVERALL_TAB_ID))} style={tabStyle(selectedKrId === OVERALL_TAB_ID)}>
          <span style={{ display: "block", fontSize: "12.5px", fontWeight: 700 }}>全体</span>
          <span style={{ display: "block", fontSize: "10px", marginTop: "1px" }}>&nbsp;</span>
        </button>
        {monthActiveDisplayKrs.map(kr => {
          // 🔴 v3.104：タブのウェイト表示は四半期共通値ではなくその月の実効ウェイトを出す
          // （仕様書§W4-2）。月ごとの上書きが効いている場合は控えめな印（＊）を付ける。
          const monthRecord = monthRecordByKrIdForMonth[kr.id];
          const effectiveWeight = resolveEffectiveWeightPct(kr, monthRecord, monthIndex) ?? kr.weight_pct;
          const overridden = monthRecord?.weight_override_pct != null;
          return (
            <button key={kr.id} onClick={() => void guardedSwitch(() => setSelectedKrId(kr.id))} style={tabStyle(kr.id === selectedKrId)}>
              <span style={{ display: "block", fontSize: "12.5px", fontWeight: 700 }}>{kr.label}</span>
              <span style={{ display: "block", fontSize: "10px", marginTop: "1px" }}>
                {effectiveWeight}%{overridden && <span title="この月だけの上書きウェイトです">＊</span>}
              </span>
            </button>
          );
        })}
        {/* 🔴 ツアー最後の着地点（Section 24）。ここは常に実際の登録操作のまま
            （サンプル表示中でも、ここから作る新しいKRは実データとして保存される）。 */}
        <div data-tour-id="okr-registration-actions" style={{ display: "flex", alignItems: "center" }}>
          <button
            onClick={() => setFormModal({ mode: "create", initial: null })}
            style={{ fontFamily: "inherit", cursor: "pointer", fontSize: "12px", padding: "10px 14px", background: "transparent", border: "none", color: "var(--color-brand)", alignSelf: "center" }}
          >＋ KRを追加</button>
          <button
            onClick={() => setImportModalOpen(true)}
            style={{ fontFamily: "inherit", cursor: "pointer", fontSize: "12px", padding: "10px 14px", background: "transparent", border: "none", color: "var(--color-text-secondary)", alignSelf: "center", whiteSpace: "nowrap" }}
          >📥 Kintoneから取込</button>
        </div>
      </div>

      {krsLoading && !krsLoaded && (
        <div style={{ padding: "40px 0", textAlign: "center", color: "var(--color-text-tertiary)", fontSize: "12px" }}>読み込み中…</div>
      )}

      {selectedKrId === OVERALL_TAB_ID ? (
        // 🔴 v3.101：「全体」タブは常に実データ（activeKrs等）を見る。ツアーのサンプル
        // 差し込み（previewSample）はKRタブ側だけの仕組みのため、ここでは使わない。
        <PersonalOverallView
          currentUser={currentUser}
          fiscalYear={fiscalYear}
          quarter={quarter}
          monthIndex={monthIndex}
          krs={activeKrs}
          monthsByKr={monthsByKr}
          weeksByKr={weeksByKr}
          weekTasksByWeek={weekTasksByWeek}
          ensureKrDetailLoaded={ensureKrDetailLoaded}
          ensureWeekTasksLoaded={ensureWeekTasksLoaded}
          tasks={tasks}
          taskDependencies={taskDependencies}
          periodReviews={periodReviews}
          periodReviewsLoaded={periodReviewsLoaded}
          periodReviewsLoading={periodReviewsLoading}
          periodReviewsError={periodReviewsError}
          loadPeriodReviews={loadPeriodReviews}
          savePeriodReview={savePeriodReview}
          actualActivitiesAvailable={actualActivitiesAvailable}
        />
      ) : selectedKr ? (
        <PersonalKrPanel
          // 🔴 key={selectedKr.id}は外した（v3.55）。以前はKR切替のたびにコンポーネントごと
          // 作り直され、月選択（旧・ローカルstate）が当月にリセットされていた。月は上の
          // 「対象期」行のstateに一元化したためpropsで渡す。下書きstate（今月の計画の4欄・
          // バンド）がKR切替時に前のKRの内容を引きずらないことは、PersonalKrPanel内の
          // useEffectがkr.idを依存配列に含めることで担保している（同ファイルのコメント参照）。
          kr={selectedKr}
          currentUser={currentUser}
          monthIndex={monthIndex}
          months={displayMonthsByKr[selectedKr.id] ?? []}
          weeks={displayWeeksByKr[selectedKr.id] ?? []}
          memos={displayMemosByKr[selectedKr.id] ?? []}
          loadingDetail={!previewSample && detailLoadingKrId === selectedKr.id}
          keyResults={keyResults}
          taskForces={taskForces}
          objectives={objectives}
          tasks={displayTasks}
          todos={todos}
          taskDependencies={displayTaskDependencies}
          weekTasksByWeek={displayWeekTasksByWeek}
          ensureWeekTasksLoaded={previewSample ? PREVIEW_NOOP_ASYNC : ensureWeekTasksLoaded}
          // 🔴🔴 サンプル表示中は保存経路そのものを差し替える（実データのstoreアクションを
          // 渡さない）。UI側の無効化（readOnly）と二重の防御になる（CLAUDE.md Section 24）。
          onSaveMonth={previewSample ? PREVIEW_NOOP_ASYNC : saveMonth}
          onSaveWeek={previewSample ? PREVIEW_NOOP_ASYNC : saveWeek}
          onSaveMemo={previewSample ? PREVIEW_NOOP_ASYNC : saveMemo}
          onLinkWeekTask={previewSample ? PREVIEW_NOOP_ASYNC : linkWeekTask}
          onUnlinkWeekTask={previewSample ? PREVIEW_NOOP_ASYNC : unlinkWeekTask}
          onEditKr={previewSample ? PREVIEW_NOOP : () => setFormModal({ mode: "edit", initial: selectedKr })}
          outlookByKrMonth={previewOutlookByKrMonth ?? outlookByKrMonth}
          outlookAnalyzingKeys={outlookAnalyzingKeys}
          outlookErrorByKey={outlookErrorByKey}
          ensureOutlookLoaded={previewSample ? PREVIEW_NOOP_ASYNC : ensureOutlookLoaded}
          onRunOutlookAnalysis={previewSample ? PREVIEW_NOOP_ASYNC : runOutlookAnalysis}
          onAiContext={setAiContext}
          onOpenAiPanel={previewSample ? undefined : () => setAiPanelOpen(true)}
          reviewDraftByKrMonth={reviewDraftByKrMonth}
          reviewDraftAnalyzingKeys={reviewDraftAnalyzingKeys}
          reviewDraftErrorByKey={reviewDraftErrorByKey}
          ensureReviewDraftLoaded={previewSample ? PREVIEW_NOOP_ASYNC : ensureReviewDraftLoaded}
          onRunReviewDraft={previewSample ? PREVIEW_NOOP_ASYNC : runReviewDraft}
          readOnly={!!previewSample}
          actualActivitiesAvailable={actualActivitiesAvailable}
        />
      ) : (
        !krsLoading && (
          <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--color-text-tertiary)", fontSize: "13px", background: "var(--color-bg-secondary)", border: "1px solid var(--color-border-primary)", borderTop: "none", borderRadius: "0 0 var(--radius-md) var(--radius-md)" }}>
            {displayKrs.length === 0 ? (
              <>
                <div>{fiscalYear}年{quarter}の個人KRがまだありません。</div>
                <div style={{ marginTop: "6px" }}>
                  Kintoneに個人OKRが既にある場合は「📥 Kintoneから取込」、まだ無い場合は「＋ KRを追加」から手入力で登録できます。
                </div>
                {availablePeriods.length > 0 && (
                  <div style={{ marginTop: "14px" }}>
                    <div style={{ fontSize: "11px", marginBottom: "8px" }}>実際にKRがある期はこちらです（取込先の期がずれている可能性があります）：</div>
                    <div style={{ display: "flex", gap: "6px", justifyContent: "center", flexWrap: "wrap" }}>
                      {availablePeriods.map(p => (
                        <button
                          key={`${p.fiscalYear}::${p.quarter}`}
                          onClick={() => { setFiscalYear(p.fiscalYear); setQuarter(p.quarter); }}
                          style={{ fontFamily: "inherit", fontSize: "11.5px", cursor: "pointer", padding: "5px 12px", borderRadius: "var(--radius-full)", border: "1px solid var(--color-brand-border)", background: "var(--color-brand-light)", color: "var(--color-brand)", fontWeight: 700 }}
                        >{p.fiscalYear}年{p.quarter}（{p.count}件）</button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              // 🔴 v3.104：四半期にはKRがあるが、この月を対象にしたKRが0件のケース
              // （仕様書§W4-1）。「対象月」を変更できるよう、既存KRの編集への導線を出す。
              <>
                <div>この月を対象にしたKRがありません。</div>
                <div style={{ marginTop: "6px" }}>
                  KRの「対象月」を変更するか、新しいKRを追加してください。
                </div>
                <div style={{ marginTop: "14px" }}>
                  <div style={{ fontSize: "11px", marginBottom: "8px" }}>この四半期のKR（対象月を変更できます）：</div>
                  <div style={{ display: "flex", gap: "6px", justifyContent: "center", flexWrap: "wrap" }}>
                    {displayKrs.map(kr => (
                      <button
                        key={kr.id}
                        onClick={() => setFormModal({ mode: "edit", initial: kr })}
                        style={{ fontFamily: "inherit", fontSize: "11.5px", cursor: "pointer", padding: "5px 12px", borderRadius: "var(--radius-full)", border: "1px solid var(--color-border-primary)", background: "var(--color-bg-tertiary)", color: "var(--color-text-secondary)", fontWeight: 700 }}
                      >✏️ {kr.label}を編集</button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )
      )}

      {krsError && <div style={{ color: "var(--color-text-danger)", fontSize: "12px", marginTop: "10px" }}>{krsError}</div>}

      {formModal && (
        <PersonalKrFormModal
          mode={formModal.mode}
          initial={formModal.initial}
          existingKrsInPeriod={activeKrs}
          monthsByKr={monthsByKr}
          currentUserId={currentUser.id}
          currentGroupId={currentGroupId}
          keyResults={keyResults}
          taskForces={taskForces}
          objectives={objectives}
          defaultFiscalYear={fiscalYear}
          defaultQuarter={quarter}
          onSave={async kr => { await saveKr(kr); void guardedSwitch(() => setSelectedKrId(kr.id)); }}
          onDelete={
            formModal.mode === "edit" && formModal.initial
              ? async () => { await deleteKr(formModal.initial!.id, currentUser.id); setSelectedKrId(null); }
              : undefined
          }
          onClose={() => setFormModal(null)}
        />
      )}

      {importModalOpen && (
        <PersonalOkrImportModal
          currentUser={currentUser}
          currentGroupId={currentGroupId}
          allPersonalKrs={krs}
          monthsByKr={monthsByKr}
          ensureKrDetailLoaded={ensureKrDetailLoaded}
          saveKr={saveKr}
          saveMonth={saveMonth}
          keyResults={keyResults}
          taskForces={taskForces}
          objectives={objectives}
          defaultFiscalYear={fiscalYear}
          defaultQuarter={quarter}
          onClose={() => setImportModalOpen(false)}
        />
      )}
    </div>

    {/* AIパネル：計画モードのConsultationPanelと同じ「inline幅遷移でメインエリアが縮んで
        共存する」型。widthはPersonalOkrAiPanel側で管理し、ここは幅ぶんの枠だけ持つ
        （MainLayout.tsxのConsultationPanel配置と同じパターン）。 */}
    <div style={{
      width: aiPanelOpen ? `${aiPanelWidth}px` : "0", flexShrink: 0, overflow: "hidden",
      transition: aiPanelResizing ? "none" : "width 0.3s ease",
    }}>
      <PersonalOkrAiPanel
        isOpen={aiPanelOpen}
        onClose={() => setAiPanelOpen(false)}
        krLabel={selectedKr?.label ?? ""}
        monthLabel={aiContext?.monthLabel ?? ""}
        context={aiContext}
        inline
        onWidthChange={setAiPanelWidth}
        onResizingChange={setAiPanelResizing}
      />
    </div>
    </div>
  );
}
