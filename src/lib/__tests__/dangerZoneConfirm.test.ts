import { describe, it, expect } from "vitest";
import { isNameConfirmed } from "../dangerZoneConfirm";

describe("isNameConfirmed", () => {
  it("完全一致なら true", () => {
    expect(isNameConfirmed("EGG", "EGG")).toBe(true);
  });

  it("前後の空白はトリムして許容する", () => {
    expect(isNameConfirmed("  EGG  ", "EGG")).toBe(true);
  });

  it("一部でも異なれば false", () => {
    expect(isNameConfirmed("EG", "EGG")).toBe(false);
  });

  it("大文字小文字が異なれば false（厳密一致）", () => {
    expect(isNameConfirmed("egg", "EGG")).toBe(false);
  });

  it("未入力なら false", () => {
    expect(isNameConfirmed("", "EGG")).toBe(false);
  });

  it("対象名自体が空文字なら常に false", () => {
    expect(isNameConfirmed("", "")).toBe(false);
    expect(isNameConfirmed("何か", "")).toBe(false);
  });

  it("空白のみの入力は不一致扱い", () => {
    expect(isNameConfirmed("   ", "EGG")).toBe(false);
  });
});
