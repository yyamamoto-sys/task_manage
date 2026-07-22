// saveTask の完了ハードゲート・addTaskDependency の循環防止が
// appStore の choke point として正しく配線されていることを確認する単体テスト。
//
// 【方針】
// ブロックされるケースはガード判定が DB 呼び出しより前に return/throw するため、
// ネットワーク（Supabase）に触れずに検証できる。許可されるケース（実際に保存が
// 走る側）はネットワーク依存になるため、ここでは扱わない
// （純粋なゲート判定ロジック自体は lib/dependencies/__tests__/gate.test.ts /
// cycleCheck.test.ts で網羅する）。

import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore } from "../appStore";
import type { Task, TaskDependency } from "../../lib/localData/types";

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    name: "task",
    project_id: null,
    todo_ids: [],
    assignee_member_id: "",
    assignee_member_ids: [],
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

function makeDep(overrides: Partial<TaskDependency> & { predecessor_task_id: string; successor_task_id: string }): TaskDependency {
  return {
    id: `${overrides.predecessor_task_id}->${overrides.successor_task_id}`,
    is_deleted: false,
    ...overrides,
  };
}

beforeEach(() => {
  useAppStore.setState({
    tasks: [],
    taskDependencies: [],
    currentGroupId: "grp-egg",
  });
});

describe("saveTask: 完了ハードゲート（B1）", () => {
  it("未完了の先行タスクがあると status=done への保存を拒否し、state も変えない", async () => {
    const pred = makeTask({ id: "t-pred", name: "先行タスク", status: "todo" });
    const succ = makeTask({ id: "t-succ", name: "後続タスク", status: "in_progress" });
    const dep = makeDep({ predecessor_task_id: "t-pred", successor_task_id: "t-succ" });
    useAppStore.setState({ tasks: [pred, succ], taskDependencies: [dep] });

    await expect(
      useAppStore.getState().saveTask({ ...succ, status: "done" }),
    ).rejects.toThrow(/先行タスク.*未完了/);

    // ブロック時は楽観更新すら行わない（optimistic set をスキップする設計）
    expect(useAppStore.getState().tasks.find(t => t.id === "t-succ")?.status).toBe("in_progress");
  });

  it("依存先が複数あり1件でも未完了なら拒否する", async () => {
    const pred1 = makeTask({ id: "p1", name: "先行1", status: "done" });
    const pred2 = makeTask({ id: "p2", name: "先行2", status: "todo" });
    const succ  = makeTask({ id: "succ", status: "todo" });
    const deps = [
      makeDep({ predecessor_task_id: "p1", successor_task_id: "succ" }),
      makeDep({ predecessor_task_id: "p2", successor_task_id: "succ" }),
    ];
    useAppStore.setState({ tasks: [pred1, pred2, succ], taskDependencies: deps });

    await expect(
      useAppStore.getState().saveTask({ ...succ, status: "done" }),
    ).rejects.toThrow(/先行2/);
  });

});

describe("addTaskDependency: 循環・自己依存・重複の防止（B1）", () => {
  it("自己依存を拒否し state を変えない", async () => {
    await expect(
      useAppStore.getState().addTaskDependency("t1", "t1", "m1"),
    ).rejects.toThrow(/自分自身/);
    expect(useAppStore.getState().taskDependencies).toHaveLength(0);
  });

  it("重複する依存を拒否する", async () => {
    const dep = makeDep({ predecessor_task_id: "t1", successor_task_id: "t2" });
    useAppStore.setState({ taskDependencies: [dep] });

    await expect(
      useAppStore.getState().addTaskDependency("t1", "t2", "m1"),
    ).rejects.toThrow(/すでに設定済み/);
    expect(useAppStore.getState().taskDependencies).toHaveLength(1);
  });

  it("循環を作る組み合わせを拒否する", async () => {
    const dep = makeDep({ predecessor_task_id: "t2", successor_task_id: "t1" });
    useAppStore.setState({ taskDependencies: [dep] });

    await expect(
      useAppStore.getState().addTaskDependency("t1", "t2", "m1"),
    ).rejects.toThrow(/循環/);
    expect(useAppStore.getState().taskDependencies).toHaveLength(1);
  });

  it("is_deleted:true の依存（他クライアントの削除がrealtime UPDATEで配列に残ったもの）は重複・循環判定を邪魔しない", async () => {
    // upsertById はDELETEイベントでのみ行を除去するため、他クライアントの論理削除（UPDATE）を
    // 受け取った直後は taskDependencies 配列に is_deleted:true の行が残ったままになりうる。
    const deletedDup = makeDep({ predecessor_task_id: "t1", successor_task_id: "t2", is_deleted: true });
    useAppStore.setState({ taskDependencies: [deletedDup] });

    // 削除済みのはずの t1→t2 を再度追加してもバリデーション（自己依存・重複・循環）は通過する
    // （楽観更新は同期的にバリデーション直後へ行われるため、その後のネットワーク呼び出しの
    // 成否を待たずに検証できる。実DBが無いテスト環境ではinsertTaskDependency自体は失敗しうるが、
    // それはこのテストの検証対象ではない）
    await useAppStore.getState().addTaskDependency("t1", "t2", "m1").catch(() => { /* network is unmocked here */ });
    const deps = useAppStore.getState().taskDependencies;
    expect(deps.some(d => d.predecessor_task_id === "t1" && d.successor_task_id === "t2" && !d.is_deleted)).toBe(true);
  });
});
