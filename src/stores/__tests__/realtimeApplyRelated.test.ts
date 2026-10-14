// applyRemoteChange が「tasks/projects の変更で一緒に変わる表」を load() なしで反映できること（v3.146・Section 76）。
// 旧 AppDataContext は tasks/projects の変更で全件 load() していた。その代わりを差分だけで果たせるかの確認。
import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore } from "../appStore";

beforeEach(() => {
  useAppStore.setState({
    tasks: [], projects: [], todos: [], milestones: [], members: [], keyResults: [], taskForces: [],
    taskTaskForces: [], taskProjects: [], projectTaskForces: [], taskDependencies: [],
  });
});

const ev = (table: string, eventType: "INSERT" | "UPDATE" | "DELETE", row: Record<string, unknown>) =>
  useAppStore.getState().applyRemoteChange({
    table, eventType,
    new: eventType === "DELETE" ? null : row,
    old: eventType === "DELETE" ? row : null,
  });

describe("applyRemoteChange：load() の代わりを果たす", () => {
  it("tasks の group_ids 変更（DBトリガー sync_task_group_ids・projects からのカスケード）は UPDATE の行に載って届き反映される", () => {
    ev("tasks", "INSERT", { id: "t1", group_ids: ["g1"], updated_at: "2026-10-14T00:00:00Z" });
    ev("tasks", "UPDATE", { id: "t1", group_ids: ["g1", "g2"], updated_at: "2026-10-14T00:00:01Z" });
    expect(useAppStore.getState().tasks[0].group_ids).toEqual(["g1", "g2"]);
  });
  it("関連表（task_projects・task_task_forces・project_task_forces・task_dependencies・milestones）が差分で入る／消える", () => {
    ev("task_projects", "INSERT", { task_id: "t1", project_id: "p1" });
    ev("task_task_forces", "INSERT", { task_id: "t1", tf_id: "tf1" });
    ev("project_task_forces", "INSERT", { project_id: "p1", tf_id: "tf1" });
    ev("task_dependencies", "INSERT", { id: "d1", predecessor_task_id: "t1", successor_task_id: "t2", updated_at: "2026-10-14T00:00:00Z" });
    ev("milestones", "INSERT", { id: "m1", updated_at: "2026-10-14T00:00:00Z" });
    const s = useAppStore.getState();
    expect([s.taskProjects.length, s.taskTaskForces.length, s.projectTaskForces.length, s.taskDependencies.length, s.milestones.length]).toEqual([1, 1, 1, 1, 1]);
    ev("task_projects", "DELETE", { task_id: "t1", project_id: "p1" });
    ev("task_task_forces", "DELETE", { task_id: "t1", tf_id: "tf1" });
    expect(useAppStore.getState().taskProjects).toHaveLength(0);
    expect(useAppStore.getState().taskTaskForces).toHaveLength(0);
  });
  it("tasks/projects の行は load() と同じ形にそろえて入る（配列列が null の旧データでも落ちない）", () => {
    ev("tasks", "INSERT", { id: "t1", todo_ids: null, assignee_member_ids: null, tags: null, assignee_member_id: "m1", updated_at: "2026-10-14T00:00:00Z" });
    ev("projects", "INSERT", { id: "p1", owner_member_ids: null, owner_member_id: "m1", member_ids: null, updated_at: "2026-10-14T00:00:00Z" });
    const s = useAppStore.getState();
    expect(s.tasks[0].todo_ids).toEqual([]);
    expect(s.tasks[0].assignee_member_ids).toEqual(["m1"]);
    expect(s.tasks[0].tags).toEqual([]);
    expect(s.projects[0].owner_member_ids).toEqual(["m1"]);
    expect(s.projects[0].member_ids).toEqual([]);
  });
  it("tasks の DELETE（old は主キーのみ）でも消える", () => {
    ev("tasks", "INSERT", { id: "t1", updated_at: "2026-10-14T00:00:00Z" });
    ev("tasks", "DELETE", { id: "t1" });
    expect(useAppStore.getState().tasks).toHaveLength(0);
  });
});
