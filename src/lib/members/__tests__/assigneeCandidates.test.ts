import { describe, it, expect } from "vitest";
import type { Member, Project, Task } from "../../localData/types";
import { buildAssigneeCandidates, projectParticipantIds, sharedProjectId } from "../assigneeCandidates";
import { isMemberInDisplayGroup } from "../../scope/displayGroupScope";

const mk = (id: string, group_id: string | null, group_ids?: string[], is_deleted = false): Member => ({
  id, display_name: id, short_name: id, initials: id, teams_account: "",
  color_bg: "#fff", color_text: "#000", is_deleted, group_id, group_ids,
});
const tk = (id: string, project_id: string | null, assignees: string[], is_deleted = false): Task => ({
  id, name: id, project_id, todo_ids: [], assignee_member_id: assignees[0] ?? "", assignee_member_ids: assignees,
  status: "todo", priority: null, start_date: null, due_date: null, estimated_hours: null,
  comment: "", is_deleted,
});

const a1 = mk("a1", "grp-a", ["grp-a"]);
const a2 = mk("a2", "grp-a", ["grp-a"]);
const ab = mk("ab", "grp-b", ["grp-b", "grp-a"]);
const b1 = mk("b1", "grp-b", ["grp-b"]);
const b2 = mk("b2", "grp-b", ["grp-b"]);
const invitee = mk("inv", "grp-invite-p1", ["grp-invite-p1"]);
const aDeleted = mk("a-del", "grp-a", ["grp-a"], true);
const all = [a1, a2, ab, b1, b2, invitee, aDeleted];
const scoped = (gid: string) => all.filter(m => isMemberInDisplayGroup(m, gid));
const groups = [{ id: "grp-a" }, { id: "grp-b" }, { id: "grp-invite-p1", is_invite_group: true }];

const p1 = { id: "p1", owner_member_id: "a1", owner_member_ids: ["a1"], member_ids: [] as string[], group_ids: ["grp-a", "grp-invite-p1"] } as Pick<Project, "id" | "owner_member_id" | "owner_member_ids" | "member_ids" | "group_ids">;

const ids = (ms: Member[]) => ms.map(m => m.id);

describe("buildAssigneeCandidates", () => {
  it("表示部署のメンバーだけ（他部署・削除済みは出ない）", () => {
    expect(ids(buildAssigneeCandidates({ allMembers: all, scopedMembers: scoped("grp-a") }))).toEqual(["a1", "a2", "ab"]);
  });

  it("兼務者は表示部署を切り替えると、切り替えた先の部署の候補になる", () => {
    expect(ids(buildAssigneeCandidates({ allMembers: all, scopedMembers: scoped("grp-b") }))).toEqual(["ab", "b1", "b2"]);
  });

  it("既存PJのタスクなら、招待受諾者を含むPJ参加者が加わる", () => {
    const participantIds = projectParticipantIds(p1, { tasks: [], taskProjects: [], members: all, groups });
    expect(ids(buildAssigneeCandidates({ allMembers: all, scopedMembers: scoped("grp-a"), participantIds }))).toEqual(["a1", "a2", "ab", "inv"]);
  });

  it("今の担当者が他部署の人でも候補から外れない", () => {
    expect(ids(buildAssigneeCandidates({ allMembers: all, scopedMembers: scoped("grp-a"), currentIds: ["b2"] }))).toEqual(["a1", "a2", "ab", "b2"]);
  });

  it("削除済みは、PJ参加者・今の担当者でも出ない", () => {
    const participantIds = new Set(["a-del"]);
    expect(ids(buildAssigneeCandidates({ allMembers: all, scopedMembers: scoped("grp-a"), participantIds, currentIds: ["a-del"] }))).toEqual(["a1", "a2", "ab"]);
  });
});

describe("sharedProjectId", () => {
  it("全部同じPJならそのPJ、混在・独立タスク・空なら null", () => {
    expect(sharedProjectId([tk("1", "p1", []), tk("2", "p1", [])])).toBe("p1");
    expect(sharedProjectId([tk("1", "p1", []), tk("2", "p2", [])])).toBeNull();
    expect(sharedProjectId([tk("1", null, []), tk("2", null, [])])).toBeNull();
    expect(sharedProjectId([])).toBeNull();
  });
});

describe("projectParticipantIds", () => {
  it("オーナー・member_ids・直接/task_projects経由のタスク担当者・招待用部署の人の和集合（削除済みタスクは除く）", () => {
    const project = { ...p1, owner_member_ids: ["a1"], member_ids: ["b1"] };
    const tasks = [tk("t1", "p1", ["a2"]), tk("t2", "other", ["b2"]), tk("t3", "other", ["ab"]), tk("t-del", "p1", ["ab"], true)];
    const result = projectParticipantIds(project, { tasks, taskProjects: [{ task_id: "t2", project_id: "p1" }], members: all, groups });
    expect([...result].sort()).toEqual(["a1", "a2", "b1", "b2", "inv"]);
  });

  it("owner_member_ids が空なら owner_member_id を使う。招待用部署でない group_ids は参加者扱いしない", () => {
    const project = { ...p1, owner_member_id: "b1", owner_member_ids: [], group_ids: ["grp-a", "grp-b"] };
    const result = projectParticipantIds(project, { tasks: [], taskProjects: [], members: all, groups });
    expect([...result]).toEqual(["b1"]);
  });
});
