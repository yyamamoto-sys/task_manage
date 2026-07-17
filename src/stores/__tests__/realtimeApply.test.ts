// applyRemoteChange の単体テスト。
// realtime 経由で受け取った postgres_changes イベントが
// store に正しく反映されることを確認する。

import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore } from "../appStore";

function reset() {
  useAppStore.setState({
    members: [],
    objective: null,
    keyResults: [],
    taskForces: [],
    todos: [],
    projects: [],
    tasks: [],
    projectTaskForces: [],
    quarterlyObjectives: [],
    quarterlyKrTaskForces: [],
    taskTaskForces: [],
    taskProjects: [],
    taskDependencies: [],
    milestones: [],
    memberTags: [],
    memberTagMembers: [],
    loading: false,
    error: null,
  });
}

beforeEach(reset);

describe("applyRemoteChange: id ベースのテーブル", () => {
  it("INSERT で新規 task を追加する", () => {
    useAppStore.getState().applyRemoteChange({
      table: "tasks",
      eventType: "INSERT",
      new: {
        id: "t1", name: "新しいタスク", status: "todo",
        is_deleted: false, updated_at: "2026-05-18T10:00:00Z",
      },
      old: null,
    });

    const { tasks } = useAppStore.getState();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe("t1");
    expect(tasks[0].name).toBe("新しいタスク");
  });

  it("UPDATE で既存 task を上書きする", () => {
    useAppStore.setState({
      tasks: [{
        id: "t1", name: "古い", status: "todo",
        is_deleted: false, updated_at: "2026-05-18T10:00:00Z",
      } as never],
    });

    useAppStore.getState().applyRemoteChange({
      table: "tasks",
      eventType: "UPDATE",
      new: {
        id: "t1", name: "新しい", status: "in_progress",
        is_deleted: false, updated_at: "2026-05-18T11:00:00Z",
      },
      old: null,
    });

    const t = useAppStore.getState().tasks[0];
    expect(t.name).toBe("新しい");
    expect(t.status).toBe("in_progress");
  });

  it("手元の updated_at の方が新しい場合は無視する（stale 防止）", () => {
    useAppStore.setState({
      tasks: [{
        id: "t1", name: "ローカル新", status: "in_progress",
        is_deleted: false, updated_at: "2026-05-18T12:00:00Z",
      } as never],
    });

    useAppStore.getState().applyRemoteChange({
      table: "tasks",
      eventType: "UPDATE",
      new: {
        id: "t1", name: "サーバ古い", status: "todo",
        is_deleted: false, updated_at: "2026-05-18T11:00:00Z",
      },
      old: null,
    });

    const t = useAppStore.getState().tasks[0];
    expect(t.name).toBe("ローカル新");
    expect(t.status).toBe("in_progress");
  });

  it("DELETE で物理削除する（中間テーブル解除用）", () => {
    useAppStore.setState({
      tasks: [
        { id: "t1", name: "残す", status: "todo", is_deleted: false } as never,
        { id: "t2", name: "消す", status: "todo", is_deleted: false } as never,
      ],
    });

    useAppStore.getState().applyRemoteChange({
      table: "tasks",
      eventType: "DELETE",
      new: null,
      old: { id: "t2" },
    });

    const ids = useAppStore.getState().tasks.map(t => t.id);
    expect(ids).toEqual(["t1"]);
  });

  it("soft delete（is_deleted=true）は UPDATE として配列に残す", () => {
    useAppStore.setState({
      tasks: [{
        id: "t1", name: "x", status: "todo",
        is_deleted: false, updated_at: "2026-05-18T10:00:00Z",
      } as never],
    });

    useAppStore.getState().applyRemoteChange({
      table: "tasks",
      eventType: "UPDATE",
      new: {
        id: "t1", name: "x", status: "todo",
        is_deleted: true, deleted_at: "2026-05-18T11:00:00Z",
        updated_at: "2026-05-18T11:00:00Z",
      },
      old: null,
    });

    const t = useAppStore.getState().tasks[0];
    expect(t.is_deleted).toBe(true);
    expect(useAppStore.getState().tasks).toHaveLength(1);
  });

  it("projects / todos / members など他のテーブルにもルーティングされる", () => {
    useAppStore.getState().applyRemoteChange({
      table: "projects",
      eventType: "INSERT",
      new: { id: "p1", name: "新PJ", is_deleted: false, updated_at: "2026-05-18T10:00:00Z" },
      old: null,
    });
    useAppStore.getState().applyRemoteChange({
      table: "members",
      eventType: "INSERT",
      new: { id: "m1", display_name: "山本", is_deleted: false, updated_at: "2026-05-18T10:00:00Z" },
      old: null,
    });

    expect(useAppStore.getState().projects).toHaveLength(1);
    expect(useAppStore.getState().members).toHaveLength(1);
  });

  it("task_dependencies（B1）も id ベースでルーティングされる", () => {
    useAppStore.getState().applyRemoteChange({
      table: "task_dependencies",
      eventType: "INSERT",
      new: {
        id: "d1", predecessor_task_id: "t1", successor_task_id: "t2",
        is_deleted: false, updated_at: "2026-07-17T10:00:00Z",
      },
      old: null,
    });

    const deps = useAppStore.getState().taskDependencies;
    expect(deps).toHaveLength(1);
    expect(deps[0]).toMatchObject({ predecessor_task_id: "t1", successor_task_id: "t2" });
  });
});

describe("applyRemoteChange: 複合キーの中間テーブル", () => {
  it("INSERT で新規 task_task_force を追加（重複は no-op）", () => {
    const change = {
      table: "task_task_forces",
      eventType: "INSERT" as const,
      new: { task_id: "t1", tf_id: "f1" },
      old: null,
    };
    useAppStore.getState().applyRemoteChange(change);
    useAppStore.getState().applyRemoteChange(change); // 二度目は no-op

    expect(useAppStore.getState().taskTaskForces).toHaveLength(1);
    expect(useAppStore.getState().taskTaskForces[0]).toMatchObject({ task_id: "t1", tf_id: "f1" });
  });

  it("DELETE で複合キー一致のレコードのみ削除", () => {
    useAppStore.setState({
      taskTaskForces: [
        { task_id: "t1", tf_id: "f1" } as never,
        { task_id: "t1", tf_id: "f2" } as never,
        { task_id: "t2", tf_id: "f1" } as never,
      ],
    });

    useAppStore.getState().applyRemoteChange({
      table: "task_task_forces",
      eventType: "DELETE",
      new: null,
      old: { task_id: "t1", tf_id: "f1" },
    });

    const ttfs = useAppStore.getState().taskTaskForces;
    expect(ttfs).toHaveLength(2);
    expect(ttfs.find(t => t.task_id === "t1" && t.tf_id === "f1")).toBeUndefined();
  });

  it("task_projects と project_task_forces も同様にハンドルされる", () => {
    useAppStore.getState().applyRemoteChange({
      table: "task_projects",
      eventType: "INSERT",
      new: { task_id: "t1", project_id: "p1" },
      old: null,
    });
    useAppStore.getState().applyRemoteChange({
      table: "project_task_forces",
      eventType: "INSERT",
      new: { project_id: "p1", tf_id: "f1" },
      old: null,
    });

    expect(useAppStore.getState().taskProjects).toHaveLength(1);
    expect(useAppStore.getState().projectTaskForces).toHaveLength(1);
  });
});

describe("applyRemoteChange: 想定外", () => {
  it("購読対象外のテーブルは無視する", () => {
    useAppStore.getState().applyRemoteChange({
      table: "ai_usage_logs",
      eventType: "INSERT",
      new: { id: "u1" },
      old: null,
    });

    // 何も変化しない（クラッシュしない）
    expect(useAppStore.getState().tasks).toHaveLength(0);
  });

  it("new / old どちらも null なら no-op", () => {
    useAppStore.getState().applyRemoteChange({
      table: "tasks",
      eventType: "UPDATE",
      new: null,
      old: null,
    });
    expect(useAppStore.getState().tasks).toHaveLength(0);
  });
});
