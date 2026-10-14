import { describe, it, expect } from "vitest";
import type { Project, Task } from "../../../lib/localData/types";
import { buildPjViewGanttRows, ganttSectionCollapseKey } from "../ganttUtils";

const pj = { id: "p1", name: "PJ" } as Project;
const t = (id: string, extra: Partial<Task> = {}): Task => ({
  id, name: id, project_id: "p1", todo_ids: [], assignee_member_id: "", assignee_member_ids: [],
  status: "todo", priority: null, start_date: null, due_date: null, estimated_hours: null, comment: "",
  is_deleted: false, ...extra,
});

function build(tasks: Task[], collapsed: Record<string, boolean> = {}, withSections = true) {
  return buildPjViewGanttRows({
    visibleProjects: [pj],
    pjOrderedTasksMap: new Map([["p1", tasks.map(task => ({ task, depth: task.parent_task_id ? 1 : 0, childCount: 0 }))]]),
    todoGroups: [], todoGroupSortedMap: new Map(), collapsed, isPreview: false,
    sectionsByPj: withSections ? new Map([["p1", [{ id: "s1", name: "第1回" }, { id: "s2", name: "第2回" }]]]) : undefined,
  });
}

describe("buildPjViewGanttRows：PJ内のグループ（v3.149）", () => {
  const tasks = [t("a", { section_id: "s2" }), t("b"), t("c", { section_id: "s1" }), t("d", { parent_task_id: "c", section_id: "s1" })];

  it("グループが無いPJは従来どおり（見出し行なし）", () => {
    const rows = build(tasks, {}, false);
    expect(rows.some(r => r.kind === "section-header")).toBe(false);
  });

  it("未分類が先頭、続いてグループ順に見出しで区切る（子は親と同じ区画）", () => {
    const rows = build(tasks);
    expect(rows.map(r => r.kind === "task" ? r.task.id : r.kind === "section-header" ? `#${r.name}` : r.kind))
      .toEqual(["pj-header", "#未分類", "b", "#第1回", "c", "d", "#第2回", "a", "quick-add"]);
  });

  it("グループを折りたたむとその見出しだけ残り、中のタスクは出ない", () => {
    const rows = build(tasks, { [ganttSectionCollapseKey("p1", "s1")]: true });
    const ids = rows.filter(r => r.kind === "task").map(r => r.kind === "task" ? r.task.id : "");
    expect(ids).toEqual(["b", "a"]);
    expect(rows.filter(r => r.kind === "section-header")).toHaveLength(3);
  });

  it("見出し行は同じ blockKey（PJ）に属する", () => {
    const rows = build(tasks);
    expect(new Set(rows.filter(r => r.kind !== "quick-add").map(r => r.blockKey))).toEqual(new Set(["p1"]));
  });
});
