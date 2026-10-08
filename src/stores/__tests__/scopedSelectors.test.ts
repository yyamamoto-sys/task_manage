import { describe, it, expect, beforeEach } from "vitest";
import {
  useAppStore,
  selectScopedTasks,
  selectScopedProjects,
  selectScopedMembers,
  selectScopedTaskDependencies,
} from "../appStore";
import type { Member, Project, Task, TaskDependency } from "../../lib/localData/types";
import { buildDemoDataset } from "../../lib/demo/dataset";
import { applyGuestPersona } from "../../lib/demo/guestPersona";
import { DEMO_GROUP_ID } from "../../lib/demo/constants";

const member = (id: string, group_id: string | null, group_ids?: string[], is_deleted = false): Member => ({
  id, display_name: id, short_name: id, initials: id, teams_account: "",
  color_bg: "#000", color_text: "#fff", is_deleted, group_id, group_ids,
});
const project = (id: string, group_id: string | null, group_ids?: string[]): Project => ({
  id, name: id, owner_member_id: "", owner_member_ids: [], is_deleted: false, group_id, group_ids,
} as unknown as Project);
const task = (id: string, group_id: string | null, group_ids?: string[]): Task => ({
  id, name: id, project_id: null, todo_ids: [], assignee_member_id: "", assignee_member_ids: [],
  status: "todo", priority: null, start_date: null, due_date: null, estimated_hours: null,
  comment: "", is_deleted: false, group_id, group_ids,
});
const dep = (id: string, pred: string, succ: string, group_id: string | null): TaskDependency => ({
  id, predecessor_task_id: pred, successor_task_id: succ, is_deleted: false, group_id,
});

beforeEach(() => {
  useAppStore.setState({ currentGroupId: null, currentUserIsSuperAdmin: false, members: [], projects: [], tasks: [], taskDependencies: [] });
});

// 2026-07-03: selectScoped* が毎回新しい配列を返すと、zustand v5（React の useSyncExternalStore 経由）が
// 「state が変化し続けている」と誤判定し、React error #185 で全画面がクラッシュする事故が本番で発生した。
describe("selectScoped* のメモ化契約", () => {
  it("同じ state オブジェクトに対しては同じ配列参照を返す（絞り込みが効いている状態でも）", () => {
    useAppStore.setState({
      currentGroupId: "grp-a",
      members: [member("m-a", "grp-a"), member("m-b", "grp-b")],
      projects: [project("p-a", "grp-a"), project("p-b", "grp-b")],
      tasks: [task("t-a", "grp-a"), task("t-b", "grp-b")],
      taskDependencies: [dep("d-1", "t-a", "t-b", "grp-a")],
    });
    const state = useAppStore.getState();
    expect(selectScopedTasks(state)).toBe(selectScopedTasks(state));
    expect(selectScopedProjects(state)).toBe(selectScopedProjects(state));
    expect(selectScopedMembers(state)).toBe(selectScopedMembers(state));
    expect(selectScopedTaskDependencies(state)).toBe(selectScopedTaskDependencies(state));
  });

  it("無関係な state 更新では同じ参照を返す（配列を依存に持つ effect が store を書き換える画面で再実行が連鎖しないように）", () => {
    useAppStore.setState({
      currentGroupId: "grp-a",
      members: [member("m-a", "grp-a"), member("m-b", "grp-b")],
      tasks: [task("t-a", "grp-a"), task("t-b", "grp-b")],
      taskDependencies: [dep("d-1", "t-a", "t-a", "grp-a")],
    });
    const before = useAppStore.getState();
    const t = selectScopedTasks(before), m = selectScopedMembers(before), d = selectScopedTaskDependencies(before), p = selectScopedProjects(before);
    useAppStore.setState({ currentUserIsSuperAdmin: !before.currentUserIsSuperAdmin });
    const after = useAppStore.getState();
    expect(after).not.toBe(before);
    expect(selectScopedTasks(after)).toBe(t);
    expect(selectScopedMembers(after)).toBe(m);
    expect(selectScopedTaskDependencies(after)).toBe(d);
    expect(selectScopedProjects(after)).toBe(p);
  });

  it("store が実際に更新された後は新しい参照を返す（stale data を返さない）", () => {
    useAppStore.setState({ currentGroupId: "grp-a", tasks: [task("t-a", "grp-a")], members: [member("m-a", "grp-a")] });
    const before = selectScopedTasks(useAppStore.getState());
    useAppStore.setState({ tasks: [...useAppStore.getState().tasks, task("t-a2", "grp-a")] });
    expect(selectScopedTasks(useAppStore.getState())).not.toBe(before);
    expect(selectScopedTasks(useAppStore.getState()).map(t => t.id)).toEqual(["t-a", "t-a2"]);

    const beforeMembers = selectScopedMembers(useAppStore.getState());
    useAppStore.setState({ members: [...useAppStore.getState().members, member("m-a2", "grp-a")] });
    expect(selectScopedMembers(useAppStore.getState())).not.toBe(beforeMembers);
  });
});

// v3.139：表示部署（currentGroupId）単位の絞り込みを、super_admin・一般・兼務者の全員に適用する。
// v2.91 の「非super_adminは一切絞らない」割り切りは撤回した（CLAUDE.md Section 71）。
describe("selectScopedMembers：表示部署のメンバーだけ（全員共通）", () => {
  it("一般メンバーでも他部署のメンバーは除外される（部署をまたぐPJでストアに載った人を候補に出さない）", () => {
    useAppStore.setState({
      currentGroupId: "grp-a",
      currentUserIsSuperAdmin: false,
      members: [member("m-a", "grp-a"), member("m-b", "grp-b"), member("m-null", null)],
    });
    expect(selectScopedMembers(useAppStore.getState()).map(m => m.id)).toEqual(["m-a"]);
  });

  it("super_admin も同じ判定", () => {
    useAppStore.setState({
      currentGroupId: "grp-a",
      currentUserIsSuperAdmin: true,
      members: [member("m-a", "grp-a"), member("m-b", "grp-b")],
    });
    expect(selectScopedMembers(useAppStore.getState()).map(m => m.id)).toEqual(["m-a"]);
  });

  it("兼務者（group_ids に表示部署を含む）は含まれ、表示部署を切り替えると候補が切り替わる", () => {
    useAppStore.setState({
      currentGroupId: "grp-a",
      members: [member("m-a", "grp-a"), member("m-ab", "grp-b", ["grp-b", "grp-a"]), member("m-b", "grp-b", ["grp-b"])],
    });
    expect(selectScopedMembers(useAppStore.getState()).map(m => m.id)).toEqual(["m-a", "m-ab"]);
    useAppStore.setState({ currentGroupId: "grp-b" });
    expect(selectScopedMembers(useAppStore.getState()).map(m => m.id)).toEqual(["m-ab", "m-b"]);
  });

  it("削除済みメンバーは出ない", () => {
    useAppStore.setState({ currentGroupId: "grp-a", members: [member("m-a", "grp-a"), member("m-del", "grp-a", undefined, true)] });
    expect(selectScopedMembers(useAppStore.getState()).map(m => m.id)).toEqual(["m-a"]);
  });

  it("currentGroupId が null（未確定）の間は絞らず元配列をそのまま返す", () => {
    useAppStore.setState({ currentGroupId: null, members: [member("m-a", "grp-a"), member("m-b", "grp-b")] });
    const state = useAppStore.getState();
    expect(selectScopedMembers(state)).toBe(state.members);
  });
});

describe("selectScopedProjects / selectScopedTasks：表示部署で絞る（全員共通）", () => {
  it("一般メンバーでも他部署のPJ・タスクは除外される", () => {
    useAppStore.setState({
      currentGroupId: "grp-a",
      currentUserIsSuperAdmin: false,
      projects: [project("p-a", "grp-a", ["grp-a"]), project("p-b", "grp-b", ["grp-b"])],
      tasks: [task("t-a", "grp-a", ["grp-a"]), task("t-b", "grp-b", ["grp-b"])],
    });
    const s = useAppStore.getState();
    expect(selectScopedProjects(s).map(p => p.id)).toEqual(["p-a"]);
    expect(selectScopedTasks(s).map(t => t.id)).toEqual(["t-a"]);
  });

  it("部署をまたぐPJ（とそのタスク）は、属する各部署で表示される", () => {
    useAppStore.setState({
      currentGroupId: "grp-a",
      projects: [project("p-ab", "grp-b", ["grp-b", "grp-a"])],
      tasks: [task("t-ab", "grp-b", ["grp-b", "grp-a"])],
    });
    expect(selectScopedProjects(useAppStore.getState()).map(p => p.id)).toEqual(["p-ab"]);
    expect(selectScopedTasks(useAppStore.getState()).map(t => t.id)).toEqual(["t-ab"]);
    useAppStore.setState({ currentGroupId: "grp-b" });
    expect(selectScopedProjects(useAppStore.getState()).map(p => p.id)).toEqual(["p-ab"]);
    expect(selectScopedTasks(useAppStore.getState()).map(t => t.id)).toEqual(["t-ab"]);
    useAppStore.setState({ currentGroupId: "grp-c" });
    expect(selectScopedProjects(useAppStore.getState())).toEqual([]);
    expect(selectScopedTasks(useAppStore.getState())).toEqual([]);
  });

  it("招待受諾者（表示部署＝招待用部署）には招待されたPJとそのタスクが見える", () => {
    useAppStore.setState({
      currentGroupId: "grp-invite-p1",
      projects: [project("p1", "grp-a", ["grp-a", "grp-invite-p1"]), project("p2", "grp-a", ["grp-a"])],
      tasks: [task("t1", "grp-a", ["grp-a", "grp-invite-p1"]), task("t2", "grp-a", ["grp-a"])],
    });
    expect(selectScopedProjects(useAppStore.getState()).map(p => p.id)).toEqual(["p1"]);
    expect(selectScopedTasks(useAppStore.getState()).map(t => t.id)).toEqual(["t1"]);
  });

  it("group_ids が空/未定義の古い行・作成直後の行は group_id で判定し、group_id==null は通す", () => {
    useAppStore.setState({
      currentGroupId: "grp-a",
      projects: [project("p-a", "grp-a"), project("p-b", "grp-b", []), project("p-null", null)],
      tasks: [task("t-a", "grp-a"), task("t-b", "grp-b"), task("t-null", null)],
    });
    expect(selectScopedProjects(useAppStore.getState()).map(p => p.id)).toEqual(["p-a", "p-null"]);
    expect(selectScopedTasks(useAppStore.getState()).map(t => t.id)).toEqual(["t-a", "t-null"]);
  });

  it("currentGroupId が null（未確定）の間は絞らず元配列をそのまま返す", () => {
    useAppStore.setState({
      currentGroupId: null,
      projects: [project("p-a", "grp-a"), project("p-b", "grp-b")],
      tasks: [task("t-a", "grp-a"), task("t-b", "grp-b")],
      taskDependencies: [dep("d", "t-a", "t-b", "grp-a")],
    });
    const s = useAppStore.getState();
    expect(selectScopedProjects(s)).toBe(s.projects);
    expect(selectScopedTasks(s)).toBe(s.tasks);
    expect(selectScopedTaskDependencies(s)).toBe(s.taskDependencies);
  });
});

describe("selectScopedTaskDependencies：両端が絞り込み後のタスクに含まれるものだけ", () => {
  it("片端が他部署のタスクなら除外（group_id 単数では判定しない）", () => {
    useAppStore.setState({
      currentGroupId: "grp-a",
      tasks: [task("t-a1", "grp-a"), task("t-a2", "grp-a"), task("t-b", "grp-b"), task("t-ab", "grp-b", ["grp-b", "grp-a"])],
      taskDependencies: [
        dep("d-in", "t-a1", "t-a2", "grp-a"),
        dep("d-cross", "t-a1", "t-b", "grp-a"),
        dep("d-shared", "t-a2", "t-ab", "grp-b"),
      ],
    });
    expect(selectScopedTaskDependencies(useAppStore.getState()).map(d => d.id)).toEqual(["d-in", "d-shared"]);
  });
});

describe("ゲストのデモデータは表示部署（DEMO_GROUP_ID）で絞っても全件残る", () => {
  it("members/projects/tasks/taskDependencies が1件も落ちない", () => {
    const ds = applyGuestPersona(buildDemoDataset());
    useAppStore.setState({
      currentGroupId: DEMO_GROUP_ID,
      members: ds.members, projects: ds.projects, tasks: ds.tasks, taskDependencies: ds.taskDependencies,
    });
    const s = useAppStore.getState();
    expect(selectScopedMembers(s).length).toBe(ds.members.filter(m => !m.is_deleted).length);
    expect(selectScopedProjects(s).length).toBe(ds.projects.length);
    expect(selectScopedTasks(s).length).toBe(ds.tasks.length);
    expect(selectScopedTaskDependencies(s).length).toBe(ds.taskDependencies.length);
  });
});
