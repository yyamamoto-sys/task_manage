// src/lib/admin/__tests__/guestMembers.test.ts
import { describe, expect, it } from "vitest";
import {
  isGuestOnlyMember,
  memberGroupIdsForGuestCheck,
  withGuestOnlyMembers,
  isGuestMemberOf,
  withGuestLabel,
  inviteGroupIdsInScope,
} from "../guestMembers";

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

describe("memberGroupIdsForGuestCheck", () => {
  it("group_idsがあればそれを使う", () => {
    expect(memberGroupIdsForGuestCheck({ group_id: "grp-egg", group_ids: ["grp-egg", "grp-invite-p1"] }))
      .toEqual(["grp-egg", "grp-invite-p1"]);
  });
  it("group_idsが空ならgroup_idにフォールバックする", () => {
    expect(memberGroupIdsForGuestCheck({ group_id: "grp-invite-p1", group_ids: [] })).toEqual(["grp-invite-p1"]);
  });
  it("どちらも無ければ空配列", () => {
    expect(memberGroupIdsForGuestCheck({})).toEqual([]);
  });
});

type TestMember = { id: string; group_id?: string | null; group_ids?: string[] };

describe("withGuestOnlyMembers", () => {
  const inviteGroupIds = ["grp-invite-p1"];
  it("招待受諾者のみのメンバーをscopedMembersに混ぜる", () => {
    const scoped: TestMember[] = [{ id: "m1", group_id: "grp-egg", group_ids: ["grp-egg"] }];
    const all: TestMember[] = [
      ...scoped,
      { id: "guest1", group_id: "grp-invite-p1", group_ids: ["grp-invite-p1"] },
    ];
    const result = withGuestOnlyMembers(scoped, all, inviteGroupIds);
    expect(result.map(m => m.id)).toEqual(["m1", "guest1"]);
  });
  it("既にscopedMembersに含まれる人は重複させない", () => {
    const scoped: TestMember[] = [{ id: "guest1", group_id: "grp-invite-p1", group_ids: ["grp-invite-p1"] }];
    const result = withGuestOnlyMembers(scoped, scoped, inviteGroupIds);
    expect(result).toBe(scoped); // 追加が無ければ同一参照を返す
  });
  it("招待受諾者がいなければscopedMembersをそのまま返す", () => {
    const scoped: TestMember[] = [{ id: "m1", group_id: "grp-egg", group_ids: ["grp-egg"] }];
    const all: TestMember[] = [...scoped, { id: "m2", group_id: "grp-other", group_ids: ["grp-other"] }];
    expect(withGuestOnlyMembers(scoped, all, inviteGroupIds)).toBe(scoped);
  });
});

describe("isGuestMemberOf", () => {
  it("招待用部署のみのメンバーはtrue", () => {
    expect(isGuestMemberOf({ group_id: "grp-invite-p1", group_ids: ["grp-invite-p1"] }, ["grp-invite-p1"])).toBe(true);
  });
  it("通常部署のメンバーはfalse", () => {
    expect(isGuestMemberOf({ group_id: "grp-egg", group_ids: ["grp-egg"] }, ["grp-invite-p1"])).toBe(false);
  });
});

describe("withGuestLabel", () => {
  it("ゲストならラベルを付ける", () => {
    expect(withGuestLabel("山田太郎", true)).toBe("山田太郎（招待）");
  });
  it("ゲストでなければ変更しない", () => {
    expect(withGuestLabel("山田太郎", false)).toBe("山田太郎");
  });
});


type TestProject = { id: string; group_id?: string | null; group_ids?: string[] | null; is_deleted?: boolean };

describe("inviteGroupIdsInScope（v3.78・レビュー後追加：招待受諾者を混ぜる範囲を部署でスコープする）", () => {
  const allInviteGroupIds = ["grp-invite-p1", "grp-invite-p2"];

  it("招待用PJが無い部署では空集合を返す", () => {
    const projects: TestProject[] = [
      { id: "p-normal", group_id: "grp-egg", group_ids: ["grp-egg"] },
    ];
    const result = inviteGroupIdsInScope(projects, "grp-egg", allInviteGroupIds);
    expect(result).toEqual(new Set());
  });

  it("招待用PJが1つある部署では、そのPJの招待用部署idだけを返す", () => {
    const projects: TestProject[] = [
      { id: "p1", group_id: "grp-egg", group_ids: ["grp-egg", "grp-invite-p1"] },
    ];
    const result = inviteGroupIdsInScope(projects, "grp-egg", allInviteGroupIds);
    expect(result).toEqual(new Set(["grp-invite-p1"]));
  });

  it("他部署の招待用PJが混ざっていても、選択中の部署に属さないPJの招待用部署idは含めない", () => {
    const projects: TestProject[] = [
      { id: "p1", group_id: "grp-egg", group_ids: ["grp-egg", "grp-invite-p1"] },
      { id: "p2", group_id: "grp-sales", group_ids: ["grp-sales", "grp-invite-p2"] },
    ];
    const result = inviteGroupIdsInScope(projects, "grp-egg", allInviteGroupIds);
    expect(result).toEqual(new Set(["grp-invite-p1"]));
    expect(result.has("grp-invite-p2")).toBe(false);
  });

  it("論理削除済みPJの招待用部署idは含めない", () => {
    const projects: TestProject[] = [
      { id: "p1", group_id: "grp-egg", group_ids: ["grp-egg", "grp-invite-p1"], is_deleted: true },
    ];
    const result = inviteGroupIdsInScope(projects, "grp-egg", allInviteGroupIds);
    expect(result).toEqual(new Set());
  });

  it("selectedGroupIdがnullなら空集合を返す（絞り込み無し＝全部署開放にはしない）", () => {
    const projects: TestProject[] = [
      { id: "p1", group_id: "grp-egg", group_ids: ["grp-egg", "grp-invite-p1"] },
    ];
    const result = inviteGroupIdsInScope(projects, null, allInviteGroupIds);
    expect(result).toEqual(new Set());
  });

  it("group_idsが空でgroup_idのみのPJもホーム部署として判定する（フォールバック）", () => {
    const projects: TestProject[] = [
      { id: "p1", group_id: "grp-egg", group_ids: [] },
    ];
    // group_idsが空配列のPJは招待用部署を持たない（招待発行時にgroup_idsへ追加される仕様の
    // ため、招待が1件も無いPJはこの形のままになる）。この場合は空集合が正しい。
    const result = inviteGroupIdsInScope(projects, "grp-egg", allInviteGroupIds);
    expect(result).toEqual(new Set());
  });

  it("複数PJが同じ部署に属していれば、それぞれの招待用部署idを両方返す", () => {
    const projects: TestProject[] = [
      { id: "p1", group_id: "grp-egg", group_ids: ["grp-egg", "grp-invite-p1"] },
      { id: "p2", group_id: "grp-egg", group_ids: ["grp-egg", "grp-invite-p2"] },
    ];
    const result = inviteGroupIdsInScope(projects, "grp-egg", allInviteGroupIds);
    expect(result).toEqual(new Set(["grp-invite-p1", "grp-invite-p2"]));
  });
});
