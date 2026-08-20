// src/components/okr/personal/PersonalKrPanel.tsx
//
// 【設計意図】
// 個人OKRビュー・選択中の個人KR1本の中身。上から
// 「月の切替バー → このKRの内容（折りたたみ） → 今月の計画 → ★週の目標状態 → これから → メモ」
// の順（docs/dev/okr-redesign-plan.md §7）。「これから」は当月（monthStatus==="current"）のみ
// 表示する（Phase 3前半・機械計算のみ。AIパネル・Phase 4の「月末にやること」下書き生成ボタンは
// ここでは作らない＝未実装の空ボタンを出さない）。
//
// 週は computeMonthWeekSegments が返すセグメント数をそのまま使う（5列固定にしない。
// CLAUDE.md Section 24）。空の週レコードは事前に一括作成せず、goal_state/self_ratingを
// 書いた時点で初めて行を作る（ensureWeek）。
//
// 🔴 月（monthIndex）は v3.55 から props で受け取る（PersonalOkrView.tsx の「対象期」行が
// 一元管理し、KRタブをまたいで共有する）。以前はこのコンポーネントのローカルstateで、
// 親が `key={selectedKr.id}` を渡していたためKR切替のたびに当月へリセットされていた
// （山本さんの報告・2026-08-12「7月を見ていたのに他のKRに切り替えると8月に戻る」）。
// `key` を外した副作用として、KRを切り替えてもこのコンポーネント自体は作り直されない
// ため、下書きstate（今月の計画の4欄・bandTarget・週リンクモーダル等）が前のKRの内容を
// 引きずらないよう、各useEffectのリセット条件に必ず `kr.id` を含める（下記コメント参照）。
//
// 🔴 AI解析（見立て・バンドのAI判定）は v3.55 から自動発火しない（山本さんの決定・
// 2026-08-12：KR切替のたびにAI呼び出しが走り実用に耐えなかったため）。タブを開いた・
// 月を切り替えただけでは呼ばない。保存済みの解析結果（personal_kr_outlooks）の読み込み
// （ensureOutlookLoaded・DBを1回読むだけでゼロトークン）は自動のまま。AI呼び出し自体は
// 明示ボタン（AheadBlock.tsx。未解析なら「✦ 見立てを出す」・解析済みなら「再解析」に
// 文言が切り替わる1つのボタン）を押したときだけ呼ぶ。CLAUDE.md Section 24 Step J・
// docs/dev/okr-redesign-plan.md §5-2参照。

import { useEffect, useMemo, useState, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import type {
  KeyResult, Member, Objective, PersonalKr, PersonalKrBand, PersonalKrMemo, PersonalKrMonth,
  PersonalKrOutlook, PersonalKrReviewDraft, PersonalKrWeek, PersonalKrWeekTask, Task, TaskDependency,
  TaskForce, ToDo, WeekSelfRating,
} from "../../../lib/localData/types";
import { quarterMonthSlots, monthToDateStr, classifyMonth } from "../../../lib/personalOkr/quarterMonths";
import { computeMonthWeekSegments } from "../../../lib/date/monthWeeks";
import { buildWeekCards } from "../../../lib/personalOkr/weekLayout";
import { computeAheadFacts, isTargetAndEvidenceSet } from "../../../lib/personalOkr/aheadCompute";
import { summarizeLinkedTaskStatus } from "../../../lib/personalOkr/aheadTaskStats";
import { computeReviewMaterial, type ReviewMaterial } from "../../../lib/personalOkr/reviewMaterial";
import { computeOutlookInputFingerprint, resolveMonthPlanTimestamp } from "../../../lib/personalOkr/outlookFingerprint";
import type { PersonalOkrAiContextInput } from "../../../lib/personalOkr/personalOkrAiContext";
import { BAND_VALUES, BAND_LABELS, isBandDisabled } from "../../../lib/personalOkr/bandOptions";
import { formatErrorForUser } from "../../../lib/errorMessage";
import { WeekCard } from "./WeekCard";
import { WeekTaskLinkModal } from "./WeekTaskLinkModal";
import { AheadBlock } from "./AheadBlock";
import { PersonalOkrReviewDraftModal } from "./PersonalOkrReviewDraftModal";

const KR_KIND_LABEL: Record<string, string> = {
  group_kr: "グループKR紐づけ", general: "全般", company_common: "全社共通",
  om_common: "OM共通", agm_common: "AGM共通", leader_common: "リーダー共通",
};

const sectionHeadStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: "9px", margin: "20px 0 9px",
  fontSize: "11.5px", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
  color: "var(--color-text-tertiary)",
};
const ruleStyle: React.CSSProperties = { flex: 1, height: "1px", background: "var(--color-border-primary)" };
const cardStyle: React.CSSProperties = {
  background: "var(--color-bg-primary)", border: "1px solid var(--color-border-primary)",
  borderRadius: "var(--radius-md)", padding: "14px 16px",
};
const textareaStyle: React.CSSProperties = {
  width: "100%", fontFamily: "inherit", fontSize: "12.5px", lineHeight: 1.6,
  padding: "8px 10px", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
  background: "var(--color-bg-primary)", color: "var(--color-text-primary)", resize: "vertical",
  minHeight: "48px", boxSizing: "border-box",
};

interface LinkerTarget { weekIndex: number; weekStartStr: string; weekEndStr: string; week: PersonalKrWeek | null; label: string }

interface Props {
  kr: PersonalKr;
  currentUser: Member;
  /** 対象期の月（PersonalOkrView.tsx「対象期」行が一元管理。KRをまたいで共有する） */
  monthIndex: 1 | 2 | 3;
  months: PersonalKrMonth[];
  weeks: PersonalKrWeek[];
  memos: PersonalKrMemo[];
  loadingDetail: boolean;
  keyResults: KeyResult[];
  taskForces: TaskForce[];
  objectives: Objective[];
  tasks: Task[];
  todos: ToDo[];
  taskDependencies: TaskDependency[];
  weekTasksByWeek: Record<string, PersonalKrWeekTask[]>;
  ensureWeekTasksLoaded: (weekId: string) => Promise<void>;
  onSaveMonth: (month: PersonalKrMonth, expectedUpdatedAt?: string) => Promise<void>;
  onSaveWeek: (week: PersonalKrWeek, expectedUpdatedAt?: string) => Promise<void>;
  onSaveMemo: (memo: PersonalKrMemo, expectedUpdatedAt?: string) => Promise<void>;
  onLinkWeekTask: (weekId: string, taskId: string) => Promise<void>;
  onUnlinkWeekTask: (weekId: string, taskId: string) => Promise<void>;
  onEditKr: () => void;
  /** 🔴🔴 OKRツアーのサンプル表示中はtrue。今月の計画・週の目標状態・バンド決定・メモ・
   *  AI解析の起動を全て無効化し、「これはサンプル表示です」の意図を明示する
   *  （CLAUDE.md Section 24。保存経路自体は呼び出し元＝PersonalOkrView.tsxがno-opに
   *  差し替えているため、このフラグはUI側の二重の防御＋案内表示を担う）。 */
  readOnly?: boolean;
  /** Phase 3後半：AI解析の結果とキャッシュ（personal_kr_outlooks）。キーは`${krId}::${month}` */
  outlookByKrMonth: Record<string, PersonalKrOutlook | null>;
  outlookAnalyzingKeys: Set<string>;
  outlookErrorByKey: Record<string, string | null>;
  /** 保存済みの解析結果をDBから1回だけ読む（自動・ゼロトークン）。AI呼び出し自体は行わない */
  ensureOutlookLoaded: (personalKrId: string, month: string) => Promise<void>;
  onRunOutlookAnalysis: (params: {
    personalKrId: string; month: string; fingerprint: string; context: PersonalOkrAiContextInput; force?: boolean;
  }) => Promise<void>;
  /** 当月のAI文脈が変わるたびに親（AIパネルを持つ側）へ報告する。当月以外ではnullを報告する */
  onAiContext?: (ctx: PersonalOkrAiContextInput | null) => void;
  onOpenAiPanel?: () => void;

  /** Phase 4：月末の振り返り下書き（personal_kr_review_drafts）。キーは`${krId}::${month}` */
  reviewDraftByKrMonth: Record<string, PersonalKrReviewDraft | null>;
  reviewDraftAnalyzingKeys: Set<string>;
  reviewDraftErrorByKey: Record<string, string | null>;
  /** 保存済みの下書きをDBから1回だけ読む（自動・ゼロトークン） */
  ensureReviewDraftLoaded: (personalKrId: string, month: string) => Promise<void>;
  onRunReviewDraft: (params: {
    personalKrId: string; month: string; fingerprint: string;
    context: PersonalOkrAiContextInput; material: ReviewMaterial; force?: boolean;
  }) => Promise<void>;
  onSaveReviewDraftEdit: (params: { personalKrId: string; month: string; editedText: string }) => Promise<void>;
}

export function PersonalKrPanel({
  kr, currentUser, monthIndex, months, weeks, memos, loadingDetail,
  keyResults, taskForces, objectives, tasks, todos, taskDependencies,
  weekTasksByWeek, ensureWeekTasksLoaded,
  onSaveMonth, onSaveWeek, onSaveMemo, onLinkWeekTask, onUnlinkWeekTask, onEditKr,
  readOnly = false,
  outlookByKrMonth, outlookAnalyzingKeys, outlookErrorByKey, ensureOutlookLoaded, onRunOutlookAnalysis,
  onAiContext, onOpenAiPanel,
  reviewDraftByKrMonth, reviewDraftAnalyzingKeys, reviewDraftErrorByKey,
  ensureReviewDraftLoaded, onRunReviewDraft, onSaveReviewDraftEdit,
}: Props) {
  const today = useMemo(() => new Date(), []);
  const slots = useMemo(() => quarterMonthSlots(kr.fiscal_year, kr.quarter), [kr.fiscal_year, kr.quarter]);
  const slot = slots.find(s => s.monthIndex === monthIndex) ?? slots[0];
  const monthStr = monthToDateStr(slot.monthStart);
  const monthStatus = classifyMonth(slot.monthStart, today);
  // 🔴🔴 readOnly（サンプル表示中）はmonthStatusに関わらず編集不可にする。WeekCardの
  // editable・AheadBlockのeditable（バンド決定）・今月の計画のテキストエリア／保存ボタンは
  // すべてこの1変数で制御されているため、ここを塞ぐだけで大部分の書き込み経路が塞がれる
  // （CLAUDE.md Section 24）。
  const monthEditable = !readOnly && monthStatus === "current";
  const monthRecord = months.find(m => m.month === monthStr && !m.is_deleted) ?? null;

  const groupKrTitle = useMemo(() => {
    if (kr.kr_kind !== "group_kr") return KR_KIND_LABEL[kr.kr_kind] ?? kr.kr_kind;
    const groupKr = keyResults.find(k => k.id === kr.key_result_id);
    const tf = taskForces.find(t => t.id === kr.task_force_id);
    if (!groupKr) return "グループKR紐づけ";
    return tf ? `${groupKr.title} / TF${tf.tf_number}` : groupKr.title;
  }, [kr.kr_kind, kr.key_result_id, kr.task_force_id, keyResults, taskForces]);
  // objectivesは将来（グループKRの所属Objective表示）に使う可能性があるが現状未使用
  void objectives;

  // ===== 今月の計画：ドラフト =====
  const [positioning, setPositioning] = useState("");
  const [activities, setActivities] = useState("");
  const [targetAndEvidence, setTargetAndEvidence] = useState("");
  const [risks, setRisks] = useState("");
  const [bandTarget, setBandTarget] = useState<PersonalKrBand | null>(null);
  const [savingMonth, setSavingMonth] = useState(false);
  const [monthError, setMonthError] = useState<string | null>(null);

  useEffect(() => {
    setPositioning(monthRecord?.positioning ?? "");
    setActivities(monthRecord?.activities ?? "");
    setTargetAndEvidence(monthRecord?.target_and_evidence ?? "");
    setRisks(monthRecord?.risks ?? "");
    setBandTarget(monthRecord?.band_target ?? null);
    setMonthError(null);
    // 🔴 kr.idを依存に含める（keyによる全体remountを外したため）：新旧どちらのKRにも
    // monthRecordが無い（両方undefined）場合、monthRecord?.idとmonthStrだけでは依存配列が
    // 変化せずリセットされない＝前のKRの下書きが新しいKRに引きずられてしまう事故になる。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kr.id, monthRecord?.id, monthStr]);

  const handleSaveMonthPlan = async () => {
    if (readOnly) return; // 🔴🔴 サンプル表示中は保存経路に入らせない（UI側は既にボタン非表示だが二重の防御）
    setSavingMonth(true);
    setMonthError(null);
    const now = new Date().toISOString();
    const month: PersonalKrMonth = {
      id: monthRecord?.id ?? uuidv4(),
      personal_kr_id: kr.id,
      month: monthStr,
      month_index: monthIndex,
      positioning: positioning || null,
      activities: activities || null,
      target_and_evidence: targetAndEvidence || null,
      risks: risks || null,
      band_target: bandTarget,
      is_deleted: false,
      created_at: monthRecord?.created_at ?? now,
      updated_by: currentUser.id,
    };
    try {
      await onSaveMonth(month, monthRecord?.updated_at);
    } catch (e) {
      setMonthError(formatErrorForUser("今月の計画の保存に失敗しました", e));
    } finally {
      setSavingMonth(false);
    }
  };

  // ===== 週の目標状態 =====
  const segments = useMemo(() => computeMonthWeekSegments(slot.monthStart), [slot.monthStart]);
  const monthWeeks = useMemo(() => weeks.filter(w => w.month === monthStr && !w.is_deleted), [weeks, monthStr]);
  const weekCards = useMemo(() => buildWeekCards(segments, monthWeeks), [segments, monthWeeks]);

  // 🔴 週カードごとのlinkedTasksをここで1回だけ計算する（以前は下のJSXのweekCards.map内で
  // 毎レンダー計算していたため、月次計画の欄に1文字打つだけでも週カード全件分のtasks.find()が
  // 再実行されていた。WeekCard側のgetIncompletePredecessors（allTasks×taskDependenciesの
  // フルスキャン）はこのlinkedTasksの参照安定性に依存してメモ化するため、ここが不安定だと
  // 下流のメモ化が効かない＝重さの本体はここではなくWeekCard側だが、参照安定化はここが起点）。
  const linkedTasksByWeekIndex = useMemo(() => {
    const map: Record<number, Task[]> = {};
    for (const card of weekCards) {
      const linkedIds = (weekTasksByWeek[card.existing?.id ?? ""] ?? []).map(l => l.task_id);
      map[card.weekIndex] = linkedIds.map(id => tasks.find(t => t.id === id)).filter((t): t is Task => !!t);
    }
    return map;
  }, [weekCards, weekTasksByWeek, tasks]);

  // 既存の週レコードに紐づくタスクを、リンクモーダルを開かなくても週カードに表示できるよう
  // 事前に読み込む（1KRあたり最大6週分・件数は小さいのでまとめて発火してよい）
  useEffect(() => {
    for (const card of weekCards) {
      if (card.existing) ensureWeekTasksLoaded(card.existing.id);
    }
  }, [weekCards, ensureWeekTasksLoaded]);
  const currentWeekIndex = useMemo(() => {
    if (monthStatus !== "current") return null;
    const found = segments.find(s => today >= s.weekStart && today <= new Date(s.weekEnd.getFullYear(), s.weekEnd.getMonth(), s.weekEnd.getDate(), 23, 59, 59));
    return found?.weekIndex ?? null;
  }, [segments, monthStatus, today]);

  // ===== これから（機械計算のみ。AIは使わない。Phase 3前半） =====
  const aheadFacts = useMemo(() => computeAheadFacts(segments, monthWeeks, today), [segments, monthWeeks, today]);
  // 週をまたいだ紐づけタスクをユニーク化（同じタスクが複数週に紐づいていても二重計上しない）
  const monthLinkedTasks = useMemo(() => {
    const ids = new Set<string>();
    for (const card of weekCards) {
      if (!card.existing) continue;
      for (const link of weekTasksByWeek[card.existing.id] ?? []) ids.add(link.task_id);
    }
    return Array.from(ids).map(id => tasks.find(t => t.id === id)).filter((t): t is Task => !!t);
  }, [weekCards, weekTasksByWeek, tasks]);
  const aheadTaskStats = useMemo(
    () => summarizeLinkedTaskStatus(monthLinkedTasks, tasks, taskDependencies),
    [monthLinkedTasks, tasks, taskDependencies],
  );
  const targetAndEvidenceSet = isTargetAndEvidenceSet(monthRecord?.target_and_evidence);

  // ===== Phase 4：月末の振り返り下書きの材料（機械計算のみ。過去月でも計算する＝D3） =====
  const reviewMaterial: ReviewMaterial | null = useMemo(() => {
    if (monthStatus === "future") return null; // 未来月は材料が無いため対象外
    return computeReviewMaterial(segments, monthWeeks, monthLinkedTasks, tasks, taskDependencies, today);
  }, [monthStatus, segments, monthWeeks, monthLinkedTasks, tasks, taskDependencies, today]);

  // ===== Phase 3後半：AI解析（見立て・週ごとの一手・捨てる候補・バンドのAI判定） =====
  // 文脈（personalOkrContext）・フィンガープリントは、当月タブ表示中に加えて過去月でも
  // 組み立てておく（🔴 D3：振り返りの下書きは過去月でも生成できる必要があるため）。
  // ただし「これから」のAI解析・AIパネルは引き続き当月限定にする（okrAiContext = 当月のみ。
  // handleRunOutlookのゲート＝okrAiContext必須はそのまま維持し、既存の挙動を変えない）。
  // 粒度は開いているKRタブ1本だけ（docs/dev/okr-redesign-plan.md §5-2）。
  // 🔴 AI呼び出し自体を自動発火する箇所ではない（下のhandleRunOutlook/handleGenerateReviewDraftが
  // 明示ボタンから呼ばれたときだけAIを呼ぶ。v3.55・Section 24 Step M）。
  const monthLabel = `${slot.monthStart.getMonth() + 1}月（${monthIndex}か月目）`;

  const personalOkrContext: PersonalOkrAiContextInput | null = useMemo(() => {
    if (monthStatus === "future") return null;
    return {
      krLabel: kr.label,
      krKindLabel: groupKrTitle,
      category: kr.category ?? null,
      activity: kr.activity ?? null,
      strengthRole: kr.strength_role ?? null,
      weaknessRole: kr.weakness_role ?? null,
      criteria: kr.criteria ?? null,
      supplement: kr.supplement ?? null,
      monthLabel,
      positioning: monthRecord?.positioning ?? null,
      activities: monthRecord?.activities ?? null,
      targetAndEvidence: monthRecord?.target_and_evidence ?? null,
      risks: monthRecord?.risks ?? null,
      bandTarget: monthRecord?.band_target ?? null,
      weeks: weekCards.map(c => ({
        label: `W${c.weekIndex}`,
        goalState: c.existing?.goal_state ?? null,
        selfRating: c.existing?.self_rating ?? null,
      })),
      taskSummary: { linkedTaskCount: monthLinkedTasks.length, ...aheadTaskStats },
      // 直近3件・各300字まで（🔴入力を絞る。生データを大量に渡さない）
      recentMemos: memos.slice(0, 3).map(m => m.body.slice(0, 300)),
    };
  }, [monthStatus, kr, groupKrTitle, monthLabel, monthRecord, weekCards, monthLinkedTasks, aheadTaskStats, memos]);

  // 🔴「これから」のAI解析・AIパネルは当月限定のまま（既存の挙動を変えない）。
  // 振り返りの下書き（過去月も対象）は personalOkrContext を直接使う（下記JSX参照）。
  const okrAiContext = monthStatus === "current" ? personalOkrContext : null;

  useEffect(() => { onAiContext?.(okrAiContext); }, [okrAiContext, onAiContext]);

  // フィンガープリント：対象KRに紐づくタスクのupdated_atの最大値／週の目標状態とself_rating／
  // 月次計画のimported_at（無ければupdated_at）／メモの最終updated_at／現在の週番号（§5-2）。
  // 🔴 monthStatus==="future"以外（過去月も含む）で計算する：振り返りの下書き（D3）が過去月でも
  // fingerprintを必要とするため。「これから」のAI解析はokrAiContext（当月限定）でゲートされて
  // いるため、この変更による既存挙動への影響は無い（過去月ではokrAiContextがnullのまま）。
  const fingerprint = useMemo(() => {
    if (monthStatus === "future") return null;
    const maxLinkedTaskUpdatedAt = monthLinkedTasks.reduce<string | null>((max, t) => {
      const u = t.updated_at ? String(t.updated_at) : null;
      if (!u) return max;
      return !max || u > max ? u : max;
    }, null);
    const lastMemoUpdatedAt = memos.reduce<string | null>((max, m) => {
      const u = m.updated_at ?? m.created_at ?? null;
      if (!u) return max;
      return !max || u > max ? u : max;
    }, null);
    return computeOutlookInputFingerprint({
      maxLinkedTaskUpdatedAt,
      weeks: weekCards.map(c => ({
        weekIndex: c.weekIndex,
        goalState: c.existing?.goal_state ?? null,
        selfRating: c.existing?.self_rating ?? null,
      })),
      monthPlanTimestamp: resolveMonthPlanTimestamp(monthRecord?.imported_at, monthRecord?.updated_at),
      lastMemoUpdatedAt,
      currentWeekNumber: currentWeekIndex ?? 1,
    });
  }, [monthStatus, monthLinkedTasks, memos, weekCards, monthRecord, currentWeekIndex]);

  const outlookKeyStr = `${kr.id}::${monthStr}`;
  const outlookRow = outlookByKrMonth[outlookKeyStr];
  const outlookAnalyzing = outlookAnalyzingKeys.has(outlookKeyStr);
  const outlookError = outlookErrorByKey[outlookKeyStr] ?? null;

  // 🔴 AI呼び出し自体はここでは発火しない（v3.55・山本さんの決定。KR切替のたびにAI呼び出しが
  // 走り実用に耐えなかったため）。保存済みの解析結果（personal_kr_outlooks）の読み込みだけを
  // 自動で行う（ensureOutlookLoaded＝DBを1回読むだけでゼロトークン。前回の見立てが消えて
  // 見えるのは困るため、これは自動のまま）。機械計算分はこのコンポーネントの他の部分が
  // 即時描画済み。
  useEffect(() => {
    if (readOnly || monthStatus !== "current") return; // 🔴🔴 サンプルKRのidは実DBに存在しないため問い合わせない
    ensureOutlookLoaded(kr.id, monthStr);
  }, [readOnly, monthStatus, kr.id, monthStr, ensureOutlookLoaded]);

  // 明示ボタン（AheadBlock.tsx）1つで「未解析なら見立てを出す／解析済みなら再解析する」の
  // 両方を担う。既存の解析結果が無い（outlookRow が null/undefined）ときはforceを付けない
  // （キャッシュが無いのでどのみちAIを呼ぶ）。既にある場合はforce:trueで、fingerprintが
  // 一致していても必ず呼ぶ（＝これまでの「再解析」ボタンと同じ挙動）。
  const handleRunOutlook = () => {
    if (readOnly || !okrAiContext || fingerprint == null) return; // 🔴🔴 サンプルKRのidは実DBに存在しないため呼ばせない
    onRunOutlookAnalysis({ personalKrId: kr.id, month: monthStr, fingerprint, context: okrAiContext, force: outlookRow != null });
  };

  // ===== Phase 4：月末の振り返り下書き（過去月でも生成できる。D3） =====
  const [reviewDraftModalOpen, setReviewDraftModalOpen] = useState(false);
  const reviewDraftKeyStr = `${kr.id}::${monthStr}`;
  const reviewDraftRow = reviewDraftByKrMonth[reviewDraftKeyStr];
  const reviewDraftAnalyzing = reviewDraftAnalyzingKeys.has(reviewDraftKeyStr);
  const reviewDraftError = reviewDraftErrorByKey[reviewDraftKeyStr] ?? null;

  const handleEnsureReviewDraftLoaded = useCallback(() => {
    if (readOnly) return; // 🔴🔴 サンプルKRのidは実DBに存在しないため問い合わせない
    ensureReviewDraftLoaded(kr.id, monthStr);
  }, [readOnly, kr.id, monthStr, ensureReviewDraftLoaded]);

  const handleGenerateReviewDraft = (force: boolean) => {
    if (readOnly || !personalOkrContext || !reviewMaterial || fingerprint == null) return; // 🔴🔴 未来月・サンプルでは呼ばせない
    onRunReviewDraft({ personalKrId: kr.id, month: monthStr, fingerprint, context: personalOkrContext, material: reviewMaterial, force });
  };

  const handleSaveReviewDraftEdit = (editedText: string) =>
    onSaveReviewDraftEdit({ personalKrId: kr.id, month: monthStr, editedText });

  // band_override（人が決めた値）の保存。エラー表示はAheadBlock側で行う（呼び出し元でthrowをそのまま伝える）。
  const handleSetBandOverride = async (value: PersonalKrBand | null) => {
    if (readOnly) return; // 🔴🔴 サンプル表示中は保存経路に入らせない
    const now = new Date().toISOString();
    const month: PersonalKrMonth = monthRecord
      ? { ...monthRecord, band_override: value, band_override_by: value ? currentUser.id : null, band_override_at: value ? now : null }
      : {
          id: uuidv4(), personal_kr_id: kr.id, month: monthStr, month_index: monthIndex,
          positioning: null, activities: null, target_and_evidence: null, risks: null,
          band_target: null, band_override: value, band_override_by: value ? currentUser.id : null,
          band_override_at: value ? now : null,
          is_deleted: false, created_at: now, updated_by: currentUser.id,
        };
    await onSaveMonth(month, monthRecord?.updated_at);
  };

  const ensureWeek = useCallback(async (weekIndex: number, weekStartStr: string, weekEndStr: string): Promise<PersonalKrWeek> => {
    const found = weeks.find(w => w.week_index === weekIndex && w.month === monthStr && !w.is_deleted);
    if (found) return found;
    if (readOnly) {
      // 🔴🔴 サンプル表示中は新しい週レコードを作らせない（UI側はeditable:falseで既に
      // 到達不能だが、二重の防御として例外を投げて呼び出し元のcatchでエラー表示に留める）。
      throw new Error("サンプル表示中は週の目標状態を編集できません。");
    }
    const now = new Date().toISOString();
    const week: PersonalKrWeek = {
      id: uuidv4(), personal_kr_id: kr.id, month: monthStr, week_index: weekIndex,
      week_start: weekStartStr, week_end: weekEndStr, goal_state: null, self_rating: null,
      rated_at: null, note: null, is_deleted: false, created_at: now, updated_by: currentUser.id,
    };
    await onSaveWeek(week);
    return week;
  }, [weeks, monthStr, kr.id, currentUser.id, onSaveWeek, readOnly]);

  const [linker, setLinker] = useState<LinkerTarget | null>(null);
  const [weekActionError, setWeekActionError] = useState<string | null>(null);
  // 🔴 KR切替時にkeyremountが無くなったため、開いていた週リンクモーダル・エラー表示が
  // 前のKRのものとして残らないよう明示的に閉じる。
  useEffect(() => { setLinker(null); setWeekActionError(null); setReviewDraftModalOpen(false); }, [kr.id]);

  const handleOpenLinker = async (card: { weekIndex: number; weekStartStr: string; weekEndStr: string; existing: PersonalKrWeek | null }, label: string) => {
    setWeekActionError(null);
    try {
      const week = await ensureWeek(card.weekIndex, card.weekStartStr, card.weekEndStr);
      await ensureWeekTasksLoaded(week.id);
      setLinker({ weekIndex: card.weekIndex, weekStartStr: card.weekStartStr, weekEndStr: card.weekEndStr, week, label });
    } catch (e) {
      setWeekActionError(formatErrorForUser("週の準備に失敗しました", e));
    }
  };

  return (
    <div style={{ background: "var(--color-bg-secondary)", border: "1px solid var(--color-border-primary)", borderTop: "none", borderRadius: "0 0 var(--radius-md) var(--radius-md)", padding: "16px 20px 22px" }}>
      {/* 🔴🔴 サンプル表示中の明示（CLAUDE.md Section 24）。保存経路は呼び出し元
          （PersonalOkrView.tsx）がno-opに差し替えているため、これは案内表示のみの役割。 */}
      {readOnly && (
        <div style={{ marginBottom: "12px", fontSize: "11.5px", color: "var(--color-brand)", background: "var(--color-brand-light)", border: "1px solid var(--color-brand-border)", borderRadius: "var(--radius-md)", padding: "8px 12px", lineHeight: 1.6 }}>
          🔍 これはツアー用のサンプル表示です。内容は保存されません。ツアーを終えると元の画面に戻ります。
        </div>
      )}
      {/* 月の切替バー：月の選択自体は「対象期」行（PersonalOkrView.tsx）に一元化した。
          ここは選択中の期・月と、その月の状態（確定済み／未来）だけを表示する
          （二重に月タブを持たない。CLAUDE.md Section 24 Step J・2026-08-12）。 */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", paddingBottom: "14px", borderBottom: "1px dotted var(--color-border-primary)" }}>
        <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--color-text-primary)" }}>
          {kr.fiscal_year}年 {kr.quarter}・{slot.monthStart.getMonth() + 1}月
          {monthStatus === "past" && <span style={{ fontWeight: 400, color: "var(--color-text-tertiary)" }}>（確定済み・読み取り専用）</span>}
          {monthStatus === "future" && <span style={{ fontWeight: 400, color: "var(--color-text-tertiary)" }}>（未来月）</span>}
        </span>
        <span style={{ flex: 1 }} />
        {kr.source_label && (
          <span
            title={`Kintoneが正本です。この内容はアプリ上でも編集できますが、評価の確定はKintone側で行います。${kr.imported_at ? `（${kr.imported_at.slice(0, 10)}取込）` : ""}`}
            style={{ fontSize: "10px", color: "var(--color-text-tertiary)", background: "var(--color-bg-tertiary)", borderRadius: "var(--radius-full)", padding: "3px 9px", whiteSpace: "nowrap" }}
          >📥 {kr.source_label}</span>
        )}
        {/* 🔴 過去月でも生成できる（D3）。未来月には材料が無いため出さない。サンプル表示中は
            サンプルKRのidが実DBに存在しないため出さない（onEditKrと同じ扱い）。 */}
        {!readOnly && monthStatus !== "future" && (
          <button
            onClick={() => setReviewDraftModalOpen(true)}
            style={{ fontFamily: "inherit", fontSize: "11px", cursor: "pointer", padding: "4px 10px", background: "transparent", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-sm)", color: "var(--color-text-secondary)" }}
          >
            📝 振り返りの下書き
          </button>
        )}
        <button
          onClick={readOnly ? undefined : onEditKr}
          disabled={readOnly}
          title={readOnly ? "サンプル表示中は編集できません" : undefined}
          style={{ fontFamily: "inherit", fontSize: "11px", cursor: readOnly ? "default" : "pointer", padding: "4px 10px", background: "transparent", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-sm)", color: "var(--color-text-secondary)", opacity: readOnly ? 0.5 : 1 }}
        >
          ✏️ このKRを編集
        </button>
      </div>

      {!readOnly && reviewDraftModalOpen && reviewMaterial && (
        <PersonalOkrReviewDraftModal
          krLabel={kr.label}
          monthLabel={`${kr.fiscal_year}年${slot.monthStart.getMonth() + 1}月`}
          material={reviewMaterial}
          draftRow={reviewDraftRow}
          analyzing={reviewDraftAnalyzing}
          error={reviewDraftError}
          onEnsureLoaded={handleEnsureReviewDraftLoaded}
          onGenerate={handleGenerateReviewDraft}
          onSaveEdit={handleSaveReviewDraftEdit}
          onClose={() => setReviewDraftModalOpen(false)}
        />
      )}

      {loadingDetail ? (
        <div style={{ padding: "40px 0", textAlign: "center", color: "var(--color-text-tertiary)", fontSize: "12px" }}>読み込み中…</div>
      ) : monthStatus === "future" ? (
        <div style={{ ...cardStyle, marginTop: "16px", color: "var(--color-text-tertiary)", fontSize: "12.5px" }}>
          {slot.monthStart.getMonth() + 1}月の計画がまだありません。Kintone側で月初に立てる計画（Phase 2以降で取込予定）を、現時点では手入力できません。月が来たらこのタブが編集可能になります。
        </div>
      ) : (
        <>
          {/* このKRの内容（折りたたみ・既定は閉じる） */}
          <details style={{ border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", background: "var(--color-bg-primary)", marginTop: "16px" }}>
            <summary style={{ cursor: "pointer", listStyle: "none", padding: "10px 14px", fontSize: "11.5px", fontWeight: 700, color: "var(--color-text-secondary)" }}>
              このKRの内容（{groupKrTitle}）
            </summary>
            <div style={{ padding: "0 14px 14px", display: "grid", gridTemplateColumns: "150px 1fr", gap: "9px 12px", fontSize: "12.5px" }}>
              <div style={{ fontWeight: 700, color: "var(--color-text-tertiary)", fontSize: "10.5px" }}>●対象業務カテゴリ</div>
              <div style={{ color: "var(--color-text-secondary)" }}>{kr.category || "（未記入）"}</div>
              <div style={{ fontWeight: 700, color: "var(--color-text-tertiary)", fontSize: "10.5px" }}>●実施内容</div>
              <div style={{ color: "var(--color-text-secondary)" }}>{kr.activity || "（未記入）"}</div>
              <div style={{ fontWeight: 700, color: "var(--color-text-tertiary)", fontSize: "10.5px" }}>●得意領域の強化：（役割）</div>
              <div style={{ color: "var(--color-text-secondary)" }}>{kr.strength_role || "（未記入）"}</div>
              <div style={{ fontWeight: 700, color: "var(--color-text-tertiary)", fontSize: "10.5px" }}>●苦手領域の克服：（役割）</div>
              <div style={{ color: "var(--color-text-secondary)" }}>{kr.weakness_role || "（未記入）"}</div>
              <div style={{ fontWeight: 700, color: "var(--color-text-tertiary)", fontSize: "10.5px" }}>●達成基準</div>
              <div style={{ color: "var(--color-text-secondary)" }}>{kr.criteria || "（未記入）"}</div>
              <div style={{ fontWeight: 700, color: "var(--color-text-tertiary)", fontSize: "10.5px" }}>●補足</div>
              <div style={{ color: "var(--color-text-secondary)" }}>{kr.supplement || "（未記入）"}</div>
            </div>
          </details>

          {/* 今月の計画 */}
          <div data-tour-id="okr-month-plan" style={{ marginTop: "20px" }}>
            <div style={sectionHeadStyle}>
              <span>今月の計画</span><span style={ruleStyle} />
              <span>{monthStatus === "past" ? "確定済み・読み取り専用" : monthRecord?.source_label ? "Kintone取込（編集可・正本はKintone）" : "手入力（KintoneからのPDF取込も可）"}</span>
            </div>
            {monthEditable && !monthRecord && (
              <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", background: "var(--color-bg-secondary)", border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)", padding: "8px 12px", marginBottom: "8px", lineHeight: 1.6 }}>
                {slot.monthStart.getMonth() + 1}月の計画はKintoneにまだ無いようです。Kintone側の入力を待たず、ここに直接入力して保存できます（後でKintoneから取込むと上書きされます）。
              </div>
            )}
            {monthError && <div style={{ fontSize: "12px", color: "var(--color-text-danger)", marginBottom: "8px" }}>{monthError}</div>}
            <div style={cardStyle}>
              {(["positioning", "activities", "targetAndEvidence", "risks"] as const).map(field => {
                const label = field === "positioning" ? "位置づけ" : field === "activities" ? "当月に取り組む内容" : field === "targetAndEvidence" ? "当月末の達成目標と、その証拠" : "リスクと依存関係";
                const value = field === "positioning" ? positioning : field === "activities" ? activities : field === "targetAndEvidence" ? targetAndEvidence : risks;
                const setter = field === "positioning" ? setPositioning : field === "activities" ? setActivities : field === "targetAndEvidence" ? setTargetAndEvidence : setRisks;
                return (
                  <div key={field} style={{ marginBottom: "12px" }}>
                    <div style={{ fontSize: "10.5px", fontWeight: 700, color: "var(--color-text-tertiary)", marginBottom: "4px" }}>{label}</div>
                    {monthEditable ? (
                      <textarea value={value} onChange={e => setter(e.target.value)} style={textareaStyle} />
                    ) : (
                      <div style={{ fontSize: "12.5px", color: "var(--color-text-secondary)", lineHeight: 1.6 }}>{value || "（記録なし）"}</div>
                    )}
                  </div>
                );
              })}
              <div>
                <div style={{ fontSize: "10.5px", fontWeight: 700, color: "var(--color-text-tertiary)", marginBottom: "4px" }}>当月末 達成度バンド</div>
                <div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
                  {BAND_VALUES.map(b => {
                    const disabled = isBandDisabled(b) || !monthEditable;
                    const on = bandTarget === b;
                    return (
                      <button
                        key={b}
                        onClick={() => monthEditable && !isBandDisabled(b) && setBandTarget(on ? null : b)}
                        disabled={disabled}
                        title={BAND_LABELS[b]}
                        style={{
                          fontFamily: "inherit", fontSize: "10.5px", padding: "3px 9px", borderRadius: "var(--radius-sm)",
                          border: `1px solid ${on ? "var(--color-brand-border)" : "var(--color-border-primary)"}`,
                          background: on ? "var(--color-brand-light)" : "var(--color-bg-tertiary)",
                          color: on ? "var(--color-brand)" : "var(--color-text-tertiary)",
                          fontWeight: on ? 700 : 400,
                          textDecoration: isBandDisabled(b) ? "line-through" : "none",
                          opacity: isBandDisabled(b) ? 0.45 : 1,
                          cursor: disabled ? "default" : "pointer",
                        }}
                      >{b} {BAND_LABELS[b]}</button>
                    );
                  })}
                </div>
              </div>
              {monthEditable && (
                <button onClick={handleSaveMonthPlan} disabled={savingMonth} style={{ marginTop: "12px", fontSize: "12px", fontWeight: 700, padding: "7px 16px", background: "var(--color-brand)", color: "#fff", border: "none", borderRadius: "var(--radius-md)", cursor: "pointer" }}>
                  {savingMonth ? "保存中…" : "今月の計画を保存"}
                </button>
              )}
            </div>
          </div>

          {/* 週の目標状態 */}
          <div data-tour-id="okr-week-cards" style={{ marginTop: "20px" }}>
            <div style={sectionHeadStyle}><span>週の目標状態</span><span style={ruleStyle} /><span>★アプリで設定（Kintoneに無い層）</span></div>
            {weekActionError && <div style={{ fontSize: "12px", color: "var(--color-text-danger)", marginBottom: "8px" }}>{weekActionError}</div>}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "8px" }}>
              {weekCards.map(card => {
                const linkedTasks = linkedTasksByWeekIndex[card.weekIndex] ?? [];
                return (
                  <WeekCard
                    key={card.weekIndex}
                    label={`W${card.weekIndex}`}
                    weekStartStr={card.weekStartStr}
                    weekEndStr={card.weekEndStr}
                    goalState={card.existing?.goal_state ?? null}
                    selfRating={card.existing?.self_rating ?? null}
                    editable={monthEditable}
                    isCurrentWeek={currentWeekIndex === card.weekIndex}
                    linkedTasks={linkedTasks}
                    allTasks={tasks}
                    taskDependencies={taskDependencies}
                    onSaveGoal={async text => {
                      const week = await ensureWeek(card.weekIndex, card.weekStartStr, card.weekEndStr);
                      await onSaveWeek({ ...week, goal_state: text || null }, week.updated_at);
                    }}
                    onSetRating={async (rating: WeekSelfRating) => {
                      const week = await ensureWeek(card.weekIndex, card.weekStartStr, card.weekEndStr);
                      const now = new Date().toISOString();
                      await onSaveWeek({ ...week, self_rating: rating, rated_at: rating ? now : null }, week.updated_at);
                    }}
                    onOpenLinker={() => handleOpenLinker(card, `W${card.weekIndex}`)}
                  />
                );
              })}
            </div>
            <p style={{ fontSize: "10.5px", color: "var(--color-text-tertiary)", marginTop: "8px" }}>
              ◯達成／△一部／✕未達を自分で付けます。評価すると週の色が変わります。もう一度押すと未評価に戻せます。
            </p>
          </div>

          {/* これから（当月のみ・機械計算＋AI解析。Phase 3後半） */}
          {monthStatus === "current" && (
            <AheadBlock
              facts={aheadFacts}
              taskStats={aheadTaskStats}
              targetAndEvidenceSet={targetAndEvidenceSet}
              bandTarget={monthRecord?.band_target ?? null}
              bandOverride={monthRecord?.band_override ?? null}
              editable={monthEditable}
              onSetOverride={handleSetBandOverride}
              outlookRow={outlookRow}
              analyzing={outlookAnalyzing}
              outlookError={outlookError}
              canReanalyze={!readOnly && !!okrAiContext}
              onReanalyze={handleRunOutlook}
            />
          )}

          {/* 迷ったらAIに聞く（当月のみ・AI解析と同じ文脈を使う） */}
          {/* 🔴🔴 サンプル表示中は呼び出し元がonOpenAiPanelをundefinedにするため通常は
              到達しないが、!readOnlyでも明示的にガードする（二重の防御）。 */}
          {!readOnly && monthStatus === "current" && onOpenAiPanel && (
            <div style={{ marginTop: "14px", padding: "13px 15px", borderRadius: "var(--radius-md)", background: "var(--color-bg-purple, var(--color-brand-light))", border: "1px solid var(--color-brand-border)", display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: "180px" }}>
                <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--color-text-primary)" }}>迷ったらAIに聞く</div>
                <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginTop: "2px" }}>
                  このKRの内容・今月の計画・週の目標状態と自己評価・タスクの実績・メモを文脈として持った状態で始まります。
                </div>
              </div>
              <button
                onClick={onOpenAiPanel}
                style={{ fontFamily: "inherit", fontSize: "12px", fontWeight: 700, padding: "7px 16px", background: "var(--color-brand)", color: "#fff", border: "none", borderRadius: "var(--radius-md)", cursor: "pointer", whiteSpace: "nowrap" }}
              >AIパネルを開く</button>
            </div>
          )}
        </>
      )}

      {/* メモ（KR単位・追記型。月に関係なく常時表示） */}
      <MemoSection kr={kr} currentUser={currentUser} memos={memos} onSaveMemo={onSaveMemo} readOnly={readOnly} />

      {linker && (
        <WeekTaskLinkModal
          weekLabel={linker.label}
          weekStart={linker.weekStartStr}
          weekEnd={linker.weekEndStr}
          tasks={tasks}
          todos={todos}
          currentMemberId={currentUser.id}
          taskForceId={kr.task_force_id}
          linkedTaskIds={(weekTasksByWeek[linker.week?.id ?? ""] ?? []).map(l => l.task_id)}
          onLink={async taskId => { if (linker.week) await onLinkWeekTask(linker.week.id, taskId); }}
          onUnlink={async taskId => { if (linker.week) await onUnlinkWeekTask(linker.week.id, taskId); }}
          onClose={() => setLinker(null)}
        />
      )}
    </div>
  );
}

function MemoSection({ kr, currentUser, memos, onSaveMemo, readOnly = false }: {
  kr: PersonalKr; currentUser: Member; memos: PersonalKrMemo[];
  onSaveMemo: (memo: PersonalKrMemo, expectedUpdatedAt?: string) => Promise<void>;
  readOnly?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 🔴 PersonalKrPanelがkey={selectedKr.id}で丸ごと作り直されなくなったため（v3.55）、
  // このKR専用の下書き（未送信のメモ本文）がKR切替後も残らないよう明示的にクリアする。
  useEffect(() => { setDraft(""); setError(null); }, [kr.id]);

  const handleAdd = async () => {
    if (readOnly || !draft.trim()) return; // 🔴🔴 サンプル表示中は保存経路に入らせない
    setSaving(true);
    setError(null);
    const now = new Date().toISOString();
    try {
      await onSaveMemo({
        id: uuidv4(), personal_kr_id: kr.id, member_id: currentUser.id, body: draft.trim(),
        is_deleted: false, created_at: now, updated_by: currentUser.id,
      });
      setDraft("");
    } catch (e) {
      setError(formatErrorForUser("メモの保存に失敗しました", e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ marginTop: "20px" }}>
      <div style={sectionHeadStyle}><span>メモ</span><span style={ruleStyle} /><span>このKR専用・自分だけが見えます</span></div>
      {error && <div style={{ fontSize: "12px", color: "var(--color-text-danger)", marginBottom: "8px" }}>{error}</div>}
      <textarea
        value={draft}
        onChange={e => setDraft(e.target.value)}
        placeholder={readOnly ? "サンプル表示中はメモを追加できません" : "気づいたこと、迷っていること、次に確かめたいこと。Kintoneに書く前の下書きにも使えます。"}
        readOnly={readOnly}
        style={{ ...textareaStyle, minHeight: "72px", opacity: readOnly ? 0.6 : 1 }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "7px" }}>
        <button onClick={handleAdd} disabled={readOnly || saving || !draft.trim()} style={{ fontSize: "12px", fontWeight: 700, padding: "6px 14px", background: "var(--color-brand)", color: "#fff", border: "none", borderRadius: "var(--radius-md)", cursor: readOnly ? "default" : "pointer", opacity: readOnly ? 0.6 : 1 }}>
          {saving ? "保存中…" : "追加"}
        </button>
      </div>
      {memos.length > 0 && (
        <div style={{ marginTop: "10px", display: "flex", flexDirection: "column", gap: "1px" }}>
          {memos.map(m => (
            <div key={m.id} style={{ display: "grid", gridTemplateColumns: "78px 1fr", gap: "12px", padding: "9px 12px", background: "var(--color-bg-primary)", borderRadius: "var(--radius-sm)", fontSize: "12px" }}>
              <span style={{ fontSize: "10.5px", color: "var(--color-text-tertiary)" }}>{(m.created_at ?? "").slice(0, 10)}</span>
              <span style={{ color: "var(--color-text-secondary)", whiteSpace: "pre-wrap" }}>{m.body}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
