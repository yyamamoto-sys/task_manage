// src/stores/__tests__/personalOkrUiStoreJudgementFixes.test.ts
//
// 【設計意図】v3.180：判断待ちだった個人OKR領域のストア側の挙動（M55・M61・M65・M66・M67）の回帰テスト。
// 修正前のストアに対して実行し、赤くなることを確認してから修正を入れた（CLAUDE.md 記録に件数を残す）。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setGuestMode } from "../../lib/guestMode";
import type { PersonalOkrAiContextInput } from "../../lib/personalOkr/personalOkrAiContext";
import { ConflictError } from "../../lib/supabase/store";
import { CONFLICT_REFRESHED_MESSAGE } from "../../lib/personalOkr/conflictRefresh";

const m = vi.hoisted(() => ({
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
  fetchPersonalOkrRowById: vi.fn(),
}));
vi.mock("../../lib/supabase/personalOkrStore", () => m);

const analyzeMock = vi.hoisted(() => vi.fn());
vi.mock("../../lib/ai/personalOkrOutlookExtractor", () => ({ analyzePersonalKrOutlook: analyzeMock }));
const reviewDraftMock = vi.hoisted(() => vi.fn());
vi.mock("../../lib/ai/personalOkrReviewDraftExtractor", () => ({ generatePersonalKrReviewDraft: reviewDraftMock }));

import { usePersonalOkrUiStore } from "../personalOkrUiStore";
import { requestPersonalOkrResync } from "../../lib/personalOkr/resyncRegistry";

const INITIAL = usePersonalOkrUiStore.getState();
const store = () => usePersonalOkrUiStore.getState();

const ctx: PersonalOkrAiContextInput = {
  krLabel: "KR1", krKindLabel: "全般", category: null, activity: null, strengthRole: null, weaknessRole: null,
  criteria: null, supplement: null, monthLabel: "8月", positioning: null, activities: null, targetAndEvidence: null,
  risks: null, bandTarget: null, weeks: [], taskSummary: { linkedTaskCount: 0, delayedCount: 0, stagnantCount: 0, blockedCount: 0 },
  recentMemos: [], actualActivities: null,
};
const kr = (id: string, label = id, updated_at = "2026-10-23T00:00:00Z") => ({
  id, member_id: "m1", group_id: "g1", fiscal_year: 2026, quarter: "3Q" as const, kr_kind: "general" as const, label,
  weight_pct: 50, display_order: 1, is_deleted: false, updated_at,
});
const KEY = "kr1::2026-08-01";

beforeEach(() => {
  usePersonalOkrUiStore.setState(INITIAL, true);
  vi.clearAllMocks();
  Object.values(m).forEach(fn => fn.mockReset());
  analyzeMock.mockReset();
  reviewDraftMock.mockReset();
  setGuestMode(false);
});
afterEach(() => setGuestMode(false));

describe("M55：AI成功後のINSERT失敗で結果を捨てない", () => {
  const outlookResult = { lead: "見立て", moves: [], trade: null, band_ai: 70, band_ai_reason: "理由", model: "t" };

  it("runOutlookAnalysis：INSERTが失敗しても結果はstateに載り、保存失敗のエラーが併記される", async () => {
    m.fetchLatestPersonalKrOutlook.mockResolvedValue(null);
    analyzeMock.mockResolvedValue(outlookResult);
    m.insertPersonalKrOutlook.mockRejectedValue(new Error("insert failed"));
    await store().runOutlookAnalysis({ personalKrId: "kr1", month: "2026-08-01", fingerprint: "fp", context: ctx });
    const s = store();
    expect(s.outlookByKrMonth[KEY]?.band_ai).toBe(70);
    expect(s.outlookUnsavedKeys.has(KEY)).toBe(true);
    expect(s.outlookErrorByKey[KEY]).toContain("保存に失敗");
    expect(s.outlookAnalyzingKeys.has(KEY)).toBe(false);
  });

  it("retrySaveOutlook：AIを呼び直さずINSERTだけやり直し、成功すれば未保存印とエラーが消える", async () => {
    m.fetchLatestPersonalKrOutlook.mockResolvedValue(null);
    analyzeMock.mockResolvedValue(outlookResult);
    m.insertPersonalKrOutlook.mockRejectedValueOnce(new Error("insert failed")).mockResolvedValueOnce(undefined);
    await store().runOutlookAnalysis({ personalKrId: "kr1", month: "2026-08-01", fingerprint: "fp", context: ctx });
    await store().retrySaveOutlook("kr1", "2026-08-01");
    expect(analyzeMock).toHaveBeenCalledTimes(1);
    expect(m.insertPersonalKrOutlook).toHaveBeenCalledTimes(2);
    expect(store().outlookUnsavedKeys.has(KEY)).toBe(false);
    expect(store().outlookErrorByKey[KEY]).toBeNull();
  });

  it("runReviewDraft：INSERTが失敗しても下書きはstateに載り、保存失敗が併記される", async () => {
    m.fetchLatestPersonalKrReviewDraft.mockResolvedValue(null);
    reviewDraftMock.mockResolvedValue({ review_text: "振り返り", evidence: [], carryover: [], model: "t" });
    m.insertPersonalKrReviewDraft.mockRejectedValue(new Error("insert failed"));
    await store().runReviewDraft({ personalKrId: "kr1", month: "2026-08-01", fingerprint: "fp", context: ctx, material: {} as never });
    const s = store();
    expect((s.reviewDraftByKrMonth[KEY]?.draft_json as { review_text: string }).review_text).toBe("振り返り");
    expect(s.reviewDraftUnsavedKeys.has(KEY)).toBe(true);
    expect(s.reviewDraftErrorByKey[KEY]).toContain("保存に失敗");
  });

  it("保存に成功したときは従来どおり（未保存印なし・エラーなし）", async () => {
    m.fetchLatestPersonalKrOutlook.mockResolvedValue(null);
    analyzeMock.mockResolvedValue(outlookResult);
    m.insertPersonalKrOutlook.mockResolvedValue(undefined);
    await store().runOutlookAnalysis({ personalKrId: "kr1", month: "2026-08-01", fingerprint: "fp", context: ctx });
    expect(store().outlookUnsavedKeys.has(KEY)).toBe(false);
    expect(store().outlookErrorByKey[KEY]).toBeNull();
  });
});

describe("M61：全体タブの取得エラーを種類で分け、再読み込みできる", () => {
  it("ネットワーク断は『未適用』ではなく原因の見える文言になる（kind=other）", async () => {
    m.fetchPersonalPeriodReviews.mockRejectedValue(new TypeError("Failed to fetch"));
    await store().loadPeriodReviews();
    expect(store().periodReviewsErrorKind).toBe("other");
    expect(store().periodReviewsError).toContain("Failed to fetch");
  });

  it("テーブル未適用は従来どおり（kind=not_applied・テーブル名を含むメッセージ）", async () => {
    m.fetchPersonalPeriodReviews.mockRejectedValue(
      Object.assign(new Error('relation "personal_period_reviews" does not exist'), { code: "42P01" }),
    );
    await store().loadPeriodReviews();
    expect(store().periodReviewsErrorKind).toBe("not_applied");
    expect(store().periodReviewsError).toContain("personal_period_reviews");
  });

  it("reloadPeriodReviews：エラーを消して取り直し、成功すれば一覧が入る", async () => {
    m.fetchPersonalPeriodReviews.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce([{ id: "pr1" }]);
    await store().loadPeriodReviews();
    await store().reloadPeriodReviews();
    expect(store().periodReviewsError).toBeNull();
    expect(store().periodReviewsErrorKind).toBeNull();
    expect(store().periodReviews).toEqual([{ id: "pr1" }]);
  });
});

describe("M65：復帰時の全件再取得に個人OKRも乗る", () => {
  async function setupLoaded() {
    m.fetchPersonalKrs.mockResolvedValue([kr("a", "A"), kr("b", "B")]);
    await store().loadKrs();
    m.fetchPersonalKrMonths.mockResolvedValue([]);
    m.fetchPersonalKrWeeks.mockResolvedValue([]);
    m.fetchPersonalKrMemos.mockResolvedValue([]);
    await store().ensureKrDetailLoaded("a");
    await store().ensureKrDetailLoaded("b");
    vi.clearAllMocks();
  }

  it("resyncAll：別端末で変わったKR名を取り直す・開いているKRの詳細だけ再取得・他のKRは読み込み済み印を外す", async () => {
    await setupLoaded();
    m.fetchPersonalKrs.mockResolvedValue([kr("a", "A（他端末で変更）", "2026-10-23T05:00:00Z"), kr("b", "B")]);
    m.fetchPersonalKrMonthsForKrs.mockResolvedValue([]);
    m.fetchPersonalKrWeeks.mockResolvedValue([]);
    m.fetchPersonalKrMemos.mockResolvedValue([]);
    await store().resyncAll();
    const s = store();
    expect(s.krs.find(k => k.id === "a")?.label).toBe("A（他端末で変更）");
    // 最後に開いたのは b。b だけ詳細を再取得し、a は次に開いたとき取り直す
    expect(m.fetchPersonalKrWeeks).toHaveBeenCalledTimes(1);
    expect(m.fetchPersonalKrWeeks).toHaveBeenCalledWith("b");
    expect(s.detailLoadedKrIds.has("b")).toBe(true);
    expect(s.detailLoadedKrIds.has("a")).toBe(false);
  });

  it("resyncAll：KR一覧が未読み込み・ゲストなら問い合わせない", async () => {
    await store().resyncAll();
    expect(m.fetchPersonalKrs).not.toHaveBeenCalled();
    await setupLoaded();
    setGuestMode(true);
    await store().resyncAll();
    expect(m.fetchPersonalKrs).not.toHaveBeenCalled();
  });

  it("resyncAll：失敗しても今の表示は壊さず、例外も投げない", async () => {
    await setupLoaded();
    m.fetchPersonalKrs.mockRejectedValue(new Error("offline"));
    await expect(store().resyncAll()).resolves.toBeUndefined();
    expect(store().krs.map(k => k.id)).toEqual(["a", "b"]);
    expect(store().krsError).toBeNull();
  });

  it("App側の合図（requestPersonalOkrResync）でストアの再取得が走る", async () => {
    await setupLoaded();
    m.fetchPersonalKrs.mockResolvedValue([kr("a"), kr("b")]);
    m.fetchPersonalKrMonthsForKrs.mockResolvedValue([]);
    requestPersonalOkrResync();
    await vi.waitFor(() => expect(m.fetchPersonalKrs).toHaveBeenCalledTimes(1));
  });
});

describe("M66：保存の競合時に該当行だけ取り直し、最新を見せる", () => {
  it("saveMonth：ConflictErrorなら該当の月だけ取り直してstateを最新にし、案内文のエラーを投げる", async () => {
    const mine = { id: "mo1", personal_kr_id: "kr1", month: "2026-08-01", month_index: 2 as const, positioning: "自分の入力", is_deleted: false, updated_at: "2026-10-23T00:00:00Z" };
    const latest = { ...mine, positioning: "他の人の内容", updated_at: "2026-10-23T09:00:00Z" };
    usePersonalOkrUiStore.setState({ monthsByKr: { kr1: [mine] } });
    m.upsertPersonalKrMonth.mockRejectedValue(new ConflictError("personal_kr_months", "mo1"));
    m.fetchPersonalOkrRowById.mockResolvedValue(latest);
    await expect(store().saveMonth({ ...mine, positioning: "自分の入力（編集中）" }, mine.updated_at)).rejects.toThrow(CONFLICT_REFRESHED_MESSAGE);
    expect(m.fetchPersonalOkrRowById).toHaveBeenCalledWith("personal_kr_months", "mo1");
    expect(store().monthsByKr.kr1[0].updated_at).toBe("2026-10-23T09:00:00Z");
    expect(store().monthsByKr.kr1[0].positioning).toBe("他の人の内容");
  });

  it("saveKr：同様にKR行を取り直す", async () => {
    usePersonalOkrUiStore.setState({ krs: [kr("kr1", "旧")] });
    m.upsertPersonalKr.mockRejectedValue(new ConflictError("personal_krs", "kr1"));
    m.fetchPersonalOkrRowById.mockResolvedValue(kr("kr1", "最新", "2026-10-23T09:00:00Z"));
    await expect(store().saveKr(kr("kr1", "編集中"), "2026-10-23T00:00:00Z")).rejects.toBeInstanceOf(ConflictError);
    expect(store().krs[0].label).toBe("最新");
  });

  it("競合以外のエラーは取り直さずそのまま投げる", async () => {
    m.upsertPersonalKrMonth.mockRejectedValue(new Error("network"));
    await expect(store().saveMonth({ id: "mo1", personal_kr_id: "kr1", month: "2026-08-01", month_index: 2, is_deleted: false })).rejects.toThrow("network");
    expect(m.fetchPersonalOkrRowById).not.toHaveBeenCalled();
  });

  it("取り直しに失敗しても競合のエラーは投げる（stateは触らない）", async () => {
    const mine = { id: "mo1", personal_kr_id: "kr1", month: "2026-08-01", month_index: 2 as const, is_deleted: false, updated_at: "2026-10-23T00:00:00Z" };
    usePersonalOkrUiStore.setState({ monthsByKr: { kr1: [mine] } });
    m.upsertPersonalKrMonth.mockRejectedValue(new ConflictError("personal_kr_months", "mo1"));
    m.fetchPersonalOkrRowById.mockRejectedValue(new Error("offline"));
    await expect(store().saveMonth(mine, mine.updated_at)).rejects.toBeInstanceOf(ConflictError);
    expect(store().monthsByKr.kr1[0]).toEqual(mine);
  });
});

describe("M67：週の紐づけ一覧が読めないことを呼び出し側へ伝える", () => {
  it("読めなければfalse（未取得のまま残す）・読めればtrue", async () => {
    m.fetchPersonalKrWeekTasks.mockRejectedValueOnce(new Error("offline"));
    expect(await store().ensureWeekTasksLoaded("w1")).toBe(false);
    expect(store().weekTasksByWeek.w1).toBeUndefined();
    m.fetchPersonalKrWeekTasks.mockResolvedValueOnce([{ week_id: "w1", task_id: "t1" }]);
    expect(await store().ensureWeekTasksLoaded("w1")).toBe(true);
    expect(store().weekTasksByWeek.w1).toHaveLength(1);
  });
  it("取得済みなら再取得せずtrue", async () => {
    usePersonalOkrUiStore.setState({ weekTasksByWeek: { w1: [] } });
    expect(await store().ensureWeekTasksLoaded("w1")).toBe(true);
    expect(m.fetchPersonalKrWeekTasks).not.toHaveBeenCalled();
  });
});
