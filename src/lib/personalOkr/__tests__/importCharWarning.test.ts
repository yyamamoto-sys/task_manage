import { describe, it, expect } from "vitest";
import { isPersonalOkrImportTextTooLong, PERSONAL_OKR_IMPORT_CHAR_WARNING_THRESHOLD } from "../importCharWarning";

describe("isPersonalOkrImportTextTooLong", () => {
  it("0文字はfalse", () => {
    expect(isPersonalOkrImportTextTooLong(0)).toBe(false);
  });

  it("閾値未満はfalse", () => {
    expect(isPersonalOkrImportTextTooLong(PERSONAL_OKR_IMPORT_CHAR_WARNING_THRESHOLD - 1)).toBe(false);
  });

  it("閾値ちょうどはfalse（超えたときだけ警告）", () => {
    expect(isPersonalOkrImportTextTooLong(PERSONAL_OKR_IMPORT_CHAR_WARNING_THRESHOLD)).toBe(false);
  });

  it("閾値を1文字でも超えたらtrue", () => {
    expect(isPersonalOkrImportTextTooLong(PERSONAL_OKR_IMPORT_CHAR_WARNING_THRESHOLD + 1)).toBe(true);
  });
});
