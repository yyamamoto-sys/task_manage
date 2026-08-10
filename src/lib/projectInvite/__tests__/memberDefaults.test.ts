import { describe, it, expect } from "vitest";
import { initialsFromDisplayName, shortNameFromDisplayName } from "../memberDefaults";

describe("initialsFromDisplayName", () => {
  it("姓名（スペース区切り）→ 頭文字2文字を大文字で", () => {
    expect(initialsFromDisplayName("tanaka ichiro")).toBe("TI");
  });

  it("全角スペース区切りにも対応する", () => {
    expect(initialsFromDisplayName("田中　一郎")).toBe("田一");
  });

  it("1語のみ → 先頭2文字（大文字化はしない）", () => {
    expect(initialsFromDisplayName("たなか")).toBe("たな");
    expect(initialsFromDisplayName("ichiro")).toBe("ic");
  });

  it("空文字・空白のみ → \"?\"", () => {
    expect(initialsFromDisplayName("")).toBe("?");
    expect(initialsFromDisplayName("   ")).toBe("?");
  });
});

describe("shortNameFromDisplayName", () => {
  it("姓名の各語の頭文字を連結する", () => {
    expect(shortNameFromDisplayName("田中 一郎")).toBe("田一");
  });

  it("1語のみ → その頭文字1文字", () => {
    expect(shortNameFromDisplayName("たなか")).toBe("た");
  });

  it("4文字を超える場合は先頭4文字までに切る", () => {
    expect(shortNameFromDisplayName("a b c d e")).toBe("abcd");
  });

  it("空文字・空白のみ → 空文字", () => {
    expect(shortNameFromDisplayName("")).toBe("");
    expect(shortNameFromDisplayName("   ")).toBe("");
  });
});
