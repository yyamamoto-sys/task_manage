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
  fetchPersonalKrMonths, upsertPersonalKrMonth,
  fetchPersonalKrWeeks, upsertPersonalKrWeek,
  fetchPersonalKrWeekTasks, insertPersonalKrWeekTask, deletePersonalKrWeekTask,
  fetchPersonalKrMemos, upsertPersonalKrMemo, softDeletePersonalKrMemo,
  fetchLatestPersonalKrOutlook, insertPersonalKrOutlook,
  fetchLatestPersonalKrReviewDraft, insertPersonalKrReviewDraft, updatePersonalKrReviewDraftEdit,
} from "../lib/supabase/personalOkrStore";
import { analyzePersonalKrOutlook } from "../lib/ai/personalOkrOutlookExtractor";
import { generatePersonalKrReviewDraft } from "../lib/ai/personalOkrReviewDraftExtractor";
import { runPersonalKrOutlookAnalysis } from "../lib/personalOkr/outlookRunner";
import { runPersonalKrReviewDraft } from "../lib/personalOkr/reviewDraftRunner";
import { isGuestMode } from "../lib/guestMode";
import type { PersonalOkrAiContextInput } from "../lib/personalOkr/personalOkrAiContext";
import type { ReviewMaterial } from "../lib/personalOkr/reviewMaterial";
import type {
  PersonalKr, PersonalKrMonth, PersonalKrWeek, PersonalKrWeekTask, PersonalKrMemo, PersonalKrOutlook,
  PersonalKrReviewDraft,
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
// Phase 4（runReviewDraft/saveReviewDraftEdit）も同じ方針：AI生成はゲストでも素通しするが
// personal_kr_review_draftsへのinsert/updateはスキップし、メモリ上でのみ成立させる。

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
  detailLoadingKrId: string | null;
  detailError: string | null;

  loadKrs: () => Promise<void>;
  ensureKrDetailLoaded: (krId: string) => Promise<void>;
  ensureWeekTasksLoaded: (weekId: string) => Promise<void>;

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
  reviewDraftSavingKeys: Set<string>;

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
  /** 🔴 人が編集した本文を保存する。直近の下書き行のedited_text/edited_atをUPDATEする
   *  （outlooksと違いこの操作だけはUPDATE。CLAUDE.md Section 24 Step M参照）。 */
  saveReviewDraftEdit: (params: {
    personalKrId: string;
    month: string;
    editedText: string;
  }) => Promise<void>;
}

export const usePersonalOkrUiStore = create<PersonalOkrUiState>((set, get) => ({
  krs: [],
  krsLoaded: false,
  krsLoading: false,
  krsError: null,

  monthsByKr: {},
  weeksByKr: {},
  memosByKr: {},
  weekTasksByWeek: {},
  detailLoadedKrIds: new Set(),
  detailLoadingKrId: null,
  detailError: null,

  outlookByKrMonth: {},
  outlookFetchedKeys: new Set(),
  outlookAnalyzingKeys: new Set(),
  outlookErrorByKey: {},

  reviewDraftByKrMonth: {},
  reviewDraftFetchedKeys: new Set(),
  reviewDraftAnalyzingKeys: new Set(),
  reviewDraftErrorByKey: {},
  reviewDraftSavingKeys: new Set(),

  loadKrs: async () => {
    if (get().krsLoading || get().krsLoaded) return;
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
      set({ krs, krsLoaded: true, krsLoading: false });
    } catch (e) {
      set({ krsLoading: false, krsError: e instanceof Error ? e.message : "個人KRの取得に失敗しました" });
    }
  },

  ensureKrDetailLoaded: async (krId) => {
    if (get().detailLoadedKrIds.has(krId) || get().detailLoadingKrId === krId) return;
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
    set({ detailLoadingKrId: krId, detailError: null });
    try {
      const [months, weeks, memos] = await Promise.all([
        fetchPersonalKrMonths(krId),
        fetchPersonalKrWeeks(krId),
        fetchPersonalKrMemos(krId),
      ]);
      set(state => ({
        monthsByKr: { ...state.monthsByKr, [krId]: months },
        weeksByKr: { ...state.weeksByKr, [krId]: weeks },
        memosByKr: { ...state.memosByKr, [krId]: memos },
        detailLoadedKrIds: new Set(state.detailLoadedKrIds).add(krId),
        detailLoadingKrId: null,
      }));
    } catch (e) {
      set({ detailLoadingKrId: null, detailError: e instanceof Error ? e.message : "個人KR詳細の取得に失敗しました" });
    }
  },

  ensureWeekTasksLoaded: async (weekId) => {
    if (get().weekTasksByWeek[weekId]) return;
    // 🔴 ゲスト分岐：loadKrs()が既存週の紐づけをweekTasksByWeekへ注入済み。新規作成週
    // （ensureWeek）のために空配列で確定させる（Supabaseへは問い合わせない）。
    if (isGuestMode()) {
      set(state => ({ weekTasksByWeek: { ...state.weekTasksByWeek, [weekId]: [] } }));
      return;
    }
    try {
      const links = await fetchPersonalKrWeekTasks(weekId);
      set(state => ({ weekTasksByWeek: { ...state.weekTasksByWeek, [weekId]: links } }));
    } catch {
      // 候補提示・紐づけ表示はベストエフォート。失敗時は空のまま扱う（週自体の表示は壊さない）
      set(state => ({ weekTasksByWeek: { ...state.weekTasksByWeek, [weekId]: [] } }));
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
    set(state => ({ krs: state.krs.filter(k => k.id !== id) }));
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
    if (!isGuestMode()) await insertPersonalKrWeekTask({ week_id: weekId, task_id: taskId });
    set(state => ({
      weekTasksByWeek: {
        ...state.weekTasksByWeek,
        [weekId]: [...(state.weekTasksByWeek[weekId] ?? []), { week_id: weekId, task_id: taskId }],
      },
    }));
  },

  unlinkWeekTask: async (weekId, taskId) => {
    if (!isGuestMode()) await deletePersonalKrWeekTask(weekId, taskId);
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
    try {
      const row = await fetchLatestPersonalKrOutlook(personalKrId, month);
      set(state => ({
        outlookByKrMonth: { ...state.outlookByKrMonth, [key]: row },
        outlookFetchedKeys: new Set(state.outlookFetchedKeys).add(key),
      }));
    } catch (e) {
      // 🔴 outlookByKrMonth[key]をundefinedのまま残さない（AheadBlockのisLoadingOutlookは
      // outlookRow===undefinedでスケルトンを出し続けるため、取得失敗時にnullで確定させないと
      // 「これから」のAI部分が永久にスケルトン表示のまま止まる。personal_kr_outlooksテーブル
      // 未適用のような構造的エラーで実際に発生した事故（2026-08-12）。
      // outlookFetchedKeysも立てて、同じ失敗に対する無駄なSELECTの再発火を防ぐ（「再解析」ボタンは
      // force:trueでrunOutlookAnalysisを直接呼ぶため、この早期returnの影響は受けない）。
      set(state => ({
        outlookByKrMonth: { ...state.outlookByKrMonth, [key]: state.outlookByKrMonth[key] ?? null },
        outlookFetchedKeys: new Set(state.outlookFetchedKeys).add(key),
        outlookErrorByKey: { ...state.outlookErrorByKey, [key]: e instanceof Error ? e.message : "AI解析結果の取得に失敗しました" },
      }));
    }
  },

  runOutlookAnalysis: async ({ personalKrId, month, fingerprint, context, force }) => {
    const key = outlookKey(personalKrId, month);
    if (get().outlookAnalyzingKeys.has(key)) return; // 二重発火防止（連続effect・連打対策）

    // 別端末・別セッションでも再解析されないための前提：まずDBの直近結果を確認する
    // （ゲストはensureOutlookLoaded自体がDBに問い合わせず、メモリ上の値をそのまま使う）
    await get().ensureOutlookLoaded(personalKrId, month);
    const cached = get().outlookByKrMonth[key] ?? null;

    set(state => ({
      outlookAnalyzingKeys: new Set(state.outlookAnalyzingKeys).add(key),
      outlookErrorByKey: { ...state.outlookErrorByKey, [key]: null },
    }));
    try {
      // 🔴 AI呼び出し（analyze）自体はゲストでも素通しする（invokeAI.tsが既に開放済み・
      // CLAUDE.md Section 23 Phase 3）。ただし解析結果は personal_kr_outlooks に書けない
      // ため、ゲストのときは insertPersonalKrOutlook をスキップしメモリ保持のみにする。
      const { ranAnalysis, outlook } = await runPersonalKrOutlookAnalysis({
        personalKrId, month, fingerprint, cached, force: !!force,
        analyze: () => analyzePersonalKrOutlook(context),
      });
      if (ranAnalysis && !isGuestMode()) await insertPersonalKrOutlook(outlook); // 履歴として積む（UPDATEしない）
      set(state => {
        const analyzing = new Set(state.outlookAnalyzingKeys);
        analyzing.delete(key);
        return {
          outlookByKrMonth: { ...state.outlookByKrMonth, [key]: outlook },
          outlookAnalyzingKeys: analyzing,
        };
      });
    } catch (e) {
      set(state => {
        const analyzing = new Set(state.outlookAnalyzingKeys);
        analyzing.delete(key);
        return {
          outlookAnalyzingKeys: analyzing,
          outlookErrorByKey: { ...state.outlookErrorByKey, [key]: e instanceof Error ? e.message : "AI解析に失敗しました" },
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
    try {
      const row = await fetchLatestPersonalKrReviewDraft(personalKrId, month);
      set(state => ({
        reviewDraftByKrMonth: { ...state.reviewDraftByKrMonth, [key]: row },
        reviewDraftFetchedKeys: new Set(state.reviewDraftFetchedKeys).add(key),
      }));
    } catch (e) {
      // 🔴 outlookのensureOutlookLoadedと同じ理由でnullで確定させる（undefinedのまま残すと
      // モーダル側が永久に読み込み中のまま止まる。personal_kr_review_drafts未適用時の事故を防ぐ）。
      set(state => ({
        reviewDraftByKrMonth: { ...state.reviewDraftByKrMonth, [key]: state.reviewDraftByKrMonth[key] ?? null },
        reviewDraftFetchedKeys: new Set(state.reviewDraftFetchedKeys).add(key),
        reviewDraftErrorByKey: { ...state.reviewDraftErrorByKey, [key]: e instanceof Error ? e.message : "振り返り下書きの取得に失敗しました" },
      }));
    }
  },

  runReviewDraft: async ({ personalKrId, month, fingerprint, context, material, force }) => {
    const key = reviewDraftKey(personalKrId, month);
    if (get().reviewDraftAnalyzingKeys.has(key)) return; // 二重発火防止（連打対策）

    // 別端末・別セッションでも再生成されないための前提：まずDBの直近下書きを確認する
    // （ゲストはensureReviewDraftLoaded自体がDBに問い合わせず、メモリ上の値をそのまま使う）
    await get().ensureReviewDraftLoaded(personalKrId, month);
    const cached = get().reviewDraftByKrMonth[key] ?? null;

    set(state => ({
      reviewDraftAnalyzingKeys: new Set(state.reviewDraftAnalyzingKeys).add(key),
      reviewDraftErrorByKey: { ...state.reviewDraftErrorByKey, [key]: null },
    }));
    try {
      // 🔴 AI呼び出し（analyze）自体はゲストでも素通しする（invokeAI.tsが既に開放済み・
      // CLAUDE.md Section 23 Phase 3）。ただし下書きはpersonal_kr_review_draftsに書けない
      // ため、ゲストのときは insertPersonalKrReviewDraft をスキップしメモリ保持のみにする。
      const { ranAnalysis, draft } = await runPersonalKrReviewDraft({
        personalKrId, month, fingerprint, cached, force: !!force,
        analyze: () => generatePersonalKrReviewDraft(context, material),
      });
      if (ranAnalysis && !isGuestMode()) await insertPersonalKrReviewDraft(draft); // 履歴として積む（人の編集以外はUPDATEしない）
      set(state => {
        const analyzing = new Set(state.reviewDraftAnalyzingKeys);
        analyzing.delete(key);
        return {
          reviewDraftByKrMonth: { ...state.reviewDraftByKrMonth, [key]: draft },
          reviewDraftAnalyzingKeys: analyzing,
        };
      });
    } catch (e) {
      set(state => {
        const analyzing = new Set(state.reviewDraftAnalyzingKeys);
        analyzing.delete(key);
        return {
          reviewDraftAnalyzingKeys: analyzing,
          reviewDraftErrorByKey: { ...state.reviewDraftErrorByKey, [key]: e instanceof Error ? e.message : "振り返り下書きの生成に失敗しました" },
        };
      });
    }
  },

  saveReviewDraftEdit: async ({ personalKrId, month, editedText }) => {
    const key = reviewDraftKey(personalKrId, month);
    const current = get().reviewDraftByKrMonth[key];
    if (!current) throw new Error("下書きがまだ生成されていません。先に下書きを生成してください。");
    set(state => ({ reviewDraftSavingKeys: new Set(state.reviewDraftSavingKeys).add(key) }));
    try {
      const editedAt = new Date().toISOString();
      // 🔴 ゲストはDB更新をスキップし、メモリ上の状態だけを更新する（リロードで消える）。
      if (!isGuestMode()) await updatePersonalKrReviewDraftEdit(current.id, editedText, editedAt);
      set(state => {
        const saving = new Set(state.reviewDraftSavingKeys);
        saving.delete(key);
        return {
          reviewDraftByKrMonth: { ...state.reviewDraftByKrMonth, [key]: { ...current, edited_text: editedText, edited_at: editedAt } },
          reviewDraftSavingKeys: saving,
        };
      });
    } catch (e) {
      set(state => {
        const saving = new Set(state.reviewDraftSavingKeys);
        saving.delete(key);
        return { reviewDraftSavingKeys: saving };
      });
      throw e;
    }
  },
}));
