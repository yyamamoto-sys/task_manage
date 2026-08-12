// src/lib/admin/__tests__/guestMembers.test.ts
import { describe, expect, it } from "vitest";
import { isGuestOnlyMember } from "../guestMembers";

describe("isGuestOnlyMember", () => {
  it("通常部署のみのメンバーはゲストではない", () => {
    expect(isGuestOnlyMember(["grp-egg"], ["grp-invite-p1"])).toBe(false);
  });

  it("招待用部署のみのメンバーはゲストである（招待受諾直後の典型ケース）", () => {
    expect(isGuestOnlyMember(["grp-invite-p1"], ["grp-invite-p1", "grp-invite-p2"])).toBe(true);
  });

  it("ホーム部署＋招待用部署の兼務（発行者・PJオーナー）はゲストではない", () => {
    expect(isGuestOnlyMember(["grp-egg", "grp-invite-p1"], ["grp-invite-p1"])).toBe(false);
  });

  it("group_idsが空配列のメンバーはゲストではない（判定対象外）", () => {
    expect(isGuestOnlyMember([], ["grp-invite-p1"])).toBe(false);
  });

  it("招待用部署を複数兼務していてもゲストである", () => {
    expect(isGuestOnlyMember(["grp-invite-p1", "grp-invite-p2"], ["grp-invite-p1", "grp-invite-p2"])).toBe(true);
  });

  it("Setを渡しても配列と同じ結果になる", () => {
    const set = new Set(["grp-invite-p1"]);
    expect(isGuestOnlyMember(["grp-invite-p1"], set)).toBe(true);
  });
});
