import { describe, it, expect } from "vitest";
import { parsePendingProjectInvite, type PendingProjectInvite } from "../pendingInvite";

const VALID: PendingProjectInvite = {
  code: "abc123",
  email: "user@amita-net.co.jp",
  displayName: "田中 一郎",
  shortName: "田中",
  initials: "TI",
  colorBg: "var(--avatar-3-bg)",
  colorText: "var(--avatar-3-text)",
  savedAt: "2026-08-10T00:00:00.000Z",
};

describe("parsePendingProjectInvite", () => {
  it("null → null", () => {
    expect(parsePendingProjectInvite(null)).toBeNull();
  });

  it("空文字 → null", () => {
    expect(parsePendingProjectInvite("")).toBeNull();
  });

  it("壊れたJSON → null（例外を投げない）", () => {
    expect(parsePendingProjectInvite("{not valid json")).toBeNull();
  });

  it("正しい形式 → そのままのオブジェクトを返す", () => {
    expect(parsePendingProjectInvite(JSON.stringify(VALID))).toEqual(VALID);
  });

  it("必須フィールド（code）欠落 → null", () => {
    const { code, ...rest } = VALID;
    void code;
    expect(parsePendingProjectInvite(JSON.stringify(rest))).toBeNull();
  });

  it("必須フィールド（email）が空文字 → null", () => {
    expect(parsePendingProjectInvite(JSON.stringify({ ...VALID, email: "" }))).toBeNull();
  });

  it("必須フィールド（displayName）欠落 → null", () => {
    const { displayName, ...rest } = VALID;
    void displayName;
    expect(parsePendingProjectInvite(JSON.stringify(rest))).toBeNull();
  });

  it("必須フィールド（shortName）欠落 → null", () => {
    const { shortName, ...rest } = VALID;
    void shortName;
    expect(parsePendingProjectInvite(JSON.stringify(rest))).toBeNull();
  });

  it("initials が空文字でも許容する（\"?\"等の既定値が入り得るため必須にしていない）", () => {
    expect(parsePendingProjectInvite(JSON.stringify({ ...VALID, initials: "" }))).toEqual({
      ...VALID, initials: "",
    });
  });

  it("配列など想定外の型 → null", () => {
    expect(parsePendingProjectInvite(JSON.stringify([1, 2, 3]))).toBeNull();
  });

  it("数値が文字列として保存されていない（型不一致）→ null", () => {
    expect(parsePendingProjectInvite(JSON.stringify({ ...VALID, code: 123 }))).toBeNull();
  });
});
