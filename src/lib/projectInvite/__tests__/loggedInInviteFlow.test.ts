// src/lib/projectInvite/__tests__/loggedInInviteFlow.test.ts
import { describe, expect, it } from "vitest";
import {
  shouldPromptLoggedInInviteAccept,
  buildAcceptPayloadForExistingMember,
  stripInviteParamFromUrl,
} from "../loggedInInviteFlow";
import type { Member } from "../../localData/types";

const MEMBER: Member = {
  id: "member-1",
  display_name: "山田太郎",
  short_name: "山田",
  initials: "YT",
  teams_account: "",
  color_bg: "#7F77DD",
  color_text: "#FFFFFF",
  is_deleted: false,
};

describe("shouldPromptLoggedInInviteAccept", () => {
  it("招待コードとcurrentUserが両方あれば true", () => {
    expect(shouldPromptLoggedInInviteAccept("abc123", MEMBER)).toBe(true);
  });

  it("招待コードが null なら false", () => {
    expect(shouldPromptLoggedInInviteAccept(null, MEMBER)).toBe(false);
  });

  it("招待コードが空文字・空白のみなら false", () => {
    expect(shouldPromptLoggedInInviteAccept("", MEMBER)).toBe(false);
    expect(shouldPromptLoggedInInviteAccept("   ", MEMBER)).toBe(false);
  });

  it("currentUser が null（自動マッチング未確定等）なら false", () => {
    expect(shouldPromptLoggedInInviteAccept("abc123", null)).toBe(false);
  });

  it("両方無ければ false", () => {
    expect(shouldPromptLoggedInInviteAccept(null, null)).toBe(false);
  });
});

describe("buildAcceptPayloadForExistingMember", () => {
  it("currentUserの現在の表示名・略称・イニシャル・色をそのまま使う", () => {
    const payload = buildAcceptPayloadForExistingMember("code-xyz", "yamada@amita-net.co.jp", MEMBER);
    expect(payload).toEqual({
      code: "code-xyz",
      email: "yamada@amita-net.co.jp",
      displayName: "山田太郎",
      shortName: "山田",
      initials: "YT",
      colorBg: "#7F77DD",
      colorText: "#FFFFFF",
    });
  });

  it("displayName/shortNameが空文字にならない（既存メンバーは元々必須列のため）", () => {
    const payload = buildAcceptPayloadForExistingMember("code-xyz", "yamada@amita-net.co.jp", MEMBER);
    expect(payload.displayName).not.toBe("");
    expect(payload.shortName).not.toBe("");
  });
});

describe("stripInviteParamFromUrl", () => {
  it("inviteパラメータだけを取り除く（他のクエリは維持する）", () => {
    const result = stripInviteParamFromUrl("https://example.com/app?foo=bar&invite=abc123&baz=qux");
    expect(result).toBe("https://example.com/app?foo=bar&baz=qux");
  });

  it("inviteパラメータが無い場合はそのまま返す", () => {
    const href = "https://example.com/app?foo=bar";
    expect(stripInviteParamFromUrl(href)).toBe(href);
  });

  it("クエリが無いURLはそのまま返す", () => {
    const href = "https://example.com/app";
    expect(stripInviteParamFromUrl(href)).toBe(href);
  });

  it("不正なURL文字列は例外を投げずそのまま返す", () => {
    const href = "not-a-valid-url";
    expect(stripInviteParamFromUrl(href)).toBe(href);
  });

  it("invite以外のクエリのみのハッシュも維持する", () => {
    const result = stripInviteParamFromUrl("https://example.com/app?invite=abc123#section2");
    expect(result).toBe("https://example.com/app#section2");
  });
});
