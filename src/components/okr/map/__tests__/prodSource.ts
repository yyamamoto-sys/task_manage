// 本番の appStore と同じ形の小さな架空データ（production.test.tsx が使う）
import type { KeyResult, Member, Objective, Project, ProjectTaskForce, Task, TaskForce, TaskTaskForce } from "../../../../lib/localData/types";
import type { OkrMapSource } from "../adapter";

export const G = "grp-a";
export const obj = (o: Partial<Objective>): Objective => ({ id: "o1", title: "地域と一緒に動く", period: "2026下期", is_current: true, group_id: G, ...o });
const kr = (id: string, title: string, objective_id = "o1"): KeyResult => ({ id, objective_id, title, is_deleted: false });
const tf = (id: string, kr_id: string, tf_number: string, quarter: TaskForce["quarter"], name = id): TaskForce => ({ id, kr_id, tf_number, quarter, name, leader_member_id: null, is_deleted: false });
const pj = (id: string, name = id, extra: Partial<Project> = {}): Project => ({
  id,
  name,
  purpose: "",
  contribution_memo: "",
  owner_member_id: "u1",
  owner_member_ids: ["u1"],
  status: "active",
  color_tag: "#888",
  start_date: "2026-07-01",
  end_date: "2026-12-31",
  is_deleted: false,
  group_id: G,
  ...extra,
});
const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id,
  name: id,
  project_id: "p1",
  todo_ids: [],
  assignee_member_id: "u1",
  assignee_member_ids: ["u1"],
  status: "todo",
  priority: null,
  start_date: null,
  due_date: "2026-11-20",
  estimated_hours: null,
  comment: "",
  is_deleted: false,
  updated_at: "2026-11-10T09:00:00+09:00",
  ...extra,
});
const member = (id: string, name: string): Member => ({ id, display_name: name, short_name: name, initials: name[0], teams_account: "", color_bg: "#123456", color_text: "#fff", is_deleted: false });

export function source(over: Partial<OkrMapSource> = {}): OkrMapSource {
  return {
    objectives: [obj({}), obj({ id: "o-other", group_id: "grp-b", title: "別部署のO" })],
    keyResults: [kr("k1", "パートナーを30社に"), kr("k2", "稼働率を80%に"), kr("k-other", "別部署のKR", "o-other")],
    taskForces: [
      tf("tf1-3q", "k1", "1", "3Q", "紹介ルートを試す"),
      tf("tf1-4q", "k1", "1", "4Q", "新規開拓を仕組みにする"),
      tf("tf2-4q", "k2", "1", "4Q", "予約を分かりやすく"),
      tf("tf-other", "k-other", "1", "4Q"),
    ],
    projectTaskForces: [
      { project_id: "p1", tf_id: "tf1-4q" },
      { project_id: "p1", tf_id: "tf1-3q" },
      { project_id: "p2", tf_id: "tf2-4q" },
    ] satisfies ProjectTaskForce[],
    taskTaskForces: [{ task_id: "t-direct", tf_id: "tf2-4q" }] satisfies TaskTaskForce[],
    projects: [pj("p1", "提案資料"), pj("p2", "予約サイト"), pj("p3", "TFなしのPJ")],
    tasks: [
      task("t-open"),
      task("t-doing", { status: "in_progress", assignee_member_id: "u2" }),
      task("t-hold", { status: "on_hold" }),
      task("t-cancel", { status: "cancelled" }),
      task("t-deleted", { is_deleted: true }),
      task("t-done-3q", { status: "done", completed_at: "2026-08-20T10:00:00+09:00" }),
      task("t-done-4q", { status: "done", completed_at: "2026-11-05T10:00:00+09:00", project_id: "p2" }),
      task("t-parent", { project_id: "p2" }),
      task("t-child", { project_id: "p2", parent_task_id: "t-parent", due_date: null }),
      task("t-personal", { project_id: null }),
      task("t-direct", { project_id: "p3" }),
      task("t-elsewhere", { project_id: "p-not-scoped" }),
    ],
    members: [member("u1", "山田 一郎"), member("u2", "佐々木 花子")],
    groupId: G,
    viewerId: "u1",
    today: "2026-11-17",
    quarter: "4Q",
    ...over,
  };
}

