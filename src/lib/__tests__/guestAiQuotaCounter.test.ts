import { describe, it, expect } from "vitest";
import {
  GUEST_AI_DAILY_LIMIT,
  resolveGuestAiUsedCount,
  resolveGuestAiRemaining,
  getGuestAiUsedToday,
  getGuestAiRemainingToday,
  recordGuestAiUse,
} from "../guestAiQuotaCounter";

// resolveGuestAiUsedCount/resolveGuestAiRemaining は localStorage に依存しない純粋関数のため、
// ここで直接テストする（getGuestAiUsedToday等のlocalStorage依存部分は、vitest.config.tsが
// environment:"node"のためlocalStorageが無く未検証。src/lib/chunkSizeGate.test.tsと同じ方針）。

describe("resolveGuestAiUsedCount：レコードから本日の利用回数を導く", () => {
  it("レコードが無ければ0を返す", () => {
    expect(resolveGuestAiUsedCount(null, "2026-08-07")).toBe(0);
  });

  it("日付が今日と一致すればレコードのcountを返す", () => {
    expect(resolveGuestAiUsedCount({ date: "2026-08-07", count: 2 }, "2026-08-07")).toBe(2);
  });

  it("日付跨ぎ（レコードの日付が今日と異なる）なら0に戻る", () => {
    expect(resolveGuestAiUsedCount({ date: "2026-08-06", count: 3 }, "2026-08-07")).toBe(0);
  });

  it("壊れたレコード（countが負）でも0未満は返さない", () => {
    expect(resolveGuestAiUsedCount({ date: "2026-08-07", count: -1 }, "2026-08-07")).toBe(0);
  });

  it("加算後の値をそのまま渡せば正しく反映される（recordGuestAiUseの内部ロジックと同じ計算）", () => {
    const used = resolveGuestAiUsedCount({ date: "2026-08-07", count: 1 }, "2026-08-07");
    const next = { date: "2026-08-07", count: used + 1 };
    expect(resolveGuestAiUsedCount(next, "2026-08-07")).toBe(2);
  });
});

describe("resolveGuestAiRemaining：残り回数（0未満にならない）", () => {
  it("上限未満なら差分を返す", () => {
    expect(resolveGuestAiRemaining(1, 3)).toBe(2);
  });

  it("上限ちょうどなら0", () => {
    expect(resolveGuestAiRemaining(3, 3)).toBe(0);
  });

  it("上限を超えていても負にはならない", () => {
    expect(resolveGuestAiRemaining(5, 3)).toBe(0);
  });

  it("limit省略時はGUEST_AI_DAILY_LIMIT（既定3）を使う", () => {
    expect(resolveGuestAiRemaining(0)).toBe(GUEST_AI_DAILY_LIMIT);
  });
});

describe("localStorage利用不可時の安全性（vitestのnode環境にはlocalStorageが無い）", () => {
  it("getGuestAiUsedTodayは例外を投げず0を返す", () => {
    expect(getGuestAiUsedToday()).toBe(0);
  });

  it("getGuestAiRemainingTodayは例外を投げず上限値を返す", () => {
    expect(getGuestAiRemainingToday()).toBe(GUEST_AI_DAILY_LIMIT);
  });

  it("recordGuestAiUseは例外を投げずに黙って無視する", () => {
    expect(() => recordGuestAiUse()).not.toThrow();
  });
});
