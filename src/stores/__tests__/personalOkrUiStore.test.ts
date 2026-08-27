// src/stores/__tests__/personalOkrUiStore.test.ts
//
// 【設計意図】
// ゲスト（サンプル閲覧）分岐の再発防止テスト（CLAUDE.md Section 23・24）。
// 🔴 ゲストはSupabaseに一切接続しない、という絶対原則を、personalOkrUiStore.ts の
// 各アクションが実際に守っていることを検証する：
//   - 書き込み系（saveKr等）はゲストのとき低レベルCRUD（personalOkrStore.ts）を一切呼ばない
//   - loadKrsはゲストのときサンプルデータ（personalOkrDataset.ts）だけを注入する
//   - runOutlookAnalysisはゲストでもAI呼び出し（analyzePersonalKrOutlook）は素通しするが、
//     結果のDB書き込み（insertPersonalKrOutlook）はスキップする
// 実データ（非ゲスト）のときは既存どおり低レベルCRUDが呼ばれることも合わせて確認する
// （ゲスト分岐を追加したことで実データ側の経路を壊していないことの回帰テスト）。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setGuestMode } from "../../lib/guestMode";
import type { PersonalOkrAiContextInput } from "../../lib/personalOkr/personalOkrAiContext";

const personalOkrStoreMock = vi.hoisted(() => ({
  fetchPersonalKrs: vi.fn(),
  upsertPersonalKr: vi.fn(),
  softDeletePersonalKr: vi.fn(),
  fetchPersonalKrMonths: vi.fn(),
  fetchPersonalKrMonthsForKrs: vi.fn(),
  upsertPersonalKrMonth: vi.fn(),
  fetchPersonalKrWeeks: vi.fn(),
  upsertPersonalKrWeek: vi.fn(),
  fetchPersonalKrWeekTasks: vi.fn(),
  insertPersonalKrWeekTask: vi.fn(),
  deletePersonalKrWeekTask: vi.fn(),
  fetchPersonalKrMemos: vi.fn(),
  upsertPersonalKrMemo: vi.fn(),
  softDeletePersonalKrMemo: vi.fn(),
  fetchLatestPersonalKrOutlook: vi.fn(),
  insertPersonalKrOutlook: vi.fn(),
  fetchLatestPersonalKrReviewDraft: vi.fn(),
  insertPersonalKrReviewDraft: vi.fn(),
  fetchPersonalPeriodReviews: vi.fn(),
  upsertPersonalPeriodReview: vi.fn(),
  probeActualActivitiesColumn: vi.fn(),
}));

vi.mock("../../lib/supabase/personalOkrStore", () => personalOkrStoreMock);

const analyzeMock = vi.hoisted(() => vi.fn());
vi.mock("../../lib/ai/personalOkrOutlookExtractor", () => ({
  analyzePersonalKrOutlook: analyzeMock,
}));

import { usePersonalOkrUiStore } from "../personalOkrUiStore";

const INITIAL_STATE = usePersonalOkrUiStore.getState();

function resetStore() {
  usePersonalOkrUiStore.setState(INITIAL_STATE, true);
}

const dummyKr = {
  id: "test-kr-1", member_id: "m1", group_id: "g1", fiscal_year: 2026, quarter: "3Q" as const,
  kr_kind: "general" as const, label: "KR1", weight_pct: 100, display_order: 1, is_deleted: false,
};

const dummyContext: PersonalOkrAiContextInput = {
  krLabel: "KR1", krKindLabel: "全般", category: null, activity: null, strengthRole: null,
  weaknessRole: null, criteria: null, supplement: null, monthLabel: "8月",
  positioning: null, activities: null, targetAndEvidence: null, risks: null, bandTarget: null,
  weeks: [], taskSummary: { linkedTaskCount: 0, delayedCount: 0, stagnantCount: 0, blockedCount: 0 },
  recentMemos: [], actualActivities: null,
};

describe("personalOkrUiStore：ゲスト分岐", () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
    Object.values(personalOkrStoreMock).forEach(fn => fn.mockReset());
  });
  afterEach(() => setGuestMode(false));

  it("loadKrs：ゲストはfetchPersonalKrsを呼ばず、サンプルデータをstateに注入する", async () => {
    setGuestMode(true);
    await usePersonalOkrUiStore.getState().loadKrs();
    expect(personalOkrStoreMock.fetchPersonalKrs).not.toHaveBeenCalled();
    const state = usePersonalOkrUiStore.getState();
    expect(state.krsLoaded).toBe(true);
    expect(state.krs.length).toBeGreaterThan(0);
    for (const kr of state.krs) expect(kr.id.startsWith("demo-")).toBe(true);
  });

  it("loadKrs：非ゲストはfetchPersonalKrsを呼ぶ（既存経路は不変）", async () => {
    personalOkrStoreMock.fetchPersonalKrs.mockResolvedValue([dummyKr]);
    await usePersonalOkrUiStore.getState().loadKrs();
    expect(personalOkrStoreMock.fetchPersonalKrs).toHaveBeenCalledTimes(1);
    expect(usePersonalOkrUiStore.getState().krs).toEqual([dummyKr]);
  });

  it("saveKr：ゲストはupsertPersonalKrを呼ばずstateだけ更新する", async () => {
    setGuestMode(true);
    await usePersonalOkrUiStore.getState().saveKr(dummyKr);
    expect(personalOkrStoreMock.upsertPersonalKr).not.toHaveBeenCalled();
    expect(usePersonalOkrUiStore.getState().krs.find(k => k.id === dummyKr.id)).toBeTruthy();
  });

  it("saveMonth/saveWeek/saveMemo：ゲストは対応する低レベルCRUDを一切呼ばない", async () => {
    setGuestMode(true);
    const store = usePersonalOkrUiStore.getState();
    await store.saveMonth({
      id: "m1", personal_kr_id: dummyKr.id, month: "2026-08-01", month_index: 2,
      is_deleted: false,
    });
    await store.saveWeek({
      id: "w1", personal_kr_id: dummyKr.id, month: "2026-08-01", week_index: 1,
      week_start: "2026-08-01", week_end: "2026-08-02", self_rating: null, is_deleted: false,
    });
    await store.saveMemo({
      id: "mm1", personal_kr_id: dummyKr.id, member_id: "__guest__", body: "test", is_deleted: false,
    });
    expect(personalOkrStoreMock.upsertPersonalKrMonth).not.toHaveBeenCalled();
    expect(personalOkrStoreMock.upsertPersonalKrWeek).not.toHaveBeenCalled();
    expect(personalOkrStoreMock.upsertPersonalKrMemo).not.toHaveBeenCalled();
  });

  it("deleteKr/deleteMemo/linkWeekTask/unlinkWeekTask：ゲストは低レベルCRUDを呼ばない", async () => {
    setGuestMode(true);
    const store = usePersonalOkrUiStore.getState();
    await store.deleteKr("k1", "__guest__");
    await store.deleteMemo("mm1", "kr1", "__guest__");
    await store.linkWeekTask("w1", "t1");
    await store.unlinkWeekTask("w1", "t1");
    expect(personalOkrStoreMock.softDeletePersonalKr).not.toHaveBeenCalled();
    expect(personalOkrStoreMock.softDeletePersonalKrMemo).not.toHaveBeenCalled();
    expect(personalOkrStoreMock.insertPersonalKrWeekTask).not.toHaveBeenCalled();
    expect(personalOkrStoreMock.deletePersonalKrWeekTask).not.toHaveBeenCalled();
  });

  it("ensureOutlookLoaded：ゲストはfetchLatestPersonalKrOutlookを呼ばずnullで確定させる", async () => {
    setGuestMode(true);
    await usePersonalOkrUiStore.getState().ensureOutlookLoaded("kr1", "2026-08-01");
    expect(personalOkrStoreMock.fetchLatestPersonalKrOutlook).not.toHaveBeenCalled();
    expect(usePersonalOkrUiStore.getState().outlookByKrMonth["kr1::2026-08-01"]).toBeNull();
  });

  it("runOutlookAnalysis：ゲストでもAI呼び出しは素通しするが、insertPersonalKrOutlookは呼ばない", async () => {
    setGuestMode(true);
    analyzeMock.mockResolvedValue({
      lead: "見立てです", moves: [], trade: null, band_ai: 70, band_ai_reason: "理由", model: "test-model",
    });
    await usePersonalOkrUiStore.getState().runOutlookAnalysis({
      personalKrId: "kr1", month: "2026-08-01", fingerprint: "fp1", context: dummyContext,
    });
    expect(analyzeMock).toHaveBeenCalledTimes(1);
    expect(personalOkrStoreMock.insertPersonalKrOutlook).not.toHaveBeenCalled();
    const outlook = usePersonalOkrUiStore.getState().outlookByKrMonth["kr1::2026-08-01"];
    expect(outlook?.band_ai).toBe(70);
  });

  it("runOutlookAnalysis：非ゲストはAI呼び出し成功後にinsertPersonalKrOutlookを呼ぶ（既存経路は不変）", async () => {
    analyzeMock.mockResolvedValue({
      lead: "見立てです", moves: [], trade: null, band_ai: 70, band_ai_reason: "理由", model: "test-model",
    });
    await usePersonalOkrUiStore.getState().runOutlookAnalysis({
      personalKrId: "kr1", month: "2026-08-01", fingerprint: "fp1", context: dummyContext,
    });
    expect(personalOkrStoreMock.insertPersonalKrOutlook).toHaveBeenCalledTimes(1);
  });
});

// 🔴🔴 W2（最重要・CLAUDE.md Section 24 Step Q・v3.101）：personal_period_reviews が
// マイグレーション未適用（テーブル不在）でも、「全体」タブだけが案内を出せるよう
// periodReviewsError にメッセージを積むだけに留め、krs 等の既存stateには一切触れない
// ことを固定する回帰テスト。
describe("personalOkrUiStore：「全体」タブ（personal_period_reviews）", () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
    Object.values(personalOkrStoreMock).forEach(fn => fn.mockReset());
  });
  afterEach(() => setGuestMode(false));

  it("loadPeriodReviews：正常系はfetchPersonalPeriodReviewsを呼び、periodReviewsに反映する", async () => {
    const row = {
      id: "pr1", member_id: "m1", period_kind: "month" as const, fiscal_year: 2026, quarter: "3Q" as const,
      month: "2026-08-01", is_deleted: false,
    };
    personalOkrStoreMock.fetchPersonalPeriodReviews.mockResolvedValue([row]);
    await usePersonalOkrUiStore.getState().loadPeriodReviews();
    const state = usePersonalOkrUiStore.getState();
    expect(state.periodReviews).toEqual([row]);
    expect(state.periodReviewsLoaded).toBe(true);
    expect(state.periodReviewsError).toBeNull();
  });

  it("🔴 loadPeriodReviews：テーブル未適用（fetch失敗）でも例外を投げず、periodReviewsErrorにメッセージを積むだけでkrs等の既存stateには一切触れない", async () => {
    personalOkrStoreMock.fetchPersonalKrs.mockResolvedValue([dummyKr]);
    await usePersonalOkrUiStore.getState().loadKrs(); // 先にKRタブ側のstateを正常に読み込んでおく
    personalOkrStoreMock.fetchPersonalPeriodReviews.mockRejectedValue(
      Object.assign(new Error('relation "personal_period_reviews" does not exist'), { code: "42P01" }),
    );
    await expect(usePersonalOkrUiStore.getState().loadPeriodReviews()).resolves.toBeUndefined();
    const state = usePersonalOkrUiStore.getState();
    expect(state.periodReviewsLoaded).toBe(true);
    expect(state.periodReviewsLoading).toBe(false);
    expect(state.periodReviewsError).toContain("personal_period_reviews");
    // 🔴 KRタブ側のstateはこの失敗の影響を一切受けない
    expect(state.krs).toEqual([dummyKr]);
    expect(state.krsLoaded).toBe(true);
    expect(state.krsError).toBeNull();
  });

  it("loadPeriodReviews：ゲストはfetchPersonalPeriodReviewsを呼ばず空配列で確定させる", async () => {
    setGuestMode(true);
    await usePersonalOkrUiStore.getState().loadPeriodReviews();
    expect(personalOkrStoreMock.fetchPersonalPeriodReviews).not.toHaveBeenCalled();
    const state = usePersonalOkrUiStore.getState();
    expect(state.periodReviews).toEqual([]);
    expect(state.periodReviewsLoaded).toBe(true);
  });

  it("savePeriodReview：ゲストはupsertPersonalPeriodReviewを呼ばずstateだけ更新する", async () => {
    setGuestMode(true);
    const review = {
      id: "pr1", member_id: "__guest__", period_kind: "quarter" as const, fiscal_year: 2026, quarter: "3Q" as const,
      month: null, is_deleted: false,
    };
    await usePersonalOkrUiStore.getState().savePeriodReview(review);
    expect(personalOkrStoreMock.upsertPersonalPeriodReview).not.toHaveBeenCalled();
    expect(usePersonalOkrUiStore.getState().periodReviews.find(r => r.id === "pr1")).toBeTruthy();
  });

  it("savePeriodReview：非ゲストはupsertPersonalPeriodReviewを呼ぶ（既存経路は不変）", async () => {
    personalOkrStoreMock.upsertPersonalPeriodReview.mockResolvedValue("2026-08-26T00:00:00.000Z");
    const review = {
      id: "pr2", member_id: "m1", period_kind: "month" as const, fiscal_year: 2026, quarter: "3Q" as const,
      month: "2026-08-01", is_deleted: false,
    };
    await usePersonalOkrUiStore.getState().savePeriodReview(review);
    expect(personalOkrStoreMock.upsertPersonalPeriodReview).toHaveBeenCalledTimes(1);
    expect(usePersonalOkrUiStore.getState().periodReviews.find(r => r.id === "pr2")?.updated_at).toBe("2026-08-26T00:00:00.000Z");
  });

  // ===== 実施記録（actual_activities列の可否。仕様書§W2・2026-08-27・v3.105） =====
  describe("ensureActualActivitiesChecked", () => {
    it("列が存在すればactualActivitiesAvailableが'available'になる", async () => {
      personalOkrStoreMock.probeActualActivitiesColumn.mockResolvedValue(true);
      await usePersonalOkrUiStore.getState().ensureActualActivitiesChecked();
      expect(usePersonalOkrUiStore.getState().actualActivitiesAvailable).toBe("available");
    });

    it("🔴 列が存在しなければ'unavailable'になる（W2の合否そのもの）", async () => {
      personalOkrStoreMock.probeActualActivitiesColumn.mockResolvedValue(false);
      await usePersonalOkrUiStore.getState().ensureActualActivitiesChecked();
      expect(usePersonalOkrUiStore.getState().actualActivitiesAvailable).toBe("unavailable");
    });

    it("判定不能（null。ネットワークエラー等）はfail-openで'available'扱いにする", async () => {
      personalOkrStoreMock.probeActualActivitiesColumn.mockResolvedValue(null);
      await usePersonalOkrUiStore.getState().ensureActualActivitiesChecked();
      expect(usePersonalOkrUiStore.getState().actualActivitiesAvailable).toBe("available");
    });

    it("一度確定したら再度呼んでもprobeActualActivitiesColumnを呼び直さない", async () => {
      personalOkrStoreMock.probeActualActivitiesColumn.mockResolvedValue(true);
      await usePersonalOkrUiStore.getState().ensureActualActivitiesChecked();
      await usePersonalOkrUiStore.getState().ensureActualActivitiesChecked();
      expect(personalOkrStoreMock.probeActualActivitiesColumn).toHaveBeenCalledTimes(1);
    });

    it("🔴 ゲストはSupabaseに接続せず'available'に確定させる", async () => {
      setGuestMode(true);
      await usePersonalOkrUiStore.getState().ensureActualActivitiesChecked();
      expect(personalOkrStoreMock.probeActualActivitiesColumn).not.toHaveBeenCalled();
      expect(usePersonalOkrUiStore.getState().actualActivitiesAvailable).toBe("available");
    });
  });

  // ===== 対象期の全KRの月レコード先読み（v3.106・「訪問済みKRだけ」バグの修正） =====
  describe("ensurePeriodMonthsLoaded", () => {
    it("krIdsが空配列ならクエリを投げない", async () => {
      await usePersonalOkrUiStore.getState().ensurePeriodMonthsLoaded([]);
      expect(personalOkrStoreMock.fetchPersonalKrMonthsForKrs).not.toHaveBeenCalled();
    });

    it("未読み込みのKR分だけを1クエリでまとめて取得しmonthsByKrへ反映する", async () => {
      personalOkrStoreMock.fetchPersonalKrMonthsForKrs.mockResolvedValue([
        { id: "m1", personal_kr_id: "kr-a", month: "2026-08-01", month_index: 2, is_deleted: false },
        { id: "m2", personal_kr_id: "kr-b", month: "2026-08-01", month_index: 2, is_deleted: false },
      ]);
      await usePersonalOkrUiStore.getState().ensurePeriodMonthsLoaded(["kr-a", "kr-b"]);
      expect(personalOkrStoreMock.fetchPersonalKrMonthsForKrs).toHaveBeenCalledTimes(1);
      expect(personalOkrStoreMock.fetchPersonalKrMonthsForKrs).toHaveBeenCalledWith(["kr-a", "kr-b"]);
      const state = usePersonalOkrUiStore.getState();
      expect(state.monthsByKr["kr-a"]).toHaveLength(1);
      expect(state.monthsByKr["kr-b"]).toHaveLength(1);
    });

    it("既にmonthsByKrへ読み込み済みのKRは対象から除外する（重複ロード防止）", async () => {
      usePersonalOkrUiStore.setState({
        monthsByKr: { "kr-a": [{ id: "m0", personal_kr_id: "kr-a", month: "2026-07-01", month_index: 1, is_deleted: false }] },
      });
      personalOkrStoreMock.fetchPersonalKrMonthsForKrs.mockResolvedValue([
        { id: "m2", personal_kr_id: "kr-b", month: "2026-08-01", month_index: 2, is_deleted: false },
      ]);
      await usePersonalOkrUiStore.getState().ensurePeriodMonthsLoaded(["kr-a", "kr-b"]);
      expect(personalOkrStoreMock.fetchPersonalKrMonthsForKrs).toHaveBeenCalledWith(["kr-b"]);
    });

    it("対象KRが全て既読み込みならクエリを投げない", async () => {
      usePersonalOkrUiStore.setState({ monthsByKr: { "kr-a": [], "kr-b": [] } });
      await usePersonalOkrUiStore.getState().ensurePeriodMonthsLoaded(["kr-a", "kr-b"]);
      expect(personalOkrStoreMock.fetchPersonalKrMonthsForKrs).not.toHaveBeenCalled();
    });

    it("🔴 対象期を切り替えたら（別のKR集合を渡したら）読み直す", async () => {
      personalOkrStoreMock.fetchPersonalKrMonthsForKrs.mockResolvedValueOnce([
        { id: "m1", personal_kr_id: "kr-a", month: "2026-08-01", month_index: 2, is_deleted: false },
      ]);
      await usePersonalOkrUiStore.getState().ensurePeriodMonthsLoaded(["kr-a"]);
      expect(personalOkrStoreMock.fetchPersonalKrMonthsForKrs).toHaveBeenCalledWith(["kr-a"]);

      // 対象期を切り替えて別のKR集合（kr-c）を渡す
      personalOkrStoreMock.fetchPersonalKrMonthsForKrs.mockResolvedValueOnce([
        { id: "m3", personal_kr_id: "kr-c", month: "2026-09-01", month_index: 3, is_deleted: false },
      ]);
      await usePersonalOkrUiStore.getState().ensurePeriodMonthsLoaded(["kr-c"]);
      expect(personalOkrStoreMock.fetchPersonalKrMonthsForKrs).toHaveBeenCalledTimes(2);
      expect(personalOkrStoreMock.fetchPersonalKrMonthsForKrs).toHaveBeenNthCalledWith(2, ["kr-c"]);
      expect(usePersonalOkrUiStore.getState().monthsByKr["kr-c"]).toHaveLength(1);
    });

    it("🔴 保存直後のローカル値を、後から届く先読みの結果で巻き戻さない", async () => {
      // 先読みが未解決のまま保留される状況を作る（応答が遅いふりをする）
      let resolveFetch!: (rows: unknown[]) => void;
      personalOkrStoreMock.fetchPersonalKrMonthsForKrs.mockReturnValue(
        new Promise(resolve => { resolveFetch = resolve; }),
      );
      const preload = usePersonalOkrUiStore.getState().ensurePeriodMonthsLoaded(["kr-a"]);

      // 先読みが解決する前に、同じKRへ保存が入る（ローカル値が先に確定する）
      personalOkrStoreMock.upsertPersonalKrMonth.mockResolvedValue("2026-08-27T00:00:00.000Z");
      await usePersonalOkrUiStore.getState().saveMonth({
        id: "saved-1", personal_kr_id: "kr-a", month: "2026-08-01", month_index: 2, is_deleted: false,
      });
      expect(usePersonalOkrUiStore.getState().monthsByKr["kr-a"]).toEqual([
        expect.objectContaining({ id: "saved-1", updated_at: "2026-08-27T00:00:00.000Z" }),
      ]);

      // ここで先読み（古いデータ）が遅れて解決する
      resolveFetch([{ id: "stale-1", personal_kr_id: "kr-a", month: "2026-08-01", month_index: 2, is_deleted: false }]);
      await preload;

      // 保存済みのローカル値が古い先読み結果で巻き戻されていないこと
      expect(usePersonalOkrUiStore.getState().monthsByKr["kr-a"]).toEqual([
        expect.objectContaining({ id: "saved-1" }),
      ]);
    });

    it("同時に複数回呼んでも二重に走らせない（同一krIdの多重発火防止）", async () => {
      let resolveFetch!: (rows: unknown[]) => void;
      personalOkrStoreMock.fetchPersonalKrMonthsForKrs.mockReturnValue(
        new Promise(resolve => { resolveFetch = resolve; }),
      );
      const p1 = usePersonalOkrUiStore.getState().ensurePeriodMonthsLoaded(["kr-a"]);
      const p2 = usePersonalOkrUiStore.getState().ensurePeriodMonthsLoaded(["kr-a"]);
      resolveFetch([{ id: "m1", personal_kr_id: "kr-a", month: "2026-08-01", month_index: 2, is_deleted: false }]);
      await Promise.all([p1, p2]);
      expect(personalOkrStoreMock.fetchPersonalKrMonthsForKrs).toHaveBeenCalledTimes(1);
    });

    it("🔴 ゲストはfetchPersonalKrMonthsForKrsを呼ばない", async () => {
      setGuestMode(true);
      await usePersonalOkrUiStore.getState().ensurePeriodMonthsLoaded(["demo-kr-1"]);
      expect(personalOkrStoreMock.fetchPersonalKrMonthsForKrs).not.toHaveBeenCalled();
    });
  });
});
