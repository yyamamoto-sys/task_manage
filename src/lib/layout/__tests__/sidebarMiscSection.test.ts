// src/lib/layout/__tests__/sidebarMiscSection.test.ts
import { describe, it, expect } from "vitest";
import { shouldGroupSidebarMiscButtons } from "../sidebarMiscSection";

describe("shouldGroupSidebarMiscButtons", () => {
  it("0件は包まない", () => {
    expect(shouldGroupSidebarMiscButtons(0)).toBe(false);
  });

  it("1件（ゲスト＝ガイドのみ）は包まない", () => {
    expect(shouldGroupSidebarMiscButtons(1)).toBe(false);
  });

  it("2件以上（一般メンバー＝ガイド・設定・招待コード）は包む", () => {
    expect(shouldGroupSidebarMiscButtons(2)).toBe(true);
    expect(shouldGroupSidebarMiscButtons(3)).toBe(true);
  });
});
