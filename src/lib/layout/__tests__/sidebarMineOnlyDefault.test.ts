// src/lib/layout/__tests__/sidebarMineOnlyDefault.test.ts
import { describe, it, expect } from "vitest";
import { resolveInitialSidebarMineOnly } from "../sidebarMineOnlyDefault";

describe("resolveInitialSidebarMineOnly", () => {
  it("未設定・自分0件／全件0件 → 自分のまま（救う対象が無い）", () => {
    expect(resolveInitialSidebarMineOnly(null, 0, 0)).toBe(true);
  });

  it("未設定・自分0件／全件2件 → 全件を初期値にする（招待受諾者・新入社員の救済）", () => {
    expect(resolveInitialSidebarMineOnly(null, 0, 2)).toBe(false);
  });

  it("未設定・自分3件／全件5件 → 自分のまま（既定どおり）", () => {
    expect(resolveInitialSidebarMineOnly(null, 3, 5)).toBe(true);
  });

  it("ユーザーが明示的に「自分」を選んだ後は、自分0件／全件2件でも自分のまま", () => {
    expect(resolveInitialSidebarMineOnly("1", 0, 2)).toBe(true);
  });

  it("ユーザーが明示的に「全件」を選んだ後は、自分3件／全件5件でも全件のまま", () => {
    expect(resolveInitialSidebarMineOnly("0", 3, 5)).toBe(false);
  });
});
