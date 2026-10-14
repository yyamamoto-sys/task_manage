import { describe, it, expect } from "vitest";
import type { Project, Task, TaskProject } from "../../localData/types";
import {
  isAiTargetProject,
  isAiBulkTargetProject,
  isAiSendableTask,
  aiTargetPickerProjects,
  resolveAiScope,
} from "../aiTarget";

function pj(id: string, status: Project["status"] = "active", over: Partial<Project> = {}): Project {
  return {
    id, name: id, purpose: "", contribution_memo: "", owner_member_id: "m1", owner_member_ids: ["m1"],
    status, color_tag: "#000", start_date: "", end_date: "", is_deleted: false, ...over,
  } as Project;
}
function tk(id: string, project_id: string | null, status: Task["status"] = "todo", over: Partial<Task> = {}): Task {
  return {
    id, name: id, project_id, todo_ids: [], assignee_member_id: "m1", assignee_member_ids: ["m1"],
    status, priority: null, start_date: null, due_date: null, estimated_hours: null, comment: "",
    is_deleted: false, completed_at: null, ...over,
  } as Task;
}

describe("PJ・タスクの判定", () => {
  it("アーカイブ済み・削除済みPJは対象外、完了PJは対象（個別・選択肢）", () => {
    expect(isAiTargetProject(pj("a", "active"))).toBe(true);
    expect(isAiTargetProject(pj("c", "completed"))).toBe(true);
    expect(isAiTargetProject(pj("x", "archived"))).toBe(false);
    expect(isAiTargetProject(pj("d", "active", { is_deleted: true }))).toBe(false);
  });
  it("「すべてのPJ」は完了PJも除く", () => {
    expect(isAiBulkTargetProject(pj("a", "active"))).toBe(true);
    expect(isAiBulkTargetProject(pj("c", "completed"))).toBe(false);
    expect(isAiBulkTargetProject(pj("x", "archived"))).toBe(false);
  });
  it("完了・中止・削除済みのタスクは送らない", () => {
    expect(isAiSendableTask(tk("1", "a", "todo"))).toBe(true);
    expect(isAiSendableTask(tk("2", "a", "in_progress"))).toBe(true);
    expect(isAiSendableTask(tk("3", "a", "on_hold"))).toBe(true);
    expect(isAiSendableTask(tk("4", "a", "done"))).toBe(false);
    expect(isAiSendableTask(tk("5", "a", "cancelled"))).toBe(false);
    expect(isAiSendableTask(tk("6", "a", "todo", { is_deleted: true }))).toBe(false);
  });
  it("選択肢のPJからアーカイブ済みを除き、完了PJは残す", () => {
    const ids = aiTargetPickerProjects([pj("a"), pj("c", "completed"), pj("x", "archived")]).map(p => p.id);
    expect(ids).toEqual(["a", "c"]);
  });
});

describe("resolveAiScope", () => {
  const projects = [pj("a"), pj("b"), pj("c", "completed"), pj("x", "archived")];
  const tasks = [
    tk("a1", "a"), tk("a2", "a", "done"), tk("a3", "a", "cancelled"),
    tk("b1", "b", "in_progress"),
    tk("c1", "c"),
    tk("x1", "x"),
    tk("free", null),
  ];

  it("すべてのPJ：アーカイブ・完了PJを除き、完了・中止のタスクを送らない", () => {
    const sc = resolveAiScope({ projects, tasks, targetPjId: null });
    expect(sc.projects.map(p => p.project.id)).toEqual(["a", "b"]);
    expect(sc.openTasks.map(t => t.id)).toEqual(["a1", "b1"]);
  });
  it("PJ単位の件数用に、完了・中止を含む全タスクも持つ", () => {
    const sc = resolveAiScope({ projects, tasks, targetPjId: null });
    expect(sc.projects[0].allTasks.map(t => t.id)).toEqual(["a1", "a2", "a3"]);
    expect(sc.projects[0].openTasks.map(t => t.id)).toEqual(["a1"]);
  });
  it("個別PJ：そのPJだけ（完了PJも個別に選べば対象）", () => {
    expect(resolveAiScope({ projects, tasks, targetPjId: "b" }).openTasks.map(t => t.id)).toEqual(["b1"]);
    const completed = resolveAiScope({ projects, tasks, targetPjId: "c" });
    expect(completed.projects.map(p => p.project.id)).toEqual(["c"]);
    expect(completed.openTasks.map(t => t.id)).toEqual(["c1"]);
  });
  it("個別にアーカイブ済みPJを指定しても何も送らない", () => {
    const sc = resolveAiScope({ projects, tasks, targetPjId: "x" });
    expect(sc.projects).toEqual([]);
    expect(sc.openTasks).toEqual([]);
  });
  it("アーカイブ済みPJのタスクは、他PJの追加紐付け経由でも対象PJ側にしか入らない", () => {
    const taskProjects = [{ task_id: "x1", project_id: "b" }] as TaskProject[];
    const sc = resolveAiScope({ projects, tasks, taskProjects, targetPjId: "b" });
    expect(sc.openTasks.map(t => t.id).sort()).toEqual(["b1", "x1"]);
    const all = resolveAiScope({ projects, tasks, taskProjects, targetPjId: null });
    expect(all.openTasks.filter(t => t.id === "x1")).toHaveLength(1);
  });
  it("PJ外のタスクは、includeProjectlessTasks かつ「すべてのPJ」のときだけ入る", () => {
    expect(resolveAiScope({ projects, tasks, targetPjId: null }).openTasks.some(t => t.id === "free")).toBe(false);
    expect(resolveAiScope({ projects, tasks, targetPjId: null, includeProjectlessTasks: true }).openTasks.some(t => t.id === "free")).toBe(true);
    expect(resolveAiScope({ projects, tasks, targetPjId: "a", includeProjectlessTasks: true }).openTasks.some(t => t.id === "free")).toBe(false);
  });
});
