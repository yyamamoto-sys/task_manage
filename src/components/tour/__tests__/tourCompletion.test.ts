import { describe, it, expect } from "vitest";
import {
  TOUR_COMPLETED_LEGACY_KEY, TOUR_COMPLETED_GUEST_KEY, tourCompletedKey,
  migrateLegacyTourCompleted, loadTourCompleted, markTourCompleted, isTourCompleted, unmarkTourCompleted,
  markTourCompletedWithFallback, isTourCompletedWithFallback, unmarkTourCompletedWithFallback,
  type TourStorage,
} from "../tourCompletion";
import { GUEST_MEMBER_ID } from "../../../lib/guestMode";

class MemoryStorage implements TourStorage {
  map = new Map<string, string>();
  getItem(k: string) { return this.map.get(k) ?? null; }
  setItem(k: string, v: string) { this.map.set(k, v); }
  removeItem(k: string) { this.map.delete(k); }
}

const legacy = (s: MemoryStorage, v: object) => s.setItem(TOUR_COMPLETED_LEGACY_KEY, JSON.stringify(v));

describe("tourCompletedKey", () => {
  it("メンバーIDごとに別のキー・ゲストは固定キー・未確定は null", () => {
    expect(tourCompletedKey("m1")).toBe("tour_completed_v1:m1");
    expect(tourCompletedKey("m2")).not.toBe(tourCompletedKey("m1"));
    expect(tourCompletedKey(GUEST_MEMBER_ID)).toBe(TOUR_COMPLETED_GUEST_KEY);
    expect(tourCompletedKey(null)).toBeNull();
    expect(tourCompletedKey("")).toBeNull();
  });
});

describe("旧キーの引き継ぎ", () => {
  it("更新後に最初に開いた人が旧キーを引き継ぎ、旧キーは消える", () => {
    const s = new MemoryStorage();
    legacy(s, { "first-time": true });
    expect(isTourCompleted(s, "m1", "first-time")).toBe(true);
    expect(s.getItem(TOUR_COMPLETED_LEGACY_KEY)).toBeNull();
    expect(s.getItem("tour_completed_v1:m1")).toBe(JSON.stringify({ "first-time": true }));
  });

  it("2人目には引き継がれず、初回ツアーが出る", () => {
    const s = new MemoryStorage();
    legacy(s, { "first-time": true });
    isTourCompleted(s, "m1", "first-time");
    expect(isTourCompleted(s, "m2", "first-time")).toBe(false);
  });

  it("新キーが既にあれば旧キーで上書きしない（旧キーも残す）", () => {
    const s = new MemoryStorage();
    s.setItem("tour_completed_v1:m1", JSON.stringify({ okr: true }));
    legacy(s, { "first-time": true });
    migrateLegacyTourCompleted(s, "m1");
    expect(s.getItem("tour_completed_v1:m1")).toBe(JSON.stringify({ okr: true }));
    expect(s.getItem(TOUR_COMPLETED_LEGACY_KEY)).not.toBeNull();
  });

  it("ゲストは旧キーを引き継がない", () => {
    const s = new MemoryStorage();
    legacy(s, { "first-time": true });
    expect(isTourCompleted(s, GUEST_MEMBER_ID, "first-time")).toBe(false);
    expect(s.getItem(TOUR_COMPLETED_LEGACY_KEY)).not.toBeNull();
  });
});

describe("メンバーIDが未確定のとき", () => {
  it("完了済み扱い（自動開始しない）で、何も読み書きしない", () => {
    const s = new MemoryStorage();
    legacy(s, {});
    expect(isTourCompleted(s, null, "first-time")).toBe(true);
    expect(loadTourCompleted(s, null)).toBeNull();
    markTourCompleted(s, null, "first-time");
    expect([...s.map.keys()]).toEqual([TOUR_COMPLETED_LEGACY_KEY]);
  });
});

describe("既読の記録", () => {
  it("自分のキーにだけ書き、他のツアーの既読を残す", () => {
    const s = new MemoryStorage();
    markTourCompleted(s, "m1", "first-time");
    markTourCompleted(s, "m1", "okr");
    expect(isTourCompleted(s, "m1", "first-time")).toBe(true);
    expect(isTourCompleted(s, "m1", "okr")).toBe(true);
    expect(isTourCompleted(s, "m2", "first-time")).toBe(false);
  });

  it("壊れた値は空として扱う", () => {
    const s = new MemoryStorage();
    s.setItem("tour_completed_v1:m1", "{broken");
    expect(isTourCompleted(s, "m1", "first-time")).toBe(false);
  });
});

describe("unmarkTourCompleted（管理者の「自動表示をもう一度試す」）", () => {
  it("そのツアーの既読だけを消し、ほかのツアー・ほかのメンバーの既読は残す", () => {
    const s = new MemoryStorage();
    markTourCompleted(s, "m1", "first-time");
    markTourCompleted(s, "m1", "feedback-intro");
    markTourCompleted(s, "m2", "feedback-intro");
    unmarkTourCompleted(s, "m1", "feedback-intro");
    expect(isTourCompleted(s, "m1", "feedback-intro")).toBe(false);
    expect(isTourCompleted(s, "m1", "first-time")).toBe(true);
    expect(isTourCompleted(s, "m2", "feedback-intro")).toBe(true);
  });
  it("未読のものを消しても何も書かない・メンバーID未確定なら何もしない", () => {
    const s = new MemoryStorage();
    unmarkTourCompleted(s, "m1", "feedback-intro");
    expect(s.map.size).toBe(0);
    unmarkTourCompleted(s, null, "feedback-intro");
    expect(s.map.size).toBe(0);
  });
});

describe("保存できない環境での代替（v3.186）", () => {
  // 読めるが書けない（容量超過など）。以前は既読が残らず、お知らせツアーが3秒ごとに始まり直した
  class WriteFailStorage extends MemoryStorage {
    setItem(): void { throw new Error("QuotaExceededError"); }
  }

  it("保存に失敗しても、そのページを開いている間は既読として扱う", () => {
    const s = new WriteFailStorage();
    const memory = new Set<string>();
    expect(isTourCompletedWithFallback(s, memory, "m1", "feedback-intro")).toBe(false);
    expect(() => markTourCompletedWithFallback(s, memory, "m1", "feedback-intro")).not.toThrow();
    expect(isTourCompletedWithFallback(s, memory, "m1", "feedback-intro")).toBe(true);
    expect(isTourCompletedWithFallback(s, memory, "m2", "feedback-intro")).toBe(false);
    expect(isTourCompletedWithFallback(s, memory, "m1", "first-time")).toBe(false);
  });

  it("正常に保存できる環境では従来どおり localStorage に残る", () => {
    const s = new MemoryStorage();
    markTourCompletedWithFallback(s, new Set(), "m1", "first-time");
    expect(isTourCompletedWithFallback(s, new Set(), "m1", "first-time")).toBe(true);
  });

  it("既読を消す操作はメモリ上の記録も消す（管理者の再試行）", () => {
    const s = new MemoryStorage();
    const memory = new Set<string>();
    markTourCompletedWithFallback(s, memory, "m1", "feedback-intro");
    unmarkTourCompletedWithFallback(s, memory, "m1", "feedback-intro");
    expect(isTourCompletedWithFallback(s, memory, "m1", "feedback-intro")).toBe(false);
  });

  it("メンバーID未確定は従来どおり既読扱い・何も書かない", () => {
    const s = new MemoryStorage();
    expect(isTourCompletedWithFallback(s, new Set(), null, "first-time")).toBe(true);
    markTourCompletedWithFallback(s, new Set(), null, "first-time");
    expect(s.map.size).toBe(0);
  });
});
