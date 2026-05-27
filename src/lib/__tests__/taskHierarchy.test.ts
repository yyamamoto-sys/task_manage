import { describe, it, expect } from "vitest";
import type { Task } from "../localData/types";
import {
  childrenOf,
  isParentTask,
  leafTasks,
  topLevelTasks,
  rollupStatus,
  parentProgress,
  effectiveStatus,
  eligibleParentTasks,
  parentTaskCandidates,
} from "../taskHierarchy";

// テスト用の最小 Task ファクトリ。階層関連と集計に必要な列だけ指定可能にする。
function mk(partial: Partial<Task> & { id: string }): Task {
  return {
    id: partial.id,
    name: partial.name ?? partial.id,
    project_id: partial.project_id ?? null,
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
    created_at: partial.created_at,
    updated_at: partial.updated_at,
    completed_at: partial.completed_at ?? null,
    parent_task_id: partial.parent_task_id,
    display_order: partial.display_order,
  };
}

describe("childrenOf：display_order→created_at 順で非削除の子のみ", () => {
  const tasks: Task[] = [
    mk({ id: "p", project_id: "pj1" }),
    mk({ id: "c2", parent_task_id: "p", display_order: 2, created_at: "2026-01-01" }),
    mk({ id: "c1", parent_task_id: "p", display_order: 1, created_at: "2026-02-01" }),
    mk({ id: "c3", parent_task_id: "p", display_order: 1, created_at: "2026-01-15" }), // 同order→created_at順
    mk({ id: "cdel", parent_task_id: "p", display_order: 0, is_deleted: true }),
    mk({ id: "other", parent_task_id: "q" }),
  ];

  it("display_order 昇順、同値は created_at 昇順で並ぶ", () => {
    expect(childrenOf(tasks, "p").map(t => t.id)).toEqual(["c3", "c1", "c2"]);
  });

  it("削除済みの子・他親の子は含まない", () => {
    const ids = childrenOf(tasks, "p").map(t => t.id);
    expect(ids).not.toContain("cdel");
    expect(ids).not.toContain("other");
  });

  it("display_order 未設定（undefined）は 0 として扱う", () => {
    const t = [
      mk({ id: "p" }),
      mk({ id: "a", parent_task_id: "p", created_at: "2026-03-01" }), // order undefined=0
      mk({ id: "b", parent_task_id: "p", display_order: 1, created_at: "2026-01-01" }),
    ];
    expect(childrenOf(t, "p").map(x => x.id)).toEqual(["a", "b"]);
  });
});

describe("isParentTask / leafTasks", () => {
  const tasks: Task[] = [
    mk({ id: "p" }),
    mk({ id: "c1", parent_task_id: "p", status: "done" }),
    mk({ id: "c2", parent_task_id: "p", status: "todo" }),
    mk({ id: "flat" }),
    mk({ id: "del", is_deleted: true }),
  ];

  it("子を持つタスクは親、持たないタスクは非親", () => {
    expect(isParentTask(tasks[0], tasks)).toBe(true);   // p
    expect(isParentTask(tasks[3], tasks)).toBe(false);  // flat
  });

  it("leafTasks は親（子持ち）を除外し、子とフラットを返す", () => {
    expect(leafTasks(tasks).map(t => t.id).sort()).toEqual(["c1", "c2", "flat"]);
  });

  it("フラットデータでは葉=全非削除タスク（現状一致の根拠）", () => {
    const flat = [mk({ id: "a" }), mk({ id: "b" }), mk({ id: "c", is_deleted: true })];
    expect(leafTasks(flat).map(t => t.id)).toEqual(["a", "b"]);
  });
});

describe("topLevelTasks", () => {
  it("parent_task_id 無し・非削除のみを order 順で返す", () => {
    const tasks = [
      mk({ id: "t2", display_order: 2 }),
      mk({ id: "t1", display_order: 1 }),
      mk({ id: "child", parent_task_id: "t1" }),
      mk({ id: "del", is_deleted: true }),
    ];
    expect(topLevelTasks(tasks).map(t => t.id)).toEqual(["t1", "t2"]);
  });
});

describe("rollupStatus：各パターン", () => {
  it("子0件 → 自身の status", () => {
    const t = [mk({ id: "p", status: "in_progress" })];
    expect(rollupStatus(t[0], t)).toBe("in_progress");
  });

  it("全 done → done", () => {
    const t = [
      mk({ id: "p", status: "todo" }),
      mk({ id: "c1", parent_task_id: "p", status: "done" }),
      mk({ id: "c2", parent_task_id: "p", status: "done" }),
    ];
    expect(rollupStatus(t[0], t)).toBe("done");
  });

  it("全 todo → todo", () => {
    const t = [
      mk({ id: "p", status: "done" }),
      mk({ id: "c1", parent_task_id: "p", status: "todo" }),
      mk({ id: "c2", parent_task_id: "p", status: "todo" }),
    ];
    expect(rollupStatus(t[0], t)).toBe("todo");
  });

  it("done と in_progress 混在 → in_progress", () => {
    const t = [
      mk({ id: "p", status: "todo" }),
      mk({ id: "c1", parent_task_id: "p", status: "done" }),
      mk({ id: "c2", parent_task_id: "p", status: "in_progress" }),
    ];
    expect(rollupStatus(t[0], t)).toBe("in_progress");
  });

  it("done と todo の混在 → in_progress（仕様）", () => {
    const t = [
      mk({ id: "p", status: "todo" }),
      mk({ id: "c1", parent_task_id: "p", status: "done" }),
      mk({ id: "c2", parent_task_id: "p", status: "todo" }),
    ];
    expect(rollupStatus(t[0], t)).toBe("in_progress");
  });

  it("削除済みの子は集計に含めない", () => {
    const t = [
      mk({ id: "p", status: "todo" }),
      mk({ id: "c1", parent_task_id: "p", status: "done" }),
      mk({ id: "cdel", parent_task_id: "p", status: "todo", is_deleted: true }),
    ];
    expect(rollupStatus(t[0], t)).toBe("done");
  });

  it("effectiveStatus は rollupStatus と同値", () => {
    const t = [
      mk({ id: "p", status: "todo" }),
      mk({ id: "c1", parent_task_id: "p", status: "done" }),
    ];
    expect(effectiveStatus(t[0], t)).toBe(rollupStatus(t[0], t));
  });
});

describe("parentProgress", () => {
  it("done/total/pct を子から算出", () => {
    const t = [
      mk({ id: "p" }),
      mk({ id: "c1", parent_task_id: "p", status: "done" }),
      mk({ id: "c2", parent_task_id: "p", status: "done" }),
      mk({ id: "c3", parent_task_id: "p", status: "todo" }),
    ];
    expect(parentProgress(t, "p")).toEqual({ done: 2, total: 3, pct: 67 });
  });

  it("子0件 → total=0, pct=0", () => {
    const t = [mk({ id: "p" })];
    expect(parentProgress(t, "p")).toEqual({ done: 0, total: 0, pct: 0 });
  });
});

describe("eligibleParentTasks：2階層制約", () => {
  const tasks: Task[] = [
    mk({ id: "top1", project_id: "pj1", display_order: 1 }),
    mk({ id: "top2", project_id: "pj1", display_order: 2 }),
    mk({ id: "child1", project_id: "pj1", parent_task_id: "top1" }),
    mk({ id: "otherpj", project_id: "pj2" }),
    mk({ id: "del", project_id: "pj1", is_deleted: true }),
  ];

  it("projectId が null なら空配列（親子は同一PJ内のみ）", () => {
    expect(eligibleParentTasks(tasks, null)).toEqual([]);
  });

  it("同一PJの最上位タスクのみを候補に出す（小タスク=親持ちは除外＝孫禁止）", () => {
    expect(eligibleParentTasks(tasks, "pj1").map(t => t.id)).toEqual(["top1", "top2"]);
  });

  it("forTaskId（自分自身）は候補から除外する", () => {
    expect(eligibleParentTasks(tasks, "pj1", "top1").map(t => t.id)).toEqual(["top2"]);
  });

  it("他PJ・削除済みは候補に含めない", () => {
    const ids = eligibleParentTasks(tasks, "pj1").map(t => t.id);
    expect(ids).not.toContain("otherpj");
    expect(ids).not.toContain("del");
  });
});

describe("parentTaskCandidates：同一PJ優先・他PJも候補・最上位のみ", () => {
  const tasks: Task[] = [
    mk({ id: "top1", project_id: "pj1", display_order: 2 }),
    mk({ id: "top2", project_id: "pj1", display_order: 1 }),
    mk({ id: "child1", project_id: "pj1", parent_task_id: "top1" }),
    mk({ id: "otherA", project_id: "pj2", display_order: 2 }),
    mk({ id: "otherB", project_id: "pj2", display_order: 1 }),
    mk({ id: "del", project_id: "pj1", is_deleted: true }),
  ];

  it("同一PJの最上位を先頭に、その後に他PJの最上位を返す（各グループ内は order 順）", () => {
    // 同一PJ(pj1)：top2(order1)→top1(order2)、その後 他PJ(pj2)：otherB(order1)→otherA(order2)
    expect(parentTaskCandidates(tasks, "pj1").map(t => t.id))
      .toEqual(["top2", "top1", "otherB", "otherA"]);
  });

  it("自分自身を除外し、小タスク（親持ち）・削除済みは候補に含めない", () => {
    const ids = parentTaskCandidates(tasks, "pj1", "top1").map(t => t.id);
    expect(ids).not.toContain("top1");   // 自分自身
    expect(ids).not.toContain("child1"); // 小タスク（最上位でない）
    expect(ids).not.toContain("del");    // 削除済み
    expect(ids).toEqual(["top2", "otherB", "otherA"]);
  });

  it("currentProjectId が null でも他PJ最上位を全件（order 順）返す", () => {
    // null と一致するPJがないので全件「他PJ」グループ＝全体を order 順で返す
    expect(parentTaskCandidates(tasks, null).map(t => t.id))
      .toEqual(["top2", "otherB", "top1", "otherA"]);
  });
});
