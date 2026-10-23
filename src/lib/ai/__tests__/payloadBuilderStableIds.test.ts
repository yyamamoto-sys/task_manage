// 【設計意図・v3.182】AI相談のショートIDは、同じ会話のあいだ同じPJ・タスクに同じ番号を使い続ける。
// 毎回 001 から振り直すと、タスクが完了して減った・対象PJを切り替えた、といった変化で番号がずれ、
// 会話履歴にある過去の提案（旧番号）の「反映する」が別のタスクに解決されていた。

import { describe, it, expect } from "vitest";
import { buildPayload } from "../payloadBuilder";
import type { Member, Project, Task } from "../../localData/types";

const member: Member = {
  id: "m1", display_name: "山本", short_name: "山本", initials: "YY",
  teams_account: "", color_bg: "#fff", color_text: "#000", is_deleted: false,
};

function pj(id: string): Project {
  return {
    id, name: id, purpose: "", contribution_memo: "", owner_member_id: "m1", owner_member_ids: ["m1"],
    status: "active", color_tag: "#000", start_date: "2026-01-01", end_date: "2026-12-31", is_deleted: false,
  } as Project;
}

function task(id: string, project_id: string, over: Partial<Task> = {}): Task {
  return {
    id, name: id, project_id, todo_ids: [], assignee_member_id: "m1", assignee_member_ids: ["m1"],
    status: "todo", priority: null, start_date: null, due_date: null, estimated_hours: null,
    comment: "", is_deleted: false, completed_at: null, ...over,
  } as Task;
}

const base = { members: [member], consultationType: "change" as const, consultation: "x", scope: "all_pj" as const };

describe("buildPayload — prevShortIdMap（同じ会話の中でショートIDを保つ）", () => {
  it("前の送信のあとにタスクが完了して一覧から減っても、残ったタスクの番号は変わらない", () => {
    const projects = [pj("pj-1")];
    const tasks = [task("t-A", "pj-1"), task("t-B", "pj-1"), task("t-C", "pj-1")];
    const first = buildPayload({ ...base, projects, tasks });
    expect(first.shortIdMap.get("task_003")).toBe("t-C");

    // t-A が完了して送信対象から外れる
    const tasks2 = [task("t-A", "pj-1", { status: "done" }), task("t-B", "pj-1"), task("t-C", "pj-1")];
    const second = buildPayload({ ...base, projects, tasks: tasks2, prevShortIdMap: first.shortIdMap });

    expect(second.payload.projects[0].tasks.map(t => t.task_id)).toEqual(["task_002", "task_003"]);
    // 過去の提案が指していた task_003 は、今回も同じタスク
    expect(second.shortIdMap.get("task_003")).toBe("t-C");
    // 今回送らないタスクの番号も、過去の提案を引けるよう残す
    expect(second.shortIdMap.get("task_001")).toBe("t-A");
  });

  it("対象PJを切り替えて番号の並びが変わっても、同じタスク・PJには同じ番号を振る", () => {
    const projects = [pj("pj-1"), pj("pj-2")];
    const tasks = [task("t-A", "pj-1"), task("t-B", "pj-2")];
    const all = buildPayload({ ...base, projects, tasks });
    expect(all.shortIdMap.get("task_002")).toBe("t-B");
    expect(all.shortIdMap.get("pj_002")).toBe("pj-2");

    const onlyPj2 = buildPayload({ ...base, projects, tasks, targetPjId: "pj-2", prevShortIdMap: all.shortIdMap });
    expect(onlyPj2.payload.projects.map(p => p.pj_id)).toEqual(["pj_002"]);
    expect(onlyPj2.payload.projects[0].tasks.map(t => t.task_id)).toEqual(["task_002"]);
  });

  it("新しく現れたタスクには、既存の番号と重ならない新しい番号を振る", () => {
    const projects = [pj("pj-1")];
    const first = buildPayload({ ...base, projects, tasks: [task("t-A", "pj-1"), task("t-B", "pj-1")] });
    const second = buildPayload({
      ...base, projects,
      tasks: [task("t-N", "pj-1"), task("t-A", "pj-1"), task("t-B", "pj-1")],
      prevShortIdMap: first.shortIdMap,
    });
    const idOf = (uuid: string) => [...second.shortIdMap].find(([, v]) => v === uuid)?.[0];
    expect(idOf("t-A")).toBe("task_001");
    expect(idOf("t-B")).toBe("task_002");
    expect(idOf("t-N")).toBe("task_003");
    expect(new Set(second.shortIdMap.keys()).size).toBe(second.shortIdMap.size);
  });

  it("prevShortIdMap を渡さなければ従来どおり 001 から振る", () => {
    const { payload } = buildPayload({ ...base, projects: [pj("pj-1")], tasks: [task("t-A", "pj-1"), task("t-B", "pj-1")] });
    expect(payload.projects[0].pj_id).toBe("pj_001");
    expect(payload.projects[0].tasks.map(t => t.task_id)).toEqual(["task_001", "task_002"]);
  });

  it("渡した prevShortIdMap そのものは書き換えない", () => {
    const first = buildPayload({ ...base, projects: [pj("pj-1")], tasks: [task("t-A", "pj-1")] });
    const snapshot = [...first.shortIdMap];
    buildPayload({ ...base, projects: [pj("pj-1")], tasks: [task("t-A", "pj-1"), task("t-B", "pj-1")], prevShortIdMap: first.shortIdMap });
    expect([...first.shortIdMap]).toEqual(snapshot);
  });
});
