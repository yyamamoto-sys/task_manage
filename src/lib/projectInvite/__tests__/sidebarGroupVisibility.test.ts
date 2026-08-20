// src/lib/projectInvite/__tests__/sidebarGroupVisibility.test.ts
import { describe, expect, it } from "vitest";
import { computeAccessibleGroupsForSidebar, filterInviteGroupsForSidebar } from "../sidebarGroupVisibility";

interface FakeGroup {
  id: string;
  is_invite_group?: boolean;
  is_deleted?: boolean;
}

describe("filterInviteGroupsForSidebar", () => {
  it("通常部署が1件だけの場合はそのまま返す（切替UI対象外の最小ケース）", () => {
    const groups: FakeGroup[] = [{ id: "grp-egg" }];
    expect(filterInviteGroupsForSidebar(groups)).toEqual(groups);
  });

  it("通常部署が2件（兼務等）の場合はそのまま返す（招待用部署が無いため除外対象が無い）", () => {
    const groups: FakeGroup[] = [{ id: "grp-egg" }, { id: "grp-aid" }];
    expect(filterInviteGroupsForSidebar(groups)).toEqual(groups);
  });

  it("招待用部署のみ（招待された本人のケース）は除外せず元のリストをそのまま返す", () => {
    const groups: FakeGroup[] = [{ id: "grp-invite-proj1", is_invite_group: true }];
    const result = filterInviteGroupsForSidebar(groups);
    expect(result).toEqual(groups);
    expect(result.length).toBe(1);
  });

  it("ホーム部署＋招待用部署の兼務（発行者・PJオーナーのケース）は招待用部署だけを除く", () => {
    const groups: FakeGroup[] = [
      { id: "grp-egg" },
      { id: "grp-invite-proj1", is_invite_group: true },
    ];
    expect(filterInviteGroupsForSidebar(groups)).toEqual([{ id: "grp-egg" }]);
  });

  it("ホーム部署＋複数PJぶんの招待用部署の兼務は、招待用部署を全て除きホーム部署だけ残す", () => {
    const groups: FakeGroup[] = [
      { id: "grp-egg" },
      { id: "grp-invite-proj1", is_invite_group: true },
      { id: "grp-invite-proj2", is_invite_group: true },
    ];
    expect(filterInviteGroupsForSidebar(groups)).toEqual([{ id: "grp-egg" }]);
  });

  it("招待用部署が複数件だけ（ホームが無い異常系）でも除外せず元のリストを返す（空にならない安全弁）", () => {
    const groups: FakeGroup[] = [
      { id: "grp-invite-proj1", is_invite_group: true },
      { id: "grp-invite-proj2", is_invite_group: true },
    ];
    expect(filterInviteGroupsForSidebar(groups)).toEqual(groups);
  });

  it("空配列を渡された場合は空配列のまま返す", () => {
    expect(filterInviteGroupsForSidebar([])).toEqual([]);
  });
});

describe("computeAccessibleGroupsForSidebar（MainLayout.tsxの切替UI選択肢と同一の判定基準）", () => {
  const groups: FakeGroup[] = [
    { id: "grp-egg" },
    { id: "grp-aid" },
    { id: "grp-deleted", is_deleted: true },
    { id: "grp-invite-proj1", is_invite_group: true },
  ];

  it("非super-adminはgroup_idsに含まれる部署だけに絞る（削除済み・招待用部署は除外）", () => {
    const member = { group_id: "grp-egg", group_ids: ["grp-egg", "grp-aid", "grp-invite-proj1"] };
    expect(computeAccessibleGroupsForSidebar(groups, member, false)).toEqual([
      { id: "grp-egg" },
      { id: "grp-aid" },
    ]);
  });

  it("非super-adminでgroup_idsが空ならgroup_id（ホーム部署）1件にフォールバックする", () => {
    const member = { group_id: "grp-egg", group_ids: [] };
    expect(computeAccessibleGroupsForSidebar(groups, member, false)).toEqual([{ id: "grp-egg" }]);
  });

  it("招待用部署のみ（招待された本人）は除外せずそのまま返す", () => {
    const member = { group_id: "grp-invite-proj1", group_ids: ["grp-invite-proj1"] };
    expect(computeAccessibleGroupsForSidebar(groups, member, false)).toEqual([
      { id: "grp-invite-proj1", is_invite_group: true },
    ]);
  });

  it("super-adminは削除済みを除いた全部署から招待用部署だけを除く（本人のgroup_idsは見ない）", () => {
    const member = { group_id: "grp-egg", group_ids: [] };
    expect(computeAccessibleGroupsForSidebar(groups, member, true)).toEqual([
      { id: "grp-egg" },
      { id: "grp-aid" },
    ]);
  });
});
