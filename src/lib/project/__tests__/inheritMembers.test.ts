import { describe, it, expect } from "vitest";
import type { Member, Task } from "../../localData/types";
import { candidateInheritMembers, defaultCheckedMemberIds } from "../inheritMembers";

function mkMember(partial: Partial<Member> & { id: string }): Member {
  return {
    id: partial.id,
    display_name: partial.display_name ?? partial.id,
    short_name: partial.short_name ?? partial.id,
    initials: partial.initials ?? "XX",
    teams_account: partial.teams_account ?? "",
    color_bg: partial.color_bg ?? "#000",
    color_text: partial.color_text ?? "#fff",
    is_deleted: partial.is_deleted ?? false,
  };
}

function mkTask(partial: Partial<Task> & { id: string }): Task {
  return {
    id: partial.id,
    name: partial.name ?? partial.id,
    project_id: partial.project_id ?? "origin-pj",
    todo_ids: partial.todo_ids ?? [],
    assignee_member_id: partial.assignee_member_id ?? "",
    assignee_member_ids: partial.assignee_member_ids ?? [],
    status: partial.status ?? "todo",
    priority: partial.priority ?? null,
    start_date: partial.start_date ?? null,
    due_date: partial.due_date ?? null,
    estimated_hours: partial.estimated_hours ?? null,
    comment: partial.comment ?? "",
    is_deleted: partial.is_deleted ?? false,
  };
}

describe("candidateInheritMembers", () => {
  it("member_ids のメンバーを候補に含める", () => {
    const members = [mkMember({ id: "a" }), mkMember({ id: "b" })];
    const result = candidateInheritMembers(members, ["a"], []);
    expect(result.map(m => m.id)).toEqual(["a"]);
  });

  it("member_idsに無くても、タスクの担当者は候補に含める", () => {
    const members = [mkMember({ id: "a" }), mkMember({ id: "b" })];
    const tasks = [mkTask({ id: "t1", assignee_member_id: "b" })];
    const result = candidateInheritMembers(members, [], tasks);
    expect(result.map(m => m.id)).toEqual(["b"]);
  });

  it("assignee_member_ids（複数担当者）も候補に含める", () => {
    const members = [mkMember({ id: "a" }), mkMember({ id: "b" }), mkMember({ id: "c" })];
    const tasks = [mkTask({ id: "t1", assignee_member_id: "a", assignee_member_ids: ["a", "b"] })];
    const result = candidateInheritMembers(members, [], tasks);
    expect(new Set(result.map(m => m.id))).toEqual(new Set(["a", "b"]));
  });

  it("論理削除済みメンバーは候補から除外する", () => {
    const members = [mkMember({ id: "a", is_deleted: true }), mkMember({ id: "b" })];
    const result = candidateInheritMembers(members, ["a", "b"], []);
    expect(result.map(m => m.id)).toEqual(["b"]);
  });

  it("重複（member_idsとタスク担当者が同じ人）は1件にまとめる", () => {
    const members = [mkMember({ id: "a" })];
    const tasks = [mkTask({ id: "t1", assignee_member_id: "a" })];
    const result = candidateInheritMembers(members, ["a"], tasks);
    expect(result).toHaveLength(1);
  });

  it("short_name（ja）で並べる", () => {
    const members = [mkMember({ id: "a", short_name: "たなか" }), mkMember({ id: "b", short_name: "あべ" })];
    const result = candidateInheritMembers(members, ["a", "b"], []);
    expect(result.map(m => m.id)).toEqual(["b", "a"]);
  });
});

describe("defaultCheckedMemberIds", () => {
  it("チェック中タスクの担当者だけを既定ONにする", () => {
    const tasks = [
      mkTask({ id: "t1", assignee_member_id: "a", assignee_member_ids: ["a"] }),
      mkTask({ id: "t2", assignee_member_id: "b", assignee_member_ids: ["b", "c"] }),
    ];
    const result = defaultCheckedMemberIds(tasks);
    expect(result).toEqual(new Set(["a", "b", "c"]));
  });

  it("チェック中タスクが無ければ空集合", () => {
    expect(defaultCheckedMemberIds([])).toEqual(new Set());
  });
});
