import { describe, it, expect } from "vitest";
import { useAppStore, selectScopedTasks, selectScopedProjects, selectScopedMembers } from "../appStore";

// 2026-07-03: selectScopedTasks/selectScopedProjects が毎回新しい配列を返すと、
// zustand v5（React の useSyncExternalStore 経由）が「state が変化し続けている」と
// 誤判定し、React error #185 (Maximum update depth exceeded) で全画面がクラッシュする
// 事故が本番で発生した。同じ state オブジェクトに対しては同じ配列参照を返すことを保証する。
describe("selectScopedTasks / selectScopedProjects / selectScopedMembers のメモ化契約", () => {
  it("同じ state オブジェクトに対しては同じ配列参照を返す（useSyncExternalStore の必須要件）", () => {
    const state = useAppStore.getState();
    expect(selectScopedTasks(state)).toBe(selectScopedTasks(state));
    expect(selectScopedProjects(state)).toBe(selectScopedProjects(state));
    expect(selectScopedMembers(state)).toBe(selectScopedMembers(state));
  });

  it("store が実際に更新された後は新しい参照を返す（stale data を返さない）", () => {
    const before = selectScopedTasks(useAppStore.getState());
    useAppStore.setState({ tasks: [...useAppStore.getState().tasks] });
    const after = selectScopedTasks(useAppStore.getState());
    expect(before).not.toBe(after);

    const beforePjs = selectScopedProjects(useAppStore.getState());
    useAppStore.setState({ projects: [...useAppStore.getState().projects] });
    const afterPjs = selectScopedProjects(useAppStore.getState());
    expect(beforePjs).not.toBe(afterPjs);

    const beforeMembers = selectScopedMembers(useAppStore.getState());
    useAppStore.setState({ members: [...useAppStore.getState().members] });
    const afterMembers = selectScopedMembers(useAppStore.getState());
    expect(beforeMembers).not.toBe(afterMembers);
  });
});

// 2026-07-03: AI相談・全PJ分析・KR分析・会議取り込み等が素の s.members を参照していたため、
// super-adminが他部署向けにAI機能を使うと、対象外部署のメンバー氏名までAnthropic APIへ
// 送信されてしまっていた（tasks/projectsは元から絞り込み済みだった）。この回帰を防ぐ。
// 【2026-07-23更新】この絞り込みは currentUserIsSuperAdmin=true のときのみ発生する
// （非super-adminはRLSが既に絞っているため、以下のテストは明示的にsuper-adminをセットする）。
describe("selectScopedMembers の絞り込みロジック（super-admin）", () => {
  it("super-adminは group_idが自分のcurrentGroupIdと異なるメンバーを除外する", () => {
    const before = useAppStore.getState();
    useAppStore.setState({
      currentGroupId: "grp-a",
      currentUserIsSuperAdmin: true,
      members: [
        { ...before.members[0], id: "m-a", group_id: "grp-a" } as typeof before.members[0],
        { ...before.members[0], id: "m-b", group_id: "grp-b" } as typeof before.members[0],
        { ...before.members[0], id: "m-null", group_id: null } as typeof before.members[0],
      ],
    });
    const scoped = selectScopedMembers(useAppStore.getState());
    const ids = scoped.map(m => m.id);
    expect(ids).toContain("m-a");
    expect(ids).toContain("m-null");
    expect(ids).not.toContain("m-b");
  });
});

// 【2026-07-23追加】複数部署アクセス フェーズ2：非super-admin（兼務者含む一般ユーザー）は
// RLSが既に「自部署＋兼務先」だけを返しているため、クライアント側では一切絞り込まない。
// ここで t.group_id === currentGroupId の単一値比較を重ねると、RLSでは見えている兼務2部署目が
// UIから消える回帰になるため、それを直接検知するテストを置く。
describe("selectScopedTasks / selectScopedProjects の絞り込みロジック（非super-admin・複数部署アクセス）", () => {
  it("非super-adminのとき selectScopedTasks は s.tasks と同一参照を返す（フィルタしない）", () => {
    const before = useAppStore.getState();
    useAppStore.setState({
      currentGroupId: "grp-a",
      currentUserIsSuperAdmin: false,
      tasks: [
        { ...before.tasks[0], id: "t-a", group_id: "grp-a" } as typeof before.tasks[0],
      ],
    });
    const state = useAppStore.getState();
    expect(selectScopedTasks(state)).toBe(state.tasks);
  });

  it("非super-adminのとき currentGroupIdと異なるgroup_idのタスクが除外されずに含まれる（兼務2部署目が消えない）", () => {
    const before = useAppStore.getState();
    useAppStore.setState({
      currentGroupId: "grp-a",
      currentUserIsSuperAdmin: false,
      tasks: [
        { ...before.tasks[0], id: "t-a", group_id: "grp-a" } as typeof before.tasks[0],
        { ...before.tasks[0], id: "t-b", group_id: "grp-b" } as typeof before.tasks[0],
      ],
    });
    const scoped = selectScopedTasks(useAppStore.getState());
    const ids = scoped.map(t => t.id);
    expect(ids).toContain("t-a");
    expect(ids).toContain("t-b");
  });

  it("super-adminのときは従来通り currentGroupId一致 + group_id==null のみに絞られる", () => {
    const before = useAppStore.getState();
    useAppStore.setState({
      currentGroupId: "grp-a",
      currentUserIsSuperAdmin: true,
      tasks: [
        { ...before.tasks[0], id: "t-a", group_id: "grp-a" } as typeof before.tasks[0],
        { ...before.tasks[0], id: "t-b", group_id: "grp-b" } as typeof before.tasks[0],
        { ...before.tasks[0], id: "t-null", group_id: null } as typeof before.tasks[0],
      ],
    });
    const scoped = selectScopedTasks(useAppStore.getState());
    const ids = scoped.map(t => t.id);
    expect(ids).toContain("t-a");
    expect(ids).toContain("t-null");
    expect(ids).not.toContain("t-b");
  });
});
