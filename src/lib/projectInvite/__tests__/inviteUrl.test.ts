import { describe, it, expect } from "vitest";
import { buildInviteLink, extractInviteCodeFromSearch } from "../inviteUrl";

describe("buildInviteLink", () => {
  it("ベースURLに ?invite=<code> を付ける", () => {
    expect(buildInviteLink("https://app.example.com/", "abc123")).toBe(
      "https://app.example.com/?invite=abc123",
    );
  });

  it("既存のクエリパラメータを保持する", () => {
    expect(buildInviteLink("https://app.example.com/?foo=bar", "abc123")).toBe(
      "https://app.example.com/?foo=bar&invite=abc123",
    );
  });

  it("コードに含まれる特殊文字をエンコードする", () => {
    const link = buildInviteLink("https://app.example.com/", "a b&c");
    expect(link).toContain("invite=a+b%26c");
  });
});

describe("extractInviteCodeFromSearch", () => {
  it("invite パラメータが無い → null", () => {
    expect(extractInviteCodeFromSearch("")).toBeNull();
    expect(extractInviteCodeFromSearch("?foo=bar")).toBeNull();
  });

  it("invite パラメータの値をそのまま返す", () => {
    expect(extractInviteCodeFromSearch("?invite=abc123")).toBe("abc123");
  });

  it("値が空文字 → null", () => {
    expect(extractInviteCodeFromSearch("?invite=")).toBeNull();
  });

  it("値が空白のみ → null", () => {
    expect(extractInviteCodeFromSearch("?invite=%20%20")).toBeNull();
  });

  it("前後の空白はtrimする", () => {
    expect(extractInviteCodeFromSearch("?invite=%20abc123%20")).toBe("abc123");
  });

  it("同名パラメータが複数あるときは先頭を採用する", () => {
    expect(extractInviteCodeFromSearch("?invite=first&invite=second")).toBe("first");
  });

  it("他のパラメータと混在していても正しく取り出す", () => {
    expect(extractInviteCodeFromSearch("?foo=bar&invite=abc123&baz=qux")).toBe("abc123");
  });

  it("先頭に ? が無い形式（location.searchの生値）でも動く", () => {
    expect(extractInviteCodeFromSearch("invite=abc123")).toBe("abc123");
  });
});
