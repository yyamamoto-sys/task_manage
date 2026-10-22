// src/stores/personalOkrUiStore.ts
//
// 【設計意図】
// OKRモード「自分」タブを開いたときだけ読み込む専用の状態ストア（zustand）。
// appStore.ts（全アプリデータの単一真実）には一切組み込まない——OKRモードの「自分」タブを
// 開かない人にこのテーブル群へのクエリを一切発生させないため（CLAUDE.md Section 19）。
// このファイル自体も src/components/okr/personal/PersonalOkrView.tsx
// （React.lazyで分割された「自分」タブのチャンク）からのみ import される。つまり
// create() が実行されるタイミングも「自分」タブを実際に開いた瞬間まで遅延する
// （lib/supabase/personalOkrStore.ts の低レベルCRUD＝flat関数群を、ここで初めて呼ぶ）。
//
// 【zustandを選んだ理由（appStoreとは別に新設する・appStoreには足さない）】
// KRタブ・月切替バー・今月の計画カード・週カード・メモ欄・KR編集モーダルの6コンポーネントが
// 同じ personalKrs/months/weeks/memos を読み書きする。親コンポーネントが素のuseStateで
// 全状態を持つと、1つの週を評価するだけで無関係な他コンポーネントまで再レンダーされ、
// krIdごとの月/週/メモのキャッシュ管理（「このKRはまだ詳細を読んでいないか」の判定等）を
// 各コンポーネントに重複させることになる。データ量自体は極小（1人あたり四半期KRは
// 最大でも十数本・週は最大でもKR×6週間）なのでzustandのオーバーヘッドは無視できる一方、
// 「krIdごとにキャッシュする・楽観更新する」というロジックを1箇所に集約できる利点の方が
// 大きいと判断した。lib/supabase/personalOkrStore.ts（低レベルCRUD）とこのファイル
// （状態の保持・reactivity）を分離する方針は同ファイルの冒頭コメントに合わせている。

import { create } from "zustand";
import {
  fetchPersonalKrs, upsertPersonalKr, softDeletePersonalKr,
  fetchPersonalKrMonths, fetchPersonalKrMonthsForKrs, upsertPersonalKrMonth,
  fetchPersonalKrWeeks, upsertPersonalKrWeek,
  fetchPersonalKrWeekTasks, insertPersonalKrWeekTask, deletePersonalKrWeekTask,
  fetchPersonalKrMemos, upsertPersonalKrMemo, softDeletePersonalKrMemo,
  fetchLatestPersonalKrOutlook, insertPersonalKrOutlook,
  fetchLatestPersonalKrReviewDraft, insertPersonalKrReviewDraft,
  fetchPersonalPeriodReviews, upsertPersonalPeriodReview,
  probeActualActivitiesColumn,
} from "../lib/supabase/personalOkrStore";
import type { ActualActivitiesAvailability } from "../lib/personalOkr/actualActivitiesAvailability";
import { analyzePersonalKrOutlook } from "../lib/ai/personalOkrOutlookExtractor";
import { generatePersonalKrReviewDraft } from "../lib/ai/personalOkrReviewDraftExtractor";
import { runPersonalKrOutlookAnalysis } from "../lib/personalOkr/outlookRunner";
import { runPersonalKrReviewDraft } from "../lib/personalOkr/reviewDraftRunner";
import { isGuestMode } from "../lib/guestMode";
import { onAuthStateChange } from "../lib/supabase/auth";
import { mergeFetchedRows } from "../lib/personalOkr/fetchMerge";
import { decideAuthReset } from "../lib/personalOkr/authReset";
import { formatErrorForUser } from "../lib/errorMessage";
import type { PersonalOkrAiContextInput } from "../lib/personalOkr/personalOkrAiContext";
import type { ReviewMaterial } from "../lib/personalOkr/reviewMaterial";
import type {
  PersonalKr, PersonalKrMonth, PersonalKrWeek, PersonalKrWeekTask, PersonalKrMemo, PersonalKrOutlook,
  PersonalKrReviewDraft, PersonalPeriodReview,
} from "../lib/localData/types";

// 【ゲスト（サンプル閲覧）分岐・2026-08-12】
// 🔴 ゲストはSupabaseに一切接続しない（CLAUDE.md Section 23の絶対原則）。client.ts の
// Proxyを緩めるのではなく、ここ（呼び出し元）で「そもそも呼ばない」形にする——各アクションの
// 先頭で isGuestMode() を見て、Supabaseを呼ばずにサンプルデータ（src/lib/demo/
// personalOkrDataset.ts。動的importのみ）をstateに直接注入する。書き込み系アクション
// （saveKr/saveMonth/saveWeek/saveMemo/linkWeekTask/unlinkWeekTask/deleteKr/deleteMemo）は
// isGuestMode()のときDB呼び出しをスキップし、state更新だけを行う（メモリ上でのみ成立し、
// リロードで消える）。AI呼び出し（runOutlookAnalysis内のanalyze()）はinvokeAI.tsが既に
// ゲストを開放しているため素通しするが、その結果のDB書き込み（insertPersonalKrOutlook）は
// スキップする（🔴 personal_kr_outlooksには書けない。メモリ保持のみ）。
// Phase 4（runReviewDraft）も同じ方針：AI生成はゲストでも素通しするが
// personal_kr_review_draftsへのinsertはスキップし、メモリ上でのみ成立させる。
// 🔴 「編集を保存」はW2（2026-08-26）でsaveMonth（月のreview_text）経由に変わったため、
// ここでのゲスト分岐は不要（saveMonth自体が既にゲスト分岐を持つ）。

/** outlookByKrMonth等のキー形式（personalKrId・monthの組で一意）。Phase 3後半で追加 */
function outlookKey(personalKrId: string, month: string): string {
  return `${personalKrId}::${month}`;
}

/** reviewDraftByKrMonth等のキー形式（personalKrId・monthの組で一意）。Phase 4で追加 */
function reviewDraftKey(personalKrId: string, month: string): string {
  return `${personalKrId}::${month}`;
}

/** id一致するものを置き換え・無ければ末尾に追加する（guest/実データ両方の保存アクションで共有する） */
function upsertById<T extends { id: string }>(list: T[], next: T): T[] {
  return list.some(x => x.id === next.id) ? list.map(x => (x.id === next.id ? next : x)) : [...list, next];
}

// 【ユーザー切替・取得競合の対策】
// epoch は resetPersonalOkrUiStore のたびに進む。非同期の取得・AI呼び出しは開始時の epoch を控え、
// 戻ってきたときに epoch が変わっていれば結果を捨てる（前のユーザーの応答が新しい状態を汚さない）。
// inflight は同じ対象の取得の多重起動を1本にまとめる（別KRの取得が間に入っても重複しない）。
let epoch = 0;
const inflight = new Map<string, Promise<void>>();
function dedupe(key: string, run: () => Promise<void>): Promise<void> {
  const existing = inflight.get(key);
  if (existing) return existing;
  const p: Promise<void> = run().finally(() => { if (inflight.get(key) === p) inflight.delete(key); });
  inflight.set(key, p);
  return p;
}
function without(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  next.delete(id);
  return next;
}
function omitKey<T>(o: Record<string, T>, k: string): Record<string, T> {
  const c = { ...o };
  delete c[k];
  return c;
}

/**
 * 紐づけの追加・解除の前に、その週の紐づけ一覧を取得済みにする。取得が失敗したまま
 * 空の一覧へ追加すると、実際は紐づけがあるのに画面が「新しい1件だけ」になり、重複登録や
 * 誤った表示になる。取得できなければ操作を中止する。
 */
async function requireWeekTasksLoaded(
  get: () => { weekTasksByWeek: Record<string, PersonalKrWeekTask[]>; ensureWeekTasksLoaded: (weekId: string) => Promise<void> },
  weekId: string,
): Promise<void> {
  await get().ensureWeekTasksLoaded(weekId);
  if (!get().weekTasksByWeek[weekId]) {
    throw new Error("この週の紐づけ一覧を読み込めなかったため、操作を中止しました。時間をおいてもう一度お試しください。");
  }
}

interface PersonalOkrUiState {
  krs: PersonalKr[];
  krsLoaded: boolean;
  krsLoading: boolean;
  krsError: string | null;

  monthsByKr: Record<string, PersonalKrMonth[]>;
  weeksByKr: Record<string, PersonalKrWeek[]>;
  memosByKr: Record<string, PersonalKrMemo[]>;
  weekTasksByWeek: Record<string, PersonalKrWeekTask[]>;
  detailLoadedKrIds: Set<string>;
  /** 詳細を取得中のKR id（複数KRの同時取得でも互いに上書きしない） */
  detailLoadingKrIds: Set<string>;
  detailError: string | null;

  loadKrs: () => Promise<void>;
  ensureKrDetailLoaded: (krId: string) => Promise<void>;
  ensureWeekTasksLoaded: (weekId: string) => Promise<void>;

  // ===== 対象期の全KRの月レコード先読み（v3.106） =====
  // 🔴 KR単位のensureKrDetailLoadedは「そのKRのタブを開いたときだけ」しか月レコードを
  // 読まないため、未訪問のKRはウェイト合計の警告（PersonalOkrView.tsx）が四半期共通値へ
  // フォールバックしてしまう不具合の原因になっていた。ensurePeriodMonthsLoadedは
  // 「表示中の対象期の全KR」ぶんを1クエリでまとめて先読みする（KR一覧を読み終えた時点・
  // 対象期を切り替えた時点で呼ぶ）。週・週タスクは先読みしない（従来どおり）。
  /** 先読み中（fetchPersonalKrMonthsForKrs呼び出し中）のKR id集合。同時多重呼び出しの防止用。 */
  monthsPreloadPendingKrIds: Set<string>;
  ensurePeriodMonthsLoaded: (krIds: string[]) => Promise<void>;

  saveKr: (kr: PersonalKr, expectedUpdatedAt?: string) => Promise<void>;
  deleteKr: (id: string, deletedBy: string) => Promise<void>;

  saveMonth: (month: PersonalKrMonth, expectedUpdatedAt?: string) => Promise<void>;
  saveWeek: (week: PersonalKrWeek, expectedUpdatedAt?: string) => Promise<void>;

  saveMemo: (memo: PersonalKrMemo, expectedUpdatedAt?: string) => Promise<void>;
  deleteMemo: (id: string, personalKrId: string, deletedBy: string) => Promise<void>;

  linkWeekTask: (weekId: string, taskId: string) => Promise<void>;
  unlinkWeekTask: (weekId: string, taskId: string) => Promise<void>;

  // ===== Phase 3後半：AI解析の結果とキャッシュ（personal_kr_outlooks） =====
  /** `${personalKrId}::${month}` キー。undefined=未フェッチ／null=フェッチ済みだが該当行なし */
  outlookByKrMonth: Record<string, PersonalKrOutlook | null>;
  outlookFetchedKeys: Set<string>;
  outlookAnalyzingKeys: Set<string>;
  outlookErrorByKey: Record<string, string | null>;

  /** DBから直近の解析結果を1回だけ取得する（別端末・別セッションでも再解析されないための前提） */
  ensureOutlookLoaded: (personalKrId: string, month: string) => Promise<void>;
  /**
   * fingerprintが直近の保存値と一致していればAIを呼ばずキャッシュを使う（§5-2）。
   * force=trueなら一致していても必ず呼ぶ（「再解析」ボタン用）。
   */
  runOutlookAnalysis: (params: {
    personalKrId: string;
    month: string;
    fingerprint: string;
    context: PersonalOkrAiContextInput;
    force?: boolean;
  }) => Promise<void>;

  // ===== Phase 4：月末の振り返り下書き（personal_kr_review_drafts） =====
  /** `${personalKrId}::${month}` キー。undefined=未フェッチ／null=フェッチ済みだが該当行なし */
  reviewDraftByKrMonth: Record<string, PersonalKrReviewDraft | null>;
  reviewDraftFetchedKeys: Set<string>;
  reviewDraftAnalyzingKeys: Set<string>;
  reviewDraftErrorByKey: Record<string, string | null>;

  /** DBから直近の下書きを1回だけ取得する（過去月でも生成できるため月の状態は問わない） */
  ensureReviewDraftLoaded: (personalKrId: string, month: string) => Promise<void>;
  /**
   * fingerprintが直近の保存値と一致していればAIを呼ばずキャッシュを使う（D4）。
   * force=trueなら一致していても必ず呼ぶ（「再生成」ボタン用）。
   */
  runReviewDraft: (params: {
    personalKrId: string;
    month: string;
    fingerprint: string;
    context: PersonalOkrAiContextInput;
    material: ReviewMaterial;
    force?: boolean;
  }) => Promise<void>;
  // 🔴 W2（2026-08-26）：saveReviewDraftEditは廃止した。「編集を保存」は月のreview_text
  // （personal_kr_months）へ保存するようになり、personalOkrUiStore.saveMonthをそのまま使う
  // （PersonalKrPanel.tsxのhandleSaveReviewText参照）。edited_text列と既存データは
  // 読み取りフォールバック（旧方式で保存した人の救済）として残す。

  // ===== 「全体」タブ：月全体・四半期全体の振り返り（personal_period_reviews・v3.101） =====
  // 🔴 このテーブルはマイグレーション未適用の窓が生じうる（CLAUDE.md Section 24 Step Q・
  // 仕様書§W2）。loadPeriodReviewsが失敗してもperiodReviewsLoaded=trueで確定させ、
  // periodReviewsErrorにメッセージを積むだけに留める（krs等の既存stateには一切触れない
  // ＝この失敗がKRタブ側の動作に影響することはない）。
  periodReviews: PersonalPeriodReview[];
  periodReviewsLoaded: boolean;
  periodReviewsLoading: boolean;
  periodReviewsError: string | null;

  /** 自分の全期間ぶんの月全体・四半期全体の振り返りを1回だけ取得する（「全体」タブを開いたときに呼ぶ）。 */
  loadPeriodReviews: () => Promise<void>;
  savePeriodReview: (review: PersonalPeriodReview, expectedUpdatedAt?: string) => Promise<void>;

  // ===== 実施記録（actual_activities列。仕様書§W2・2026-08-27・v3.105） =====
  // 🔴 check_schema_health RPCは管理者限定のため使えない（一般メンバーには使えない代替として
  // 実データへのプローブで判定する。src/lib/supabase/personalOkrStore.ts参照）。
  actualActivitiesAvailable: ActualActivitiesAvailability;
  actualActivitiesChecking: boolean;
  /** OKRビューを開いたときに1回だけ呼ぶ（既に確定済み・確認中なら何もしない）。 */
  ensureActualActivitiesChecked: () => Promise<void>;
}

/** ストアの「データ」部分の初期値（アクション以外）。reset と初期化の両方がこれを使う。 */
function initialData() {
  return {
    krs: [] as PersonalKr[],
    krsLoaded: false,
    krsLoading: false,
    krsError: null as string | null,

    monthsByKr: {} as Record<string, PersonalKrMonth[]>,
    weeksByKr: {} as Record<string, PersonalKrWeek[]>,
    memosByKr: {} as Record<string, PersonalKrMemo[]>,
    weekTasksByWeek: {} as Record<string, PersonalKrWeekTask[]>,
    detailLoadedKrIds: new Set<string>(),
    detailLoadingKrIds: new Set<string>(),
    detailError: null as string | null,
    monthsPreloadPendingKrIds: new Set<string>(),

    outlookByKrMonth: {} as Record<string, PersonalKrOutlook | null>,
    outlookFetchedKeys: new Set<string>(),
    outlookAnalyzingKeys: new Set<string>(),
    outlookErrorByKey: {} as Record<string, string | null>,

    reviewDraftByKrMonth: {} as Record<string, PersonalKrReviewDraft | null>,
    reviewDraftFetchedKeys: new Set<string>(),
    reviewDraftAnalyzingKeys: new Set<string>(),
    reviewDraftErrorByKey: {} as Record<string, string | null>,

    periodReviews: [] as PersonalPeriodReview[],
    periodReviewsLoaded: false,
    periodReviewsLoading: false,
    periodReviewsError: null as string | null,

    actualActivitiesAvailable: "unknown" as ActualActivitiesAvailability,
    actualActivitiesChecking: false,
  };
}

export const usePersonalOkrUiStore = create<PersonalOkrUiState>((set, get) => ({
  ...initialData(),

  loadKrs: async () => {
    if (get().krsLoading || get().krsLoaded) return;
    const ep = epoch;
    set({ krsLoading: true, krsError: null });
    // 🔴 ゲストはSupabaseに一切接続しない（冒頭コメント参照）。demo/personalOkrDataset.ts
    // （動的importのみ）からサンプルデータを直接stateへ注入し、全KRを「詳細読み込み済み」
    // として扱う（データ量が極小のため遅延読み込みにする必要が無い）。
    if (isGuestMode()) {
      try {
        const { buildDemoPersonalOkrDataset } = await import("../lib/demo/personalOkrDataset");
        const demo = buildDemoPersonalOkrDataset();
        set({
          krs: demo.krs,
          monthsByKr: demo.monthsByKr,
          weeksByKr: demo.weeksByKr,
          memosByKr: demo.memosByKr,
          weekTasksByWeek: demo.weekTasksByWeek,
          detailLoadedKrIds: new Set(demo.krs.map(k => k.id)),
          krsLoaded: true,
          krsLoading: false,
        });
      } catch (e) {
        set({ krsLoading: false, krsError: e instanceof Error ? e.message : "サンプルデータの読み込みに失敗しました" });
      }
      return;
    }
    try {
      const krs = await fetchPersonalKrs();
      if (ep !== epoch) return;
      set({ krs, krsLoaded: true, krsLoading: false });
    } catch (e) {
      if (ep !== epoch) return;
      set({ krsLoading: false, krsError: formatErrorForUser("個人KRの取得に失敗しました", e) });
    }
  },

  ensureKrDetailLoaded: async (krId) => {
    if (get().detailLoadedKrIds.has(krId)) return;
    // 🔴 ゲスト分岐：loadKrs()が最初のKR群をまとめて注入済みのため、通常はこのガードに
    // 到達しない。新規作成KR（「＋KRを追加」）等、loadKrs後に増えたKRのために保険で用意する
    // （空配列で確定させるだけ・Supabaseへは一切問い合わせない）。
    if (isGuestMode()) {
      set(state => ({
        monthsByKr: { ...state.monthsByKr, [krId]: state.monthsByKr[krId] ?? [] },
        weeksByKr: { ...state.weeksByKr, [krId]: state.weeksByKr[krId] ?? [] },
        memosByKr: { ...state.memosByKr, [krId]: state.memosByKr[krId] ?? [] },
        detailLoadedKrIds: new Set(state.detailLoadedKrIds).add(krId),
      }));
      return;
    }
    return dedupe(`detail:${krId}`, async () => {
      const ep = epoch;
      set(state => ({ detailLoadingKrIds: new Set(state.detailLoadingKrIds).add(krId), detailError: null }));
      try {
        const [months, weeks, memos] = await Promise.all([
          fetchPersonalKrMonths(krId),
          fetchPersonalKrWeeks(krId),
          fetchPersonalKrMemos(krId),
        ]);
        if (ep !== epoch) return;
        // 取得中に同じKRへ保存が入っていても、保存直後の値と updated_at を取得結果で巻き戻さない
        set(state => ({
          monthsByKr: { ...state.monthsByKr, [krId]: mergeFetchedRows(months, state.monthsByKr[krId], "end") },
          weeksByKr: { ...state.weeksByKr, [krId]: mergeFetchedRows(weeks, state.weeksByKr[krId], "end") },
          memosByKr: { ...state.memosByKr, [krId]: mergeFetchedRows(memos, state.memosByKr[krId], "start") },
          detailLoadedKrIds: new Set(state.detailLoadedKrIds).add(krId),
          detailLoadingKrIds: without(state.detailLoadingKrIds, krId),
        }));
      } catch (e) {
        if (ep !== epoch) return;
        set(state => ({
          detailLoadingKrIds: without(state.detailLoadingKrIds, krId),
          detailError: formatErrorForUser("個人KR詳細の取得に失敗しました", e),
        }));
      }
    });
  },

  ensureWeekTasksLoaded: async (weekId) => {
    if (get().weekTasksByWeek[weekId]) return;
    // 🔴 ゲスト分岐：loadKrs()が既存週の紐づけをweekTasksByWeekへ注入済み。新規作成週
    // （ensureWeek）のために空配列で確定させる（Supabaseへは問い合わせない）。
    if (isGuestMode()) {
      set(state => ({ weekTasksByWeek: { ...state.weekTasksByWeek, [weekId]: [] } }));
      return;
    }
    return dedupe(`weektasks:${weekId}`, async () => {
      const ep = epoch;
      try {
        const links = await fetchPersonalKrWeekTasks(weekId);
        if (ep !== epoch) return;
        set(state => ({ weekTasksByWeek: { ...state.weekTasksByWeek, [weekId]: links } }));
      } catch {
        // 候補提示・紐づけ表示はベストエフォート（週自体の表示は壊さない）。
        // 失敗した週は未取得（undefined）のまま残し、次の呼び出しで再取得できるようにする。
        // 空配列で確定させると、実際は紐づけがあるのに「無い」として扱い続けてしまう。
      }
    });
  },

  ensurePeriodMonthsLoaded: async (krIds) => {
    // 🔴 ゲスト：loadKrs()がguestPersona等を含めた全データを既に注入済みのため、通常は
    // monthsByKr[krId]が既にundefined以外になっている。新規作成KR（loadKrs後に増えたKR）の
    // ための保険として、未確定のものだけ空配列で埋める（Supabaseへは問い合わせない）。
    if (isGuestMode()) {
      set(state => {
        const missing = krIds.filter(id => state.monthsByKr[id] === undefined);
        if (missing.length === 0) return {};
        const next = { ...state.monthsByKr };
        for (const id of missing) next[id] = [];
        return { monthsByKr: next };
      });
      return;
    }
    // 既に読み込み済み（monthsByKr[krId]が確定済み）・既に先読み中のKRは対象から除外する
    // （重複ロード防止・同時多重呼び出し防止）。
    const { monthsByKr, monthsPreloadPendingKrIds } = get();
    const toFetch = krIds.filter(id => monthsByKr[id] === undefined && !monthsPreloadPendingKrIds.has(id));
    if (toFetch.length === 0) return;
    set(state => {
      const nextPending = new Set(state.monthsPreloadPendingKrIds);
      for (const id of toFetch) nextPending.add(id);
      return { monthsPreloadPendingKrIds: nextPending };
    });
    const ep = epoch;
    try {
      const rows = await fetchPersonalKrMonthsForKrs(toFetch);
      if (ep !== epoch) return;
      set(state => {
        // 🔴 保存直後のローカル値を巻き戻さない：先読みの応答が届くまでの間に、
        // 同じKRへ既に保存（saveMonth）が入っていれば monthsByKr[krId] は
        // 既にundefined以外へ確定している。書き込み直前に再度undefinedかどうかを見て、
        // 既に埋まっているKRへは先読みの結果を書き込まない（stateの現在値state.monthsByKrを
        // 見る＝クロージャに捕まえたmonthsByKrではなく常に最新値を見るのが重要）。
        const nextMonths = { ...state.monthsByKr };
        for (const id of toFetch) {
          if (nextMonths[id] === undefined) nextMonths[id] = rows.filter(m => m.personal_kr_id === id);
        }
        const nextPending = new Set(state.monthsPreloadPendingKrIds);
        for (const id of toFetch) nextPending.delete(id);
        return { monthsByKr: nextMonths, monthsPreloadPendingKrIds: nextPending };
      });
    } catch (e) {
      if (ep !== epoch) return;
      set(state => {
        const nextPending = new Set(state.monthsPreloadPendingKrIds);
        for (const id of toFetch) nextPending.delete(id);
        return {
          monthsPreloadPendingKrIds: nextPending,
          detailError: formatErrorForUser("個人KR月次計画の一括取得に失敗しました", e),
        };
      });
    }
  },

  saveKr: async (kr, expectedUpdatedAt) => {
    // 🔴 ゲストはDB呼び出しをスキップし、ローカルで生成したupdated_atでstateだけ更新する
    // （メモリ上でのみ成立・リロードで消える）。以後のupsertById呼び出しは実データと共通。
    const updatedAt = isGuestMode() ? new Date().toISOString() : await upsertPersonalKr(kr, expectedUpdatedAt);
    set(state => ({ krs: upsertById(state.krs, { ...kr, updated_at: updatedAt }) }));
  },

  deleteKr: async (id, deletedBy) => {
    if (!isGuestMode()) await softDeletePersonalKr(id, deletedBy);
    // 削除したKRの月・週・メモ・紐づけを残さない（同じidのキャッシュが後で参照されないように）
    set(state => {
      const weekIds = (state.weeksByKr[id] ?? []).map(w => w.id);
      const weekTasksByWeek = { ...state.weekTasksByWeek };
      for (const w of weekIds) delete weekTasksByWeek[w];
      return {
        krs: state.krs.filter(k => k.id !== id),
        monthsByKr: omitKey(state.monthsByKr, id),
        weeksByKr: omitKey(state.weeksByKr, id),
        memosByKr: omitKey(state.memosByKr, id),
        weekTasksByWeek,
        detailLoadedKrIds: without(state.detailLoadedKrIds, id),
      };
    });
  },

  saveMonth: async (month, expectedUpdatedAt) => {
    const updatedAt = isGuestMode() ? new Date().toISOString() : await upsertPersonalKrMonth(month, expectedUpdatedAt);
    set(state => ({
      monthsByKr: {
        ...state.monthsByKr,
        [month.personal_kr_id]: upsertById(state.monthsByKr[month.personal_kr_id] ?? [], { ...month, updated_at: updatedAt }),
      },
    }));
  },

  saveWeek: async (week, expectedUpdatedAt) => {
    const updatedAt = isGuestMode() ? new Date().toISOString() : await upsertPersonalKrWeek(week, expectedUpdatedAt);
    set(state => ({
      weeksByKr: {
        ...state.weeksByKr,
        [week.personal_kr_id]: upsertById(state.weeksByKr[week.personal_kr_id] ?? [], { ...week, updated_at: updatedAt }),
      },
    }));
  },

  saveMemo: async (memo, expectedUpdatedAt) => {
    const updatedAt = isGuestMode() ? new Date().toISOString() : await upsertPersonalKrMemo(memo, expectedUpdatedAt);
    set(state => {
      const list = state.memosByKr[memo.personal_kr_id] ?? [];
      const next = { ...memo, updated_at: updatedAt };
      const exists = list.some(m => m.id === memo.id);
      const nextList = exists ? list.map(m => (m.id === memo.id ? next : m)) : [next, ...list];
      return { memosByKr: { ...state.memosByKr, [memo.personal_kr_id]: nextList } };
    });
  },

  deleteMemo: async (id, personalKrId, deletedBy) => {
    if (!isGuestMode()) await softDeletePersonalKrMemo(id, deletedBy);
    set(state => ({
      memosByKr: { ...state.memosByKr, [personalKrId]: (state.memosByKr[personalKrId] ?? []).filter(m => m.id !== id) },
    }));
  },

  linkWeekTask: async (weekId, taskId) => {
    if (!isGuestMode()) {
      await requireWeekTasksLoaded(get, weekId);
      await insertPersonalKrWeekTask({ week_id: weekId, task_id: taskId });
    }
    set(state => ({
      weekTasksByWeek: {
        ...state.weekTasksByWeek,
        [weekId]: [...(state.weekTasksByWeek[weekId] ?? []), { week_id: weekId, task_id: taskId }],
      },
    }));
  },

  unlinkWeekTask: async (weekId, taskId) => {
    if (!isGuestMode()) {
      await requireWeekTasksLoaded(get, weekId);
      await deletePersonalKrWeekTask(weekId, taskId);
    }
    set(state => ({
      weekTasksByWeek: {
        ...state.weekTasksByWeek,
        [weekId]: (state.weekTasksByWeek[weekId] ?? []).filter(l => l.task_id !== taskId),
      },
    }));
  },

  ensureOutlookLoaded: async (personalKrId, month) => {
    const key = outlookKey(personalKrId, month);
    if (get().outlookFetchedKeys.has(key)) return;
    // 🔴 ゲストはpersonal_kr_outlooksに一切問い合わせない。メモリ上に既にある値
    // （runOutlookAnalysisが解析済みならそれ・無ければnull）で確定させるだけ。
    if (isGuestMode()) {
      set(state => ({
        outlookByKrMonth: { ...state.outlookByKrMonth, [key]: state.outlookByKrMonth[key] ?? null },
        outlookFetchedKeys: new Set(state.outlookFetchedKeys).add(key),
      }));
      return;
    }
    return dedupe(`outlook:${key}`, async () => {
    const ep = epoch;
    try {
      const row = await fetchLatestPersonalKrOutlook(personalKrId, month);
      if (ep !== epoch) return;
      // 取得中に runOutlookAnalysis が結果を載せていたら、古い取得結果（多くは null）で上書きしない
      set(state => state.outlookFetchedKeys.has(key) ? {} : ({
        outlookByKrMonth: { ...state.outlookByKrMonth, [key]: row },
        outlookFetchedKeys: new Set(state.outlookFetchedKeys).add(key),
      }));
    } catch (e) {
      if (ep !== epoch) return;
      // 🔴 outlookByKrMonth[key]をundefinedのまま残さない（AheadBlockのisLoadingOutlookは
      // outlookRow===undefinedでスケルトンを出し続けるため、取得失敗時にnullで確定させないと
      // 「これから」のAI部分が永久にスケルトン表示のまま止まる。personal_kr_outlooksテーブル
      // 未適用のような構造的エラーで実際に発生した事故（2026-08-12）。
      // outlookFetchedKeysも立てて、同じ失敗に対する無駄なSELECTの再発火を防ぐ（「再解析」ボタンは
      // force:trueでrunOutlookAnalysisを直接呼ぶため、この早期returnの影響は受けない）。
      set(state => ({
        outlookByKrMonth: { ...state.outlookByKrMonth, [key]: state.outlookByKrMonth[key] ?? null },
        outlookFetchedKeys: new Set(state.outlookFetchedKeys).add(key),
        outlookErrorByKey: { ...state.outlookErrorByKey, [key]: formatErrorForUser("AI解析結果の取得に失敗しました", e) },
      }));
    }
    });
  },

  runOutlookAnalysis: async ({ personalKrId, month, fingerprint, context, force }) => {
    const key = outlookKey(personalKrId, month);
    if (get().outlookAnalyzingKeys.has(key)) return; // 二重発火防止（連続effect・連打対策）
    // 🔴 解析中の印は、DBの直近結果の確認（await）より前に立てる。後に立てると、確認の待ち時間の
    // 間に届いた2回目の呼び出しが上のガードを通り抜け、AIを二重に呼んで二重に課金する。
    const ep = epoch;
    set(state => ({ outlookAnalyzingKeys: new Set(state.outlookAnalyzingKeys).add(key) }));
    try {
      // 別端末・別セッションでも再解析されないための前提：まずDBの直近結果を確認する
      // （ゲストはensureOutlookLoaded自体がDBに問い合わせず、メモリ上の値をそのまま使う）
      await get().ensureOutlookLoaded(personalKrId, month);
      const cached = get().outlookByKrMonth[key] ?? null;
      set(state => ({ outlookErrorByKey: { ...state.outlookErrorByKey, [key]: null } }));
      // 🔴 AI呼び出し（analyze）自体はゲストでも素通しする（invokeAI.tsが既に開放済み・
      // CLAUDE.md Section 23 Phase 3）。ただし解析結果は personal_kr_outlooks に書けない
      // ため、ゲストのときは insertPersonalKrOutlook をスキップしメモリ保持のみにする。
      const { ranAnalysis, outlook } = await runPersonalKrOutlookAnalysis({
        personalKrId, month, fingerprint, cached, force: !!force,
        analyze: () => analyzePersonalKrOutlook(context),
      });
      if (ranAnalysis && !isGuestMode()) await insertPersonalKrOutlook(outlook); // 履歴として積む（UPDATEしない）
      if (ep !== epoch) return;
      set(state => {
        const analyzing = new Set(state.outlookAnalyzingKeys);
        analyzing.delete(key);
        return {
          outlookByKrMonth: { ...state.outlookByKrMonth, [key]: outlook },
          outlookFetchedKeys: new Set(state.outlookFetchedKeys).add(key),
          outlookAnalyzingKeys: analyzing,
        };
      });
    } catch (e) {
      if (ep !== epoch) return;
      set(state => {
        const analyzing = new Set(state.outlookAnalyzingKeys);
        analyzing.delete(key);
        return {
          outlookAnalyzingKeys: analyzing,
          outlookErrorByKey: { ...state.outlookErrorByKey, [key]: formatErrorForUser("AI解析に失敗しました", e) },
        };
      });
    }
  },

  ensureReviewDraftLoaded: async (personalKrId, month) => {
    const key = reviewDraftKey(personalKrId, month);
    if (get().reviewDraftFetchedKeys.has(key)) return;
    // 🔴 ゲストはpersonal_kr_review_draftsに一切問い合わせない。メモリ上に既にある値
    // （runReviewDraftが生成済みならそれ・無ければnull）で確定させるだけ。
    if (isGuestMode()) {
      set(state => ({
        reviewDraftByKrMonth: { ...state.reviewDraftByKrMonth, [key]: state.reviewDraftByKrMonth[key] ?? null },
        reviewDraftFetchedKeys: new Set(state.reviewDraftFetchedKeys).add(key),
      }));
      return;
    }
    return dedupe(`reviewDraft:${key}`, async () => {
    const ep = epoch;
    try {
      const row = await fetchLatestPersonalKrReviewDraft(personalKrId, month);
      if (ep !== epoch) return;
      set(state => state.reviewDraftFetchedKeys.has(key) ? {} : ({
        reviewDraftByKrMonth: { ...state.reviewDraftByKrMonth, [key]: row },
        reviewDraftFetchedKeys: new Set(state.reviewDraftFetchedKeys).add(key),
      }));
    } catch (e) {
      if (ep !== epoch) return;
      // 🔴 outlookのensureOutlookLoadedと同じ理由でnullで確定させる（undefinedのまま残すと
      // モーダル側が永久に読み込み中のまま止まる。personal_kr_review_drafts未適用時の事故を防ぐ）。
      set(state => ({
        reviewDraftByKrMonth: { ...state.reviewDraftByKrMonth, [key]: state.reviewDraftByKrMonth[key] ?? null },
        reviewDraftFetchedKeys: new Set(state.reviewDraftFetchedKeys).add(key),
        reviewDraftErrorByKey: { ...state.reviewDraftErrorByKey, [key]: formatErrorForUser("振り返り下書きの取得に失敗しました", e) },
      }));
    }
    });
  },

  runReviewDraft: async ({ personalKrId, month, fingerprint, context, material, force }) => {
    const key = reviewDraftKey(personalKrId, month);
    if (get().reviewDraftAnalyzingKeys.has(key)) return; // 二重発火防止（連打対策）
    // 🔴 生成中の印は、DBの直近下書きの確認（await）より前に立てる（runOutlookAnalysis と同じ理由）。
    const ep = epoch;
    set(state => ({ reviewDraftAnalyzingKeys: new Set(state.reviewDraftAnalyzingKeys).add(key) }));
    try {
      // 別端末・別セッションでも再生成されないための前提：まずDBの直近下書きを確認する
      // （ゲストはensureReviewDraftLoaded自体がDBに問い合わせず、メモリ上の値をそのまま使う）
      await get().ensureReviewDraftLoaded(personalKrId, month);
      const cached = get().reviewDraftByKrMonth[key] ?? null;
      set(state => ({ reviewDraftErrorByKey: { ...state.reviewDraftErrorByKey, [key]: null } }));
      // 🔴 AI呼び出し（analyze）自体はゲストでも素通しする（invokeAI.tsが既に開放済み・
      // CLAUDE.md Section 23 Phase 3）。ただし下書きはpersonal_kr_review_draftsに書けない
      // ため、ゲストのときは insertPersonalKrReviewDraft をスキップしメモリ保持のみにする。
      const { ranAnalysis, draft } = await runPersonalKrReviewDraft({
        personalKrId, month, fingerprint, cached, force: !!force,
        analyze: () => generatePersonalKrReviewDraft(context, material),
      });
      if (ranAnalysis && !isGuestMode()) await insertPersonalKrReviewDraft(draft); // 履歴として積む（人の編集以外はUPDATEしない）
      if (ep !== epoch) return;
      set(state => {
        const analyzing = new Set(state.reviewDraftAnalyzingKeys);
        analyzing.delete(key);
        return {
          reviewDraftByKrMonth: { ...state.reviewDraftByKrMonth, [key]: draft },
          reviewDraftFetchedKeys: new Set(state.reviewDraftFetchedKeys).add(key),
          reviewDraftAnalyzingKeys: analyzing,
        };
      });
    } catch (e) {
      if (ep !== epoch) return;
      set(state => {
        const analyzing = new Set(state.reviewDraftAnalyzingKeys);
        analyzing.delete(key);
        return {
          reviewDraftAnalyzingKeys: analyzing,
          reviewDraftErrorByKey: { ...state.reviewDraftErrorByKey, [key]: formatErrorForUser("振り返り下書きの生成に失敗しました", e) },
        };
      });
    }
  },

  loadPeriodReviews: async () => {
    if (get().periodReviewsLoading || get().periodReviewsLoaded) return;
    const ep = epoch;
    set({ periodReviewsLoading: true, periodReviewsError: null });
    // 🔴 ゲストはSupabaseに一切接続しない（冒頭コメント参照）。「全体」タブのサンプルデータは
    // 用意していない（v3.67のKRサンプルのような専用データセットが無い）ため、空のまま
    // 確定させる（保存操作自体はsavePeriodReview側のゲスト分岐でメモリ上にのみ成立する）。
    if (isGuestMode()) {
      set({ periodReviews: [], periodReviewsLoaded: true, periodReviewsLoading: false });
      return;
    }
    try {
      const rows = await fetchPersonalPeriodReviews();
      if (ep !== epoch) return;
      set({ periodReviews: rows, periodReviewsLoaded: true, periodReviewsLoading: false });
    } catch (e) {
      if (ep !== epoch) return;
      // 🔴🔴 W2（最重要）：ここで例外を投げ直さない。テーブル未適用（マイグレーション未適用の
      // 窓）でも「全体」タブだけが案内を出せるよう、periodReviewsLoaded=trueで確定させ
      // エラーメッセージだけをstateに積む。krs等の既存stateには一切触れていないため、
      // KRタブ側の動作はこの失敗の影響を受けない。
      set({
        periodReviewsLoading: false,
        periodReviewsLoaded: true,
        periodReviewsError: e instanceof Error ? e.message : "月全体・四半期全体の振り返りの取得に失敗しました",
      });
    }
  },

  savePeriodReview: async (review, expectedUpdatedAt) => {
    const updatedAt = isGuestMode() ? new Date().toISOString() : await upsertPersonalPeriodReview(review, expectedUpdatedAt);
    set(state => ({ periodReviews: upsertById(state.periodReviews, { ...review, updated_at: updatedAt }) }));
  },

  ensureActualActivitiesChecked: async () => {
    if (get().actualActivitiesChecking || get().actualActivitiesAvailable !== "unknown") return;
    // 🔴 ゲストはSupabaseに一切接続しない（冒頭コメント参照）。ゲストの実施記録欄は
    // メモリ上でのみ成立するため、列の有無を問わず「利用可能」として扱ってよい。
    if (isGuestMode()) { set({ actualActivitiesAvailable: "available" }); return; }
    set({ actualActivitiesChecking: true });
    try {
      const result = await probeActualActivitiesColumn();
      // 🔴 fail-open：判定不能（null。ネットワークエラー等）のときは「利用可能」側に倒す。
      // 実際に列が無ければ、ActualActivitiesBlock自身の保存時PGRST204検知が最終防波堤になる。
      set({ actualActivitiesChecking: false, actualActivitiesAvailable: result === false ? "unavailable" : "available" });
    } catch {
      set({ actualActivitiesChecking: false, actualActivitiesAvailable: "available" });
    }
  },
}));

/**
 * ストアを空に戻す（ユーザー切替・サインアウト用）。進行中の取得・AI呼び出しの結果は
 * epoch の更新で捨てられる。ゲストのサンプルも消えるが、ゲストでは呼ばれない（decideAuthReset）。
 */
export function resetPersonalOkrUiStore(): void {
  epoch += 1;
  inflight.clear();
  usePersonalOkrUiStore.setState(initialData());
}

// 認証の変化でストアを空に戻す。このモジュールは「自分」タブを開いた時に初めて読み込まれる
// （Section 19）ため、App.tsx のログアウト処理からは参照せず、ここで自分で購読する。
let lastAuthUserId: string | null = null;
onAuthStateChange((session, event) => {
  const d = decideAuthReset({
    prevUserId: lastAuthUserId,
    event,
    userId: session?.user?.id ?? null,
    isAnonymous: !!session?.user?.is_anonymous,
    isGuest: isGuestMode(),
  });
  lastAuthUserId = d.userId;
  if (d.reset) resetPersonalOkrUiStore();
});
