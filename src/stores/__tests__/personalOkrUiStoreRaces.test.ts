// src/stores/__tests__/personalOkrUiStoreRaces.test.ts
//
// 【設計意図】
// 個人OKRストアの取得競合・ユーザー切替の回帰テスト（巡回53回目・D OKR サブ領域⑤）。
//   - 複数KRの詳細を同時に取得しても取得中の印が互いに上書きしない
//   - 取得中に入った保存を、遅れて届いた取得結果で巻き戻さない
//   - AI解析・下書き生成は、DB確認の待ち時間中の2回目の呼び出しでも二重に走らない
//   - 取得中に別経路で載った解析結果を、遅れて届いた古い取得結果（null）で消さない
//   - サインアウト・ユーザー切替でストアを空に戻し、前のユーザーの応答は捨てる
//   - 週の紐づけ一覧の取得失敗を「空」で確定させない（追加・解除は中止する）

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setGuestMode } from "../../lib/guestMode";
import type { PersonalOkrAiContextInput } from "../../lib/personalOkr/personalOkrAiContext";
import type { PersonalKrMonth } from "../../lib/localData/types";

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
vi.mock("../../lib/ai/personalOkrOutlookExtractor", () => ({ analyzePersonalKrOutlook: analyzeMock }));
const reviewDraftMock = vi.hoisted(() => vi.fn());
vi.mock("../../lib/ai/personalOkrReviewDraftExtractor", () => ({ generatePersonalKrReviewDraft: reviewDraftMock }));

type AuthCb = (session: { user: { id: string; is_anonymous?: boolean } } | null, event: string) => void;
const auth = vi.hoisted(() => ({ cb: null as null | ((s: unknown, e: string) => void) }));
vi.mock("../../lib/supabase/auth", () => ({
  onAuthStateChange: (cb: (s: unknown, e: string) => void) => { auth.cb = cb; return { unsubscribe: () => {} }; },
}));
const emitAuth: AuthCb = (session, event) => auth.cb?.(session, event);

import { usePersonalOkrUiStore, resetPersonalOkrUiStore } from "../personalOkrUiStore";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const tick = () => new Promise<void>(r => setTimeout(r, 0));

const kr = (id: string) => ({
  id, member_id: "m1", group_id: "g1", fiscal_year: 2026, quarter: "4Q" as const,
  kr_kind: "general" as const, label: id, weight_pct: 50, display_order: 1, is_deleted: false,
});
const month = (id: string, krId: string, updatedAt: string): PersonalKrMonth => ({
  id, personal_kr_id: krId, month: "2026-10-01", month_index: 1, is_deleted: false, updated_at: updatedAt,
} as PersonalKrMonth);

const dummyContext: PersonalOkrAiContextInput = {
  krLabel: "KR1", krKindLabel: "全般", category: null, activity: null, strengthRole: null,
  weaknessRole: null, criteria: null, supplement: null, monthLabel: "10月",
  positioning: null, activities: null, targetAndEvidence: null, risks: null, bandTarget: null,
  weeks: [], taskSummary: { linkedTaskCount: 0, delayedCount: 0, stagnantCount: 0, blockedCount: 0 },
  recentMemos: [], actualActivities: null,
};

describe("personalOkrUiStore：取得競合・ユーザー切替", () => {
  beforeEach(() => {
    resetPersonalOkrUiStore();
    vi.clearAllMocks();
    Object.values(personalOkrStoreMock).forEach(fn => fn.mockReset());
    analyzeMock.mockReset();
    reviewDraftMock.mockReset();
    setGuestMode(false);
  });
  afterEach(() => setGuestMode(false));

  it("複数KRの詳細を同時に取得しても、取得中の印が互いに上書きしない", async () => {
    const a = deferred<PersonalKrMonth[]>();
    const b = deferred<PersonalKrMonth[]>();
    personalOkrStoreMock.fetchPersonalKrMonths.mockImplementation((id: string) => (id === "A" ? a.promise : b.promise));
    personalOkrStoreMock.fetchPersonalKrWeeks.mockResolvedValue([]);
    personalOkrStoreMock.fetchPersonalKrMemos.mockResolvedValue([]);
    const s = usePersonalOkrUiStore.getState();
    const pa = s.ensureKrDetailLoaded("A");
    const pb = s.ensureKrDetailLoaded("B");
    await tick();
    expect([...usePersonalOkrUiStore.getState().detailLoadingKrIds].sort()).toEqual(["A", "B"]);
    a.resolve([]);
    await pa;
    // Aが終わってもBはまだ取得中として残る
    expect([...usePersonalOkrUiStore.getState().detailLoadingKrIds]).toEqual(["B"]);
    b.resolve([]);
    await pb;
    expect(usePersonalOkrUiStore.getState().detailLoadingKrIds.size).toBe(0);
  });

  it("同じKRの詳細取得は重複して発火しない（別KRの取得が間に入っても）", async () => {
    const a = deferred<PersonalKrMonth[]>();
    personalOkrStoreMock.fetchPersonalKrMonths.mockImplementation((id: string) => (id === "A" ? a.promise : Promise.resolve([])));
    personalOkrStoreMock.fetchPersonalKrWeeks.mockResolvedValue([]);
    personalOkrStoreMock.fetchPersonalKrMemos.mockResolvedValue([]);
    const s = usePersonalOkrUiStore.getState();
    const p1 = s.ensureKrDetailLoaded("A");
    void s.ensureKrDetailLoaded("B");
    const p2 = s.ensureKrDetailLoaded("A");
    a.resolve([]);
    await Promise.all([p1, p2]);
    const callsForA = personalOkrStoreMock.fetchPersonalKrMonths.mock.calls.filter(c => c[0] === "A").length;
    expect(callsForA).toBe(1);
  });

  it("詳細の取得中に入った保存を、遅れて届いた取得結果（保存前の内容）で巻き戻さない", async () => {
    const fetched = deferred<PersonalKrMonth[]>();
    personalOkrStoreMock.fetchPersonalKrMonths.mockReturnValue(fetched.promise);
    personalOkrStoreMock.fetchPersonalKrWeeks.mockResolvedValue([]);
    personalOkrStoreMock.fetchPersonalKrMemos.mockResolvedValue([]);
    personalOkrStoreMock.upsertPersonalKrMonth.mockResolvedValue("2026-10-10T00:00:10.000Z");
    const load = usePersonalOkrUiStore.getState().ensureKrDetailLoaded("A");
    await tick();
    await usePersonalOkrUiStore.getState().saveMonth({ ...month("m1", "A", "2026-10-10T00:00:00.000Z"), positioning: "保存した内容" } as PersonalKrMonth);
    // 取得は保存より前の時点のスナップショットを返す
    fetched.resolve([{ ...month("m1", "A", "2026-10-10T00:00:00.000Z"), positioning: "古い内容" } as PersonalKrMonth]);
    await load;
    const m = usePersonalOkrUiStore.getState().monthsByKr["A"].find(x => x.id === "m1");
    expect(m?.positioning).toBe("保存した内容");
    expect(m?.updated_at).toBe("2026-10-10T00:00:10.000Z");
  });

  it("runOutlookAnalysis：DB確認の待ち時間中に2回呼ばれても、AIは1回しか呼ばれない", async () => {
    const fetching = deferred<null>();
    personalOkrStoreMock.fetchLatestPersonalKrOutlook.mockReturnValue(fetching.promise);
    analyzeMock.mockResolvedValue({ lead: "見立て", moves: [], trade: null, band_ai: 70, band_ai_reason: "理由", model: "m" });
    const params = { personalKrId: "kr1", month: "2026-10-01", fingerprint: "fp", context: dummyContext };
    const p1 = usePersonalOkrUiStore.getState().runOutlookAnalysis(params);
    const p2 = usePersonalOkrUiStore.getState().runOutlookAnalysis(params);
    fetching.resolve(null);
    await Promise.all([p1, p2]);
    expect(analyzeMock).toHaveBeenCalledTimes(1);
  });

  it("runReviewDraft：DB確認の待ち時間中に2回呼ばれても、AIは1回しか呼ばれない", async () => {
    const fetching = deferred<null>();
    personalOkrStoreMock.fetchLatestPersonalKrReviewDraft.mockReturnValue(fetching.promise);
    reviewDraftMock.mockResolvedValue({ review_text: "下書き", evidence: [], carryover: [], model: "m" });
    const params = {
      personalKrId: "kr1", month: "2026-10-01", fingerprint: "fp", context: dummyContext,
      material: {} as never,
    };
    const p1 = usePersonalOkrUiStore.getState().runReviewDraft(params);
    const p2 = usePersonalOkrUiStore.getState().runReviewDraft(params);
    fetching.resolve(null);
    await Promise.all([p1, p2]);
    expect(reviewDraftMock).toHaveBeenCalledTimes(1);
  });

  it("ensureOutlookLoaded：取得中に解析結果が載っていたら、遅れて届いた取得結果（null）で消さない", async () => {
    const fetching = deferred<null>();
    personalOkrStoreMock.fetchLatestPersonalKrOutlook.mockReturnValue(fetching.promise);
    analyzeMock.mockResolvedValue({ lead: "見立て", moves: [], trade: null, band_ai: 70, band_ai_reason: "理由", model: "m" });
    // 自動の読み込み（取得待ち）
    const ensure = usePersonalOkrUiStore.getState().ensureOutlookLoaded("kr1", "2026-10-01");
    await tick();
    // 取得結果が届く前に、別経路で解析結果が載った状態を作る
    usePersonalOkrUiStore.setState(st => ({
      outlookByKrMonth: { ...st.outlookByKrMonth, "kr1::2026-10-01": { id: "o1", lead: "新しい解析" } as never },
      outlookFetchedKeys: new Set(st.outlookFetchedKeys).add("kr1::2026-10-01"),
    }));
    fetching.resolve(null);
    await ensure;
    expect(usePersonalOkrUiStore.getState().outlookByKrMonth["kr1::2026-10-01"]).not.toBeNull();
  });

  it("サインアウトでストアが空に戻る", async () => {
    emitAuth({ user: { id: "u1" } }, "INITIAL_SESSION");
    personalOkrStoreMock.fetchPersonalKrs.mockResolvedValue([kr("k1")]);
    await usePersonalOkrUiStore.getState().loadKrs();
    expect(usePersonalOkrUiStore.getState().krs.length).toBe(1);
    emitAuth(null, "SIGNED_OUT");
    expect(usePersonalOkrUiStore.getState().krs).toEqual([]);
    expect(usePersonalOkrUiStore.getState().krsLoaded).toBe(false);
  });

  it("別のユーザーでログインし直したらストアが空に戻る（同じユーザーの再通知では戻らない）", async () => {
    emitAuth({ user: { id: "u1" } }, "SIGNED_IN");
    personalOkrStoreMock.fetchPersonalKrs.mockResolvedValue([kr("k1")]);
    await usePersonalOkrUiStore.getState().loadKrs();
    emitAuth({ user: { id: "u1" } }, "SIGNED_IN");
    expect(usePersonalOkrUiStore.getState().krs.length).toBe(1);
    emitAuth({ user: { id: "u2" } }, "SIGNED_IN");
    expect(usePersonalOkrUiStore.getState().krs).toEqual([]);
  });

  it("ゲストのサンプルはサインアウトイベントでは消えない", async () => {
    setGuestMode(true);
    await usePersonalOkrUiStore.getState().loadKrs();
    const before = usePersonalOkrUiStore.getState().krs.length;
    expect(before).toBeGreaterThan(0);
    emitAuth(null, "SIGNED_OUT");
    expect(usePersonalOkrUiStore.getState().krs.length).toBe(before);
  });

  it("前のユーザーの取得応答は、リセット後に届いても新しい状態へ載らない", async () => {
    const pending = deferred<ReturnType<typeof kr>[]>();
    personalOkrStoreMock.fetchPersonalKrs.mockReturnValue(pending.promise);
    const load = usePersonalOkrUiStore.getState().loadKrs();
    resetPersonalOkrUiStore();
    pending.resolve([kr("old-user-kr")]);
    await load;
    expect(usePersonalOkrUiStore.getState().krs).toEqual([]);
    expect(usePersonalOkrUiStore.getState().krsLoaded).toBe(false);
  });

  it("週の紐づけ一覧の取得に失敗したら、空で確定させず次の呼び出しで再取得する", async () => {
    personalOkrStoreMock.fetchPersonalKrWeekTasks.mockRejectedValueOnce(new Error("net"));
    await usePersonalOkrUiStore.getState().ensureWeekTasksLoaded("w1");
    expect(usePersonalOkrUiStore.getState().weekTasksByWeek["w1"]).toBeUndefined();
    personalOkrStoreMock.fetchPersonalKrWeekTasks.mockResolvedValueOnce([{ week_id: "w1", task_id: "t1" }]);
    await usePersonalOkrUiStore.getState().ensureWeekTasksLoaded("w1");
    expect(usePersonalOkrUiStore.getState().weekTasksByWeek["w1"]).toEqual([{ week_id: "w1", task_id: "t1" }]);
  });

  it("紐づけ一覧を読み込めない週への追加・解除は中止する（DBへ書かない）", async () => {
    personalOkrStoreMock.fetchPersonalKrWeekTasks.mockRejectedValue(new Error("net"));
    await expect(usePersonalOkrUiStore.getState().linkWeekTask("w1", "t1")).rejects.toThrow("読み込めなかった");
    await expect(usePersonalOkrUiStore.getState().unlinkWeekTask("w1", "t1")).rejects.toThrow("読み込めなかった");
    expect(personalOkrStoreMock.insertPersonalKrWeekTask).not.toHaveBeenCalled();
    expect(personalOkrStoreMock.deletePersonalKrWeekTask).not.toHaveBeenCalled();
  });

  it("deleteKr：削除したKRの月・週・メモ・紐づけのキャッシュも消す", async () => {
    usePersonalOkrUiStore.setState({
      krs: [kr("k1") as never],
      monthsByKr: { k1: [month("m1", "k1", "2026-10-01T00:00:00Z")] },
      weeksByKr: { k1: [{ id: "w1", personal_kr_id: "k1" } as never] },
      memosByKr: { k1: [] },
      weekTasksByWeek: { w1: [{ week_id: "w1", task_id: "t1" }] },
      detailLoadedKrIds: new Set(["k1"]),
    });
    personalOkrStoreMock.softDeletePersonalKr.mockResolvedValue(undefined);
    await usePersonalOkrUiStore.getState().deleteKr("k1", "m1");
    const st = usePersonalOkrUiStore.getState();
    expect(st.krs).toEqual([]);
    expect(st.monthsByKr["k1"]).toBeUndefined();
    expect(st.weeksByKr["k1"]).toBeUndefined();
    expect(st.memosByKr["k1"]).toBeUndefined();
    expect(st.weekTasksByWeek["w1"]).toBeUndefined();
    expect(st.detailLoadedKrIds.has("k1")).toBe(false);
  });
});
