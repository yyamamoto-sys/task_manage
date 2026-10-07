import { describe, it, expect } from "vitest";
import {
  TOUR_COMPLETED_LEGACY_KEY, TOUR_COMPLETED_GUEST_KEY, tourCompletedKey,
  migrateLegacyTourCompleted, loadTourCompleted, markTourCompleted, isTourCompleted,
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
