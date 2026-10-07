// src/lib/admin/__tests__/memberPermission.test.ts
import { describe, expect, it } from "vitest";
import {
  adminGroupIdOf,
  canAdministerGroup,
  canChangeHomeGroup,
  canDeleteMember,
  canEditMemberRow,
  canManageMember,
  visibleInviteGroupIds,
} from "../memberPermission";

const NONE = new Set<string>();
const INVITE = new Set(["grp-invite-p1"]);

const general = { id: "g", group_id: "grp-a", is_admin: false, is_super_admin: false };
const homeAdmin = { id: "a", group_id: "grp-a", is_admin: true, is_super_admin: false };
// 兼務管理者：ホームは grp-a、兼務先は grp-b（group_ids は判定に使わない）
const kenmuAdmin = { id: "k", group_id: "grp-a", is_admin: true, is_super_admin: false };
const superAdmin = { id: "s", group_id: "grp-a", is_admin: false, is_super_admin: true };

const peerA = { id: "pa", group_id: "grp-a" };
const peerB = { id: "pb", group_id: "grp-b" };
const guest = { id: "gu", group_id: "grp-invite-p1" };
const otherGuest = { id: "gx", group_id: "grp-invite-p9" };

describe("adminGroupIdOf", () => {
  it("管理者ならホーム部署、そうでなければ null", () => {
    expect(adminGroupIdOf(homeAdmin)).toBe("grp-a");
    expect(adminGroupIdOf(general)).toBeNull();
    expect(adminGroupIdOf({ id: "x", group_id: null, is_admin: true })).toBeNull();
  });
});

describe("canManageMember", () => {
  it("一般メンバーは同じ部署の他人でも管理できない", () => {
    expect(canManageMember(general, peerA, NONE)).toBe(false);
  });
  it("自部署管理者はホーム部署の人を管理できる", () => {
    expect(canManageMember(homeAdmin, peerA, NONE)).toBe(true);
  });
  it("兼務管理者は兼務先の人を管理できない（兼務先では一般メンバー扱い）", () => {
    expect(canManageMember(kenmuAdmin, peerB, NONE)).toBe(false);
  });
  it("super_admin は誰でも管理できる", () => {
    expect(canManageMember(superAdmin, peerB, NONE)).toBe(true);
    expect(canManageMember(superAdmin, { id: "n", group_id: null }, NONE)).toBe(true);
  });
  it("見えている招待用部署のゲストは、どこかの管理者なら管理できる（従来どおり）", () => {
    expect(canManageMember(kenmuAdmin, guest, INVITE)).toBe(true);
    expect(canManageMember(kenmuAdmin, otherGuest, INVITE)).toBe(false);
    expect(canManageMember(general, guest, INVITE)).toBe(false);
  });
  it("ホーム部署が無い行は super_admin 以外管理できない", () => {
    expect(canManageMember(homeAdmin, { id: "n", group_id: null }, NONE)).toBe(false);
  });
});

describe("canEditMemberRow / canDeleteMember", () => {
  it("自分の行は一般メンバーでも編集できるが削除はできない", () => {
    expect(canEditMemberRow(general, general, NONE)).toBe(true);
    expect(canDeleteMember(general, general, NONE)).toBe(false);
    expect(canDeleteMember(homeAdmin, homeAdmin, NONE)).toBe(false);
  });
  it("一般メンバーは他人の行を編集・削除できない", () => {
    expect(canEditMemberRow(general, peerA, NONE)).toBe(false);
    expect(canDeleteMember(general, peerA, NONE)).toBe(false);
  });
  it("自部署管理者はホーム部署の他人を編集・削除できる", () => {
    expect(canEditMemberRow(homeAdmin, peerA, NONE)).toBe(true);
    expect(canDeleteMember(homeAdmin, peerA, NONE)).toBe(true);
  });
});

describe("canAdministerGroup / canChangeHomeGroup", () => {
  it("部署の管理はホーム部署だけ", () => {
    expect(canAdministerGroup(homeAdmin, "grp-a")).toBe(true);
    expect(canAdministerGroup(kenmuAdmin, "grp-b")).toBe(false);
    expect(canAdministerGroup(general, "grp-a")).toBe(false);
    expect(canAdministerGroup(superAdmin, "grp-b")).toBe(true);
    expect(canAdministerGroup(homeAdmin, null)).toBe(false);
  });
  it("ホーム部署の付け替えは super_admin だけ", () => {
    expect(canChangeHomeGroup(superAdmin)).toBe(true);
    expect(canChangeHomeGroup(homeAdmin)).toBe(false);
  });
});

describe("visibleInviteGroupIds", () => {
  it("見えているPJに紐づく招待用部署だけを返す（削除済みPJは除く）", () => {
    const all = new Set(["grp-invite-p1", "grp-invite-p2"]);
    const projects = [
      { group_ids: ["grp-a", "grp-invite-p1"] },
      { group_ids: ["grp-a", "grp-invite-p2"], is_deleted: true },
      { group_ids: null },
    ];
    expect([...visibleInviteGroupIds(projects, all)]).toEqual(["grp-invite-p1"]);
  });
});
