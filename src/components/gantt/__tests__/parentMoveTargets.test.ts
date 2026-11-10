import { describe, it, expect } from "vitest";
import { expandWithDescendants, moveTargetsOf } from "../ganttUtils";
import type { Task } from "../../../lib/localData/types";

function t(id: string, o: Partial<Task> = {}): Task {
  return {
    id, name: id, project_id: "pj", todo_ids: [], assignee_member_id: "", assignee_member_ids: [],
    status: "todo", priority: null, start_date: "2026-08-01", due_date: "2026-08-05",
    estimated_hours: null, comment: "", is_deleted: false, ...o,
  } as Task;
}

describe("expandWithDescendants / moveTargetsOf（v3.207 親バーの移動ドラッグ）", () => {
  const tasks = [
    t("P", { start_date: null, due_date: null }),
    t("A", { parent_task_id: "P" }),
    t("B", { parent_task_id: "A" }),
    t("C", { parent_task_id: "B" }),
    t("D", { parent_task_id: "C" }), // 4段目
    t("DONE", { parent_task_id: "P", status: "done" }),
    t("CAN", { parent_task_id: "P", status: "cancelled" }),
    t("UNDER_CAN", { parent_task_id: "CAN" }),
    t("NODATE", { parent_task_id: "P", due_date: null, start_date: "2026-08-01" }),
    t("DEL", { parent_task_id: "P", is_deleted: true }),
    t("OTHER"),
  ];
  const byId = new Map(tasks.map(x => [x.id, x]));

  it("深い入れ子まで子孫をすべて含み、外のタスクは含まない", () => {
    const ids = expandWithDescendants(["P"], tasks);
    expect(ids[0]).toBe("P");
    expect(new Set(ids)).toEqual(new Set(["P", "A", "B", "C", "D", "DONE", "CAN", "UNDER_CAN", "NODATE"]));
  });

  it("完了・中止・期日未設定・削除済み・期日の無い親自身は動かさない（中止の下の未完了は動かす）", () => {
    const targets = moveTargetsOf(expandWithDescendants(["P"], tasks), byId);
    expect(targets.map(x => x.taskId).sort()).toEqual(["A", "B", "C", "D", "UNDER_CAN"]);
  });

  it("選択に親と子孫が両方入っていても1回だけ", () => {
    const ids = expandWithDescendants(["P", "B", "OTHER"], tasks);
    expect(ids.length).toBe(new Set(ids).size);
    expect(ids).toContain("OTHER");
  });
});
