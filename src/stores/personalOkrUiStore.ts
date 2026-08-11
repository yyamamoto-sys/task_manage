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
} from "../lib/supabase/personalOkrStore";
import { analyzePersonalKrOutlook } from "../lib/ai/personalOkrOutlookExtractor";
import { runPersonalKrOutlookAnalysis } from "../lib/personalOkr/outlookRunner";
import type { PersonalOkrAiContextInput } from "../lib/personalOkr/personalOkrAiContext";
import type {
  PersonalKr, PersonalKrMonth, PersonalKrWeek, PersonalKrWeekTask, PersonalKrMemo, PersonalKrOutlook,
} from "../lib/localData/types";

/** outlookByKrMonth等のキー形式（personalKrId・monthの組で一意）。Phase 3後半で追加 */
function outlookKey(personalKrId: string, month: string): string {
  return `${personalKrId}::${month}`;
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

  loadKrs: async () => {
    if (get().krsLoading) return;
    set({ krsLoading: true, krsError: null });
    try {
      const krs = await fetchPersonalKrs();
      set({ krs, krsLoaded: true, krsLoading: false });
    } catch (e) {
      set({ krsLoading: false, krsError: e instanceof Error ? e.message : "個人KRの取得に失敗しました" });
    }
  },

  ensureKrDetailLoaded: async (krId) => {
    if (get().detailLoadedKrIds.has(krId) || get().detailLoadingKrId === krId) return;
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
    try {
      const links = await fetchPersonalKrWeekTasks(weekId);
      set(state => ({ weekTasksByWeek: { ...state.weekTasksByWeek, [weekId]: links } }));
    } catch {
      // 候補提示・紐づけ表示はベストエフォート。失敗時は空のまま扱う（週自体の表示は壊さない）
      set(state => ({ weekTasksByWeek: { ...state.weekTasksByWeek, [weekId]: [] } }));
    }
  },

  saveKr: async (kr, expectedUpdatedAt) => {
    const updatedAt = await upsertPersonalKr(kr, expectedUpdatedAt);
    set(state => {
      const next = { ...kr, updated_at: updatedAt };
      const exists = state.krs.some(k => k.id === kr.id);
      return { krs: exists ? state.krs.map(k => (k.id === kr.id ? next : k)) : [...state.krs, next] };
    });
  },

  deleteKr: async (id, deletedBy) => {
    await softDeletePersonalKr(id, deletedBy);
    set(state => ({ krs: state.krs.filter(k => k.id !== id) }));
  },

  saveMonth: async (month, expectedUpdatedAt) => {
    const updatedAt = await upsertPersonalKrMonth(month, expectedUpdatedAt);
    set(state => {
      const list = state.monthsByKr[month.personal_kr_id] ?? [];
      const next = { ...month, updated_at: updatedAt };
      const exists = list.some(m => m.id === month.id);
      const nextList = exists ? list.map(m => (m.id === month.id ? next : m)) : [...list, next];
      return { monthsByKr: { ...state.monthsByKr, [month.personal_kr_id]: nextList } };
    });
  },

  saveWeek: async (week, expectedUpdatedAt) => {
    const updatedAt = await upsertPersonalKrWeek(week, expectedUpdatedAt);
    set(state => {
      const list = state.weeksByKr[week.personal_kr_id] ?? [];
      const next = { ...week, updated_at: updatedAt };
      const exists = list.some(w => w.id === week.id);
      const nextList = exists ? list.map(w => (w.id === week.id ? next : w)) : [...list, next];
      return { weeksByKr: { ...state.weeksByKr, [week.personal_kr_id]: nextList } };
    });
  },

  saveMemo: async (memo, expectedUpdatedAt) => {
    const updatedAt = await upsertPersonalKrMemo(memo, expectedUpdatedAt);
    set(state => {
      const list = state.memosByKr[memo.personal_kr_id] ?? [];
      const next = { ...memo, updated_at: updatedAt };
      const exists = list.some(m => m.id === memo.id);
      const nextList = exists ? list.map(m => (m.id === memo.id ? next : m)) : [next, ...list];
      return { memosByKr: { ...state.memosByKr, [memo.personal_kr_id]: nextList } };
    });
  },

  deleteMemo: async (id, personalKrId, deletedBy) => {
    await softDeletePersonalKrMemo(id, deletedBy);
    set(state => ({
      memosByKr: { ...state.memosByKr, [personalKrId]: (state.memosByKr[personalKrId] ?? []).filter(m => m.id !== id) },
    }));
  },

  linkWeekTask: async (weekId, taskId) => {
    await insertPersonalKrWeekTask({ week_id: weekId, task_id: taskId });
    set(state => ({
      weekTasksByWeek: {
        ...state.weekTasksByWeek,
        [weekId]: [...(state.weekTasksByWeek[weekId] ?? []), { week_id: weekId, task_id: taskId }],
      },
    }));
  },

  unlinkWeekTask: async (weekId, taskId) => {
    await deletePersonalKrWeekTask(weekId, taskId);
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
    try {
      const row = await fetchLatestPersonalKrOutlook(personalKrId, month);
      set(state => ({
        outlookByKrMonth: { ...state.outlookByKrMonth, [key]: row },
        outlookFetchedKeys: new Set(state.outlookFetchedKeys).add(key),
      }));
    } catch (e) {
      set(state => ({
        outlookErrorByKey: { ...state.outlookErrorByKey, [key]: e instanceof Error ? e.message : "AI解析結果の取得に失敗しました" },
      }));
    }
  },

  runOutlookAnalysis: async ({ personalKrId, month, fingerprint, context, force }) => {
    const key = outlookKey(personalKrId, month);
    if (get().outlookAnalyzingKeys.has(key)) return; // 二重発火防止（連続effect・連打対策）

    // 別端末・別セッションでも再解析されないための前提：まずDBの直近結果を確認する
    await get().ensureOutlookLoaded(personalKrId, month);
    const cached = get().outlookByKrMonth[key] ?? null;

    set(state => ({
      outlookAnalyzingKeys: new Set(state.outlookAnalyzingKeys).add(key),
      outlookErrorByKey: { ...state.outlookErrorByKey, [key]: null },
    }));
    try {
      const { ranAnalysis, outlook } = await runPersonalKrOutlookAnalysis({
        personalKrId, month, fingerprint, cached, force: !!force,
        analyze: () => analyzePersonalKrOutlook(context),
      });
      if (ranAnalysis) await insertPersonalKrOutlook(outlook); // 履歴として積む（UPDATEしない）
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
}));
