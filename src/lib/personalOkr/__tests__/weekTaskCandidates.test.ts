// src/lib/personalOkr/__tests__/weekTaskCandidates.test.ts
import { describe, expect, it } from "vitest";
import { computeWeekTaskCandidates } from "../weekTaskCandidates";
import type { Task, ToDo } from "../../localData/types";

const MEMBER = "member-1";
const OTHER_MEMBER = "member-2";

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: "t-" + Math.random().toString(36).slice(2),
    name: "タスク",
    project_id: null,
    todo_ids: [],
    assignee_member_id: MEMBER,
    assignee_member_ids: [MEMBER],
    status: "todo",
    priority: null,
    start_date: null,
    due_date: null,
    estimated_hours: null,
    comment: "",
    is_deleted: false,
    ...overrides,
  };
}

function makeTodo(overrides: Partial<ToDo>): ToDo {
  return {
    id: "td-" + Math.random().toString(36).slice(2),
    tf_id: "tf-1",
    title: "ToDo",
    due_date: null,
    memo: "",
    is_deleted: false,
    ...overrides,
  };
}

describe("computeWeekTaskCandidates", () => {
  const weekStart = "2026-08-03";
  const weekEnd = "2026-08-09";

  it("本人担当・期日が週内のタスクだけを候補にする", () => {
    const inRange = makeTask({ id: "in", due_date: "2026-08-05" });
    const outOfRange = makeTask({ id: "out", due_date: "2026-08-20" });
    const otherAssignee = makeTask({ id: "other", due_date: "2026-08-05", assignee_member_id: OTHER_MEMBER, assignee_member_ids: [OTHER_MEMBER] });
    const noDueDate = makeTask({ id: "nodate", due_date: null });

    const result = computeWeekTaskCandidates({
      tasks: [inRange, outOfRange, otherAssignee, noDueDate],
      todos: [],
      weekStart, weekEnd,
      currentMemberId: MEMBER,
    });

    expect(result.map(t => t.id)).toEqual(["in"]);
  });

  it("assignee_member_idsに含まれていれば候補になる（先頭担当者以外の複数担当）", () => {
    const task = makeTask({ id: "multi", due_date: "2026-08-05", assignee_member_id: OTHER_MEMBER, assignee_member_ids: [OTHER_MEMBER, MEMBER] });
    const result = computeWeekTaskCandidates({
      tasks: [task], todos: [], weekStart, weekEnd, currentMemberId: MEMBER,
    });
    expect(result.map(t => t.id)).toEqual(["multi"]);
  });

  it("週の範囲の境界日（開始日・終了日）を含む", () => {
    const startDay = makeTask({ id: "start", due_date: weekStart });
    const endDay = makeTask({ id: "end", due_date: weekEnd });
    const result = computeWeekTaskCandidates({
      tasks: [startDay, endDay], todos: [], weekStart, weekEnd, currentMemberId: MEMBER,
    });
    expect(result.map(t => t.id).sort()).toEqual(["end", "start"]);
  });

  it("個人KRにTFが紐づく場合、そのTF配下（todos.tf_id経由）のタスクを先頭に出す", () => {
    const todo = makeTodo({ id: "todo-1", tf_id: "tf-target" });
    const otherTodo = makeTodo({ id: "todo-2", tf_id: "tf-other" });
    const tfLinked = makeTask({ id: "tf-linked", due_date: "2026-08-07", todo_ids: ["todo-1"] });
    const notTfLinked = makeTask({ id: "not-linked", due_date: "2026-08-04", todo_ids: ["todo-2"] });

    const result = computeWeekTaskCandidates({
      tasks: [notTfLinked, tfLinked],
      todos: [todo, otherTodo],
      weekStart, weekEnd,
      currentMemberId: MEMBER,
      taskForceId: "tf-target",
    });

    // 期日だけならnot-linkedが先だが、TF配下優先のためtf-linkedが先頭に来る
    expect(result.map(t => t.id)).toEqual(["tf-linked", "not-linked"]);
  });

  it("excludeTaskIdsに含まれるタスクは候補から除外する（すでに紐づけ済み）", () => {
    const already = makeTask({ id: "already", due_date: "2026-08-05" });
    const result = computeWeekTaskCandidates({
      tasks: [already], todos: [], weekStart, weekEnd, currentMemberId: MEMBER,
      excludeTaskIds: ["already"],
    });
    expect(result).toEqual([]);
  });

  it("論理削除済みタスクは候補にしない", () => {
    const deleted = makeTask({ id: "deleted", due_date: "2026-08-05", is_deleted: true });
    const result = computeWeekTaskCandidates({
      tasks: [deleted], todos: [], weekStart, weekEnd, currentMemberId: MEMBER,
    });
    expect(result).toEqual([]);
  });
});
