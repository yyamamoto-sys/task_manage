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
  recentMemos: [],
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
