import { describe, it, expect } from "vitest";
import type { Task } from "../../localData/types";
import { extractLeadingNumber, sortTasksByNameNumber, computeNameOrderAssignments } from "../nameOrder";

function makeTask(over: Partial<Task>): Task {
  return {
    id: "t-1", name: "タスク", project_id: "pj-1", todo_ids: [],
    assignee_member_id: "m-1", assignee_member_ids: ["m-1"], status: "todo", priority: null,
    start_date: null, due_date: null, estimated_hours: null, comment: "", is_deleted: false,
    ...over,
  };
}

describe("extractLeadingNumber", () => {
  it("「1. あ」→1", () => {
    expect(extractLeadingNumber("1. あ")).toBe(1);
  });

  it("「10. い」→10（複数桁）", () => {
    expect(extractLeadingNumber("10. い")).toBe(10);
  });

  it("「第2回 う」→2（数字の前に文字がある場合）", () => {
    expect(extractLeadingNumber("第2回 う")).toBe(2);
  });

  it("「１．全角」→1（全角数字を半角として読む）", () => {
    expect(extractLeadingNumber("１．全角")).toBe(1);
  });

  it("「番号なし」→null（数値が無い）", () => {
    expect(extractLeadingNumber("番号なし")).toBeNull();
  });

  it("「」→null（空文字列）", () => {
    expect(extractLeadingNumber("")).toBeNull();
  });

  it("「1、」「1 」のような区切り文字の揺れにも対応する", () => {
    expect(extractLeadingNumber("1、あ")).toBe(1);
    expect(extractLeadingNumber("1 あ")).toBe(1);
  });
});

describe("sortTasksByNameNumber", () => {
  it("1→2→10 の自然順になる（単純な文字列ソートなら 1→10→2 になってしまう）", () => {
    const tasks = [
      makeTask({ id: "a", name: "10. じゅう" }),
      makeTask({ id: "b", name: "2. に" }),
      makeTask({ id: "c", name: "1. いち" }),
    ];
    expect(sortTasksByNameNumber(tasks).map(t => t.id)).toEqual(["c", "b", "a"]);
  });

  it("番号なしのタスクは末尾にまとまる", () => {
    const tasks = [
      makeTask({ id: "a", name: "番号なしその一" }),
      makeTask({ id: "b", name: "2. に" }),
      makeTask({ id: "c", name: "1. いち" }),
      makeTask({ id: "d", name: "番号なしその二" }),
    ];
    expect(sortTasksByNameNumber(tasks).map(t => t.id)).toEqual(["c", "b", "a", "d"]);
  });

  it("番号なし同士は元の相対順序を維持する（安定ソート）", () => {
    const tasks = [
      makeTask({ id: "x", name: "こちらが先" }),
      makeTask({ id: "y", name: "こちらが後" }),
    ];
    expect(sortTasksByNameNumber(tasks).map(t => t.id)).toEqual(["x", "y"]);
  });

  it("同じ数値のタスク同士も元の相対順序を維持する（安定ソート）", () => {
    const tasks = [
      makeTask({ id: "p", name: "1. さきに書いた方" }),
      makeTask({ id: "q", name: "1. あとに書いた方" }),
    ];
    expect(sortTasksByNameNumber(tasks).map(t => t.id)).toEqual(["p", "q"]);
  });

  it("元の配列を変更しない", () => {
    const tasks = [makeTask({ id: "a", name: "2." }), makeTask({ id: "b", name: "1." })];
    const before = [...tasks];
    sortTasksByNameNumber(tasks);
    expect(tasks).toEqual(before);
  });
});

describe("computeNameOrderAssignments", () => {
  it("同じ親（トップレベル・同じPJ）だけを対象に名前の番号順で並べ替える", () => {
    const all = [
      makeTask({ id: "p10", name: "10. じゅう", project_id: "pj-1", display_order: 0 }),
      makeTask({ id: "p2", name: "2. に", project_id: "pj-1", display_order: 1 }),
      makeTask({ id: "p1", name: "1. いち", project_id: "pj-1", display_order: 2 }),
    ];
    const result = computeNameOrderAssignments(all, all);
    expect(result.get("p1")).toBe(0);
    expect(result.get("p2")).toBe(1);
    expect(result.get("p10")).toBe(2);
  });

  it("親タスク同士を並べ替えても、子は別グループ（親ごと）のため親の並び替えに巻き込まれない", () => {
    const parent1 = makeTask({ id: "parent2", name: "2. 親", project_id: "pj-1", display_order: 0 });
    const parent2 = makeTask({ id: "parent1", name: "1. 親", project_id: "pj-1", display_order: 1 });
    const childOfParent2 = makeTask({ id: "child-b", name: "2. 子", project_id: "pj-1", parent_task_id: "parent1", display_order: 0 });
    const childOfParent2b = makeTask({ id: "child-a", name: "1. 子", project_id: "pj-1", parent_task_id: "parent1", display_order: 1 });
    const all = [parent1, parent2, childOfParent2, childOfParent2b];
    const result = computeNameOrderAssignments(all, all);
    // 親同士：1.親→0, 2.親→1
    expect(result.get("parent1")).toBe(0);
    expect(result.get("parent2")).toBe(1);
    // 子同士（同じ親=parent1）：1.子→0, 2.子→1
    expect(result.get("child-a")).toBe(0);
    expect(result.get("child-b")).toBe(1);
  });

  it("対象タスクが1件も無い兄弟グループには一切触れない（結果に含まれない）", () => {
    const untouchedGroup = [
      makeTask({ id: "u1", name: "2. に", project_id: "pj-other", display_order: 0 }),
      makeTask({ id: "u2", name: "1. いち", project_id: "pj-other", display_order: 1 }),
    ];
    const target = [makeTask({ id: "t1", name: "1.", project_id: "pj-1" })];
    const all = [...target, ...untouchedGroup];
    const result = computeNameOrderAssignments(target, all);
    expect(result.has("u1")).toBe(false);
    expect(result.has("u2")).toBe(false);
    expect(result.get("t1")).toBe(0);
  });

  it("フィルタ等で対象外になった「隠れた」兄弟は、既存のdisplay_order順のまま対象タスクの後ろに温存される", () => {
    const visible1 = makeTask({ id: "v1", name: "2. に", project_id: "pj-1", display_order: 5 });
    const visible2 = makeTask({ id: "v2", name: "1. いち", project_id: "pj-1", display_order: 6 });
    const hiddenA = makeTask({ id: "h1", name: "3. さん（フィルタで非表示）", project_id: "pj-1", display_order: 0 });
    const hiddenB = makeTask({ id: "h2", name: "4. よん（フィルタで非表示）", project_id: "pj-1", display_order: 1 });
    const all = [visible1, visible2, hiddenA, hiddenB];
    const target = [visible1, visible2]; // hiddenA/hiddenBはフィルタで現在表示されていない想定
    const result = computeNameOrderAssignments(target, all);
    // 対象（visible）は名前順で先頭に：v2(1.)→0, v1(2.)→1
    expect(result.get("v2")).toBe(0);
    expect(result.get("v1")).toBe(1);
    // 隠れた兄弟は既存display_order順のまま、対象の後ろに続く
    expect(result.get("h1")).toBe(2);
    expect(result.get("h2")).toBe(3);
  });

  it("論理削除済みタスクは対象外", () => {
    const target = [
      makeTask({ id: "a", name: "2.", project_id: "pj-1" }),
      makeTask({ id: "b", name: "1.", project_id: "pj-1" }),
    ];
    const deleted = makeTask({ id: "z", name: "0. 削除済み", project_id: "pj-1", is_deleted: true });
    const all = [...target, deleted];
    const result = computeNameOrderAssignments(target, all);
    expect(result.has("z")).toBe(false);
    expect(result.get("b")).toBe(0);
    expect(result.get("a")).toBe(1);
  });
});
