import { describe, it, expect } from "vitest";
import type { Member } from "../../localData/types";
import { computeProjectMembers } from "../projectMembers";

function mk(id: string, short_name: string, group_ids?: string[]): Member {
  return {
    id, display_name: short_name, short_name, initials: short_name.slice(0, 2),
    teams_account: "", color_bg: "#fff", color_text: "#000", is_deleted: false,
    group_ids,
  };
}

describe("computeProjectMembers", () => {
  const owner = mk("m-owner", "オーナー太郎");
  const assignee = mk("m-assignee", "担当花子");
  const invited = mk("m-invited", "招待次郎", ["grp-invite-pj1"]);
  const ownerAndAssignee = mk("m-both", "兼務三郎");
  const unrelated = mk("m-unrelated", "無関係四郎");
  const members = [owner, assignee, invited, ownerAndAssignee, unrelated];

  it("オーナー・担当者・招待用部署メンバーの和集合を返す（無関係な人は含まない）", () => {
    const rows = computeProjectMembers(members, {
      ownerIds: ["m-owner"],
      assigneeIds: ["m-assignee"],
      inviteGroupId: "grp-invite-pj1",
    });
    expect(rows.map(r => r.member.id)).toEqual(["m-owner", "m-assignee", "m-invited"]);
    expect(rows.find(r => r.member.id === "m-unrelated")).toBeUndefined();
  });

  it("オーナー兼担当者は1行に集約し、rolesに両方を持つ", () => {
    const rows = computeProjectMembers(members, {
      ownerIds: ["m-owner", "m-both"],
      assigneeIds: ["m-both"],
      inviteGroupId: null,
    });
    const both = rows.find(r => r.member.id === "m-both");
    expect(both).toBeDefined();
    expect(both!.roles.sort()).toEqual(["assignee", "owner"]);
    // 1行にまとまっているので合計行数は重複しない
    expect(rows.length).toBe(2);
  });

  it("招待用部署（inviteGroupId）のメンバーで、かつタスク担当者でもある場合は両方のroleを持つ", () => {
    const invitedAssignee = mk("m-inv-assignee", "招待担当五郎", ["grp-invite-pj1"]);
    const rows = computeProjectMembers([...members, invitedAssignee], {
      ownerIds: ["m-owner"],
      assigneeIds: ["m-inv-assignee"],
      inviteGroupId: "grp-invite-pj1",
    });
    const row = rows.find(r => r.member.id === "m-inv-assignee");
    expect(row!.roles.sort()).toEqual(["assignee", "invited"]);
  });

  it("inviteGroupIdがnull/undefinedなら招待カテゴリは追加されない", () => {
    const rows = computeProjectMembers(members, {
      ownerIds: ["m-owner"],
      assigneeIds: [],
      inviteGroupId: undefined,
    });
    expect(rows.map(r => r.member.id)).toEqual(["m-owner"]);
  });

  it("存在しないmember idは無視する", () => {
    const rows = computeProjectMembers(members, {
      ownerIds: ["not-exist"],
      assigneeIds: [],
    });
    expect(rows).toEqual([]);
  });

  it("並び順：オーナー→担当者→招待のみ、の優先度でソートする", () => {
    const rows = computeProjectMembers(members, {
      ownerIds: ["m-owner"],
      assigneeIds: ["m-assignee"],
      inviteGroupId: "grp-invite-pj1",
    });
    expect(rows.map(r => r.roles[0])).toEqual(["owner", "assignee", "invited"]);
  });

  it("同じ役割内はshort_nameの辞書順でソートする", () => {
    const a = mk("m-a", "あいう");
    const b = mk("m-b", "かきく");
    const rows = computeProjectMembers([b, a], { ownerIds: ["m-a", "m-b"], assigneeIds: [] });
    expect(rows.map(r => r.member.id)).toEqual(["m-a", "m-b"]);
  });

  it("空配列を渡すと空配列を返す", () => {
    expect(computeProjectMembers([], { ownerIds: [], assigneeIds: [] })).toEqual([]);
  });
});
