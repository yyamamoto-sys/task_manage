// v3.156：チェックボックスのShift範囲選択・PJ移動の対象決定・複数並べ替えの採番・グループの並べ替え・日数入力の解釈
import { describe, it, expect } from "vitest";
import type { Task, ProjectSection } from "../../localData/types";
import { applyCheckboxClick } from "../../selectionRange";
import { toggleTaskWithChildren } from "../selectionWithChildren";
import { planProjectMove, projectMoveConfirmMessage } from "../projectMove";
import { computeMultiReorder } from "../multiReorder";
import { parseShiftDays } from "../shiftDays";
import { computeSectionDropOrder, UNSECTIONED_KEY } from "../../section/sections";

function task(over: Partial<Task>): Task {
  return {
    id: "t", name: "タスク", project_id: "pj-a", todo_ids: [],
    assignee_member_id: "m", assignee_member_ids: ["m"], status: "todo", priority: null,
    start_date: null, due_date: null, estimated_hours: null, comment: "", is_deleted: false,
    display_order: 0, ...over,
  };
}
const sec = (id: string, order: number): ProjectSection => ({
  id, project_id: "pj-a", name: id, sort_order: order, is_deleted: false,
} as ProjectSection);

describe("applyCheckboxClick", () => {
  const ordered = ["a", "b", "c", "d", "e"];
  const toggle = (p: Set<string>, id: string) => toggleTaskWithChildren(p, id, []);

  it("通常クリックはトグルしてアンカーを更新する", () => {
    const r = applyCheckboxClick(new Set(), ordered, null, "b", false, toggle);
    expect([...r.next]).toEqual(["b"]);
    expect(r.anchor).toBe("b");
    const r2 = applyCheckboxClick(r.next, ordered, r.anchor, "b", false, toggle);
    expect(r2.next.size).toBe(0);
  });

  it("Shiftクリックはアンカー〜クリック先を表示順で追加し、アンカーは変えない", () => {
    const r = applyCheckboxClick(new Set(["b"]), ordered, "b", "d", true, toggle);
    expect([...r.next].sort()).toEqual(["b", "c", "d"]);
    expect(r.anchor).toBe("b");
  });

  it("アンカーが無いShiftクリックは、その1件を選んでアンカーにする", () => {
    const r = applyCheckboxClick(new Set(), ordered, null, "c", true, toggle);
    expect([...r.next]).toEqual(["c"]);
    expect(r.anchor).toBe("c");
  });

  it("逆向きの範囲・既存の選択の保持", () => {
    const r = applyCheckboxClick(new Set(["a"]), ordered, "d", "b", true, toggle);
    expect([...r.next].sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("通常クリックは親子連動（親を選ぶと子も入る）", () => {
    const tasks = [task({ id: "p" }), task({ id: "c", parent_task_id: "p" })];
    const r = applyCheckboxClick(new Set(), ["p", "c"], null, "p", false, (p, id) => toggleTaskWithChildren(p, id, tasks));
    expect([...r.next].sort()).toEqual(["c", "p"]);
  });
});

describe("planProjectMove", () => {
  it("親を選ぶと子（未選択）も連れて移り、section_id は null", () => {
    const all = [
      task({ id: "p", section_id: "s1", display_order: 1 }),
      task({ id: "c", parent_task_id: "p", section_id: "s1" }),
      task({ id: "x", project_id: "pj-b", display_order: 5 }),
    ];
    const plan = planProjectMove(all, new Set(["p"]), "pj-b");
    expect(plan.total).toBe(2);
    expect(plan.childCount).toBe(1);
    const p = plan.moves.find(m => m.id === "p")!;
    expect(p.patch.project_id).toBe("pj-b");
    expect(p.patch.section_id).toBeNull();
    expect(p.patch.display_order).toBe(6);
    expect(p.prev.section_id).toBe("s1");
    expect(plan.moves.find(m => m.id === "c")!.patch.project_id).toBe("pj-b");
    expect(plan.moves.find(m => m.id === "c")!.patch.parent_task_id).toBeUndefined();
  });

  it("親子とも選んでも二重に数えない", () => {
    const all = [task({ id: "p" }), task({ id: "c", parent_task_id: "p" })];
    const plan = planProjectMove(all, new Set(["p", "c"]), "pj-b");
    expect(plan.total).toBe(2);
    expect(plan.childCount).toBe(1);
  });

  it("子だけ選んだ場合は親から外れて最上位になる（親は動かない）", () => {
    const all = [task({ id: "p" }), task({ id: "c", parent_task_id: "p" })];
    const plan = planProjectMove(all, new Set(["c"]), "pj-b");
    expect(plan.total).toBe(1);
    expect(plan.detachedCount).toBe(1);
    expect(plan.moves[0].patch.parent_task_id).toBeNull();
    expect(plan.moves[0].prev.parent_task_id).toBe("p");
    expect(projectMoveConfirmMessage(plan, "B")).toContain("親から外れて");
  });

  it("すでに移動先のタスクは対象外・表示順で末尾に並ぶ", () => {
    const all = [
      task({ id: "a", display_order: 0 }), task({ id: "b", display_order: 1 }),
      task({ id: "z", project_id: "pj-b", display_order: 9 }),
    ];
    const plan = planProjectMove(all, new Set(["z", "b", "a"]), "pj-b", ["b", "a", "z"]);
    expect(plan.total).toBe(2);
    expect(plan.moves.map(m => m.id)).toEqual(["b", "a"]);
    expect(plan.moves.map(m => m.patch.display_order)).toEqual([10, 11]);
  });

  it("確認文に件数と子の件数が入る", () => {
    const all = [task({ id: "p" }), task({ id: "c", parent_task_id: "p" })];
    const plan = planProjectMove(all, new Set(["p"]), "pj-b");
    expect(projectMoveConfirmMessage(plan, "B")).toContain("2件（子タスク1件を含む）を「B」へ移します");
  });

  it("削除済みの子は連れない", () => {
    const all = [task({ id: "p" }), task({ id: "c", parent_task_id: "p", is_deleted: true })];
    expect(planProjectMove(all, new Set(["p"]), "pj-b").total).toBe(1);
  });
});

describe("computeMultiReorder", () => {
  const base = [
    task({ id: "a", display_order: 0 }), task({ id: "b", display_order: 1 }),
    task({ id: "c", display_order: 2 }), task({ id: "d", display_order: 3 }),
  ];
  const order = (r: ReturnType<typeof computeMultiReorder>, tasks: Task[]) => {
    if (!r.ok) throw new Error("not ok");
    const m = new Map(tasks.map(t => [t.id, t.display_order ?? 0]));
    r.patches.forEach(p => { if (p.patch.display_order !== undefined) m.set(p.id, p.patch.display_order); });
    return [...m.entries()].sort((x, y) => x[1] - y[1]).map(e => e[0]);
  };

  it("選択中を表示順のままドロップ先の前へまとめて入れる", () => {
    const r = computeMultiReorder(base, base, ["a", "c"], { kind: "before", targetId: "d" });
    expect(order(r, base)).toEqual(["b", "a", "c", "d"]);
  });

  it("後ろへ入れる", () => {
    const r = computeMultiReorder(base, base, ["b", "d"], { kind: "after", targetId: "a" });
    expect(order(r, base)).toEqual(["a", "b", "d", "c"]);
  });

  it("ドロップ先が選択中なら何もしない（理由なし）", () => {
    const r = computeMultiReorder(base, base, ["a", "b"], { kind: "before", targetId: "b" });
    expect(r).toEqual({ ok: false, reason: null });
  });

  it("Undo用に旧順を持つ", () => {
    const r = computeMultiReorder(base, base, ["a"], { kind: "after", targetId: "c" });
    if (!r.ok) throw new Error("x");
    expect(r.patches.find(p => p.id === "a")!.prev.display_order).toBe(0);
  });

  it("別PJの行へ落とすと全部そのPJ・親なしへ入る。親の子もPJを揃える", () => {
    const all = [
      task({ id: "p", display_order: 0 }),
      task({ id: "c1", parent_task_id: "p" }),
      task({ id: "q", display_order: 1 }),
      task({ id: "t1", project_id: "pj-b", display_order: 0 }),
    ];
    const r = computeMultiReorder(all, all, ["p", "c1", "q"], { kind: "after", targetId: "t1" });
    if (!r.ok) throw new Error("x");
    expect(r.movedCount).toBe(2);
    expect(r.patches.find(p => p.id === "p")!.patch.project_id).toBe("pj-b");
    expect(r.patches.find(p => p.id === "q")!.patch.project_id).toBe("pj-b");
    expect(r.patches.find(p => p.id === "c1")!.patch.project_id).toBe("pj-b");
  });

  it("子だけを選んで最上位へ移すのは拒否する", () => {
    const all = [task({ id: "p", display_order: 0 }), task({ id: "c", parent_task_id: "p" }), task({ id: "q", display_order: 1 })];
    const r = computeMultiReorder(all, all, ["c"], { kind: "after", targetId: "q" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("子タスクだけ");
  });

  it("子だけ別の親の子へ移すのは拒否する", () => {
    const all = [
      task({ id: "p1", display_order: 0 }), task({ id: "c1", parent_task_id: "p1" }),
      task({ id: "p2", display_order: 1 }), task({ id: "c2", parent_task_id: "p2" }),
    ];
    const r = computeMultiReorder(all, all, ["c1"], { kind: "after", targetId: "c2" });
    expect(r.ok).toBe(false);
  });

  it("同じ親の子同士の並べ替えは通る", () => {
    const all = [
      task({ id: "p" }), task({ id: "c1", parent_task_id: "p", display_order: 0 }),
      task({ id: "c2", parent_task_id: "p", display_order: 1 }), task({ id: "c3", parent_task_id: "p", display_order: 2 }),
    ];
    const r = computeMultiReorder(all, all, ["c1", "c2"], { kind: "after", targetId: "c3" });
    if (!r.ok) throw new Error("x");
    expect(r.patches.find(p => p.id === "c3")!.patch.display_order).toBe(0);
  });

  it("子を持つタスクを子として入れるのは拒否する", () => {
    const all = [
      task({ id: "p1", display_order: 0 }), task({ id: "c1", parent_task_id: "p1" }),
      task({ id: "p2", display_order: 1 }), task({ id: "c2", parent_task_id: "p2" }),
    ];
    const r = computeMultiReorder(all, all, ["p1"], { kind: "after", targetId: "c2" });
    expect(r.ok).toBe(false);
  });

  it("親へのnest：子を持たない最上位は子になる", () => {
    const all = [task({ id: "p", display_order: 0 }), task({ id: "x", display_order: 1 }), task({ id: "y", display_order: 2 })];
    const r = computeMultiReorder(all, all, ["x", "y"], { kind: "nest", parentId: "p" });
    if (!r.ok) throw new Error("x");
    expect(r.patches.find(p => p.id === "x")!.patch.parent_task_id).toBe("p");
    expect(r.patches.find(p => p.id === "y")!.patch.parent_task_id).toBe("p");
  });
});

describe("computeSectionDropOrder", () => {
  const list = [sec("s1", 0), sec("s2", 1), sec("s3", 2)];
  it("下へ落とすと相手の位置へ入る", () => {
    expect(computeSectionDropOrder(list, "s1", "s3")).toEqual(["s2", "s3", "s1"]);
  });
  it("上へ落とすと相手の前へ入る", () => {
    expect(computeSectionDropOrder(list, "s3", "s1")).toEqual(["s3", "s1", "s2"]);
  });
  it("未分類の見出しへ落とすと先頭へ", () => {
    expect(computeSectionDropOrder(list, "s2", UNSECTIONED_KEY)).toEqual(["s2", "s1", "s3"]);
  });
  it("同じ位置・不明なidは何もしない", () => {
    expect(computeSectionDropOrder(list, "s2", "s2")).toBeNull();
    expect(computeSectionDropOrder(list, "zz", "s1")).toBeNull();
    expect(computeSectionDropOrder(list, "s1", UNSECTIONED_KEY)).toBeNull();
  });
});

describe("parseShiftDays", () => {
  it("整数だけを受け付ける", () => {
    expect(parseShiftDays("7")).toBe(7);
    expect(parseShiftDays("+3")).toBe(3);
    expect(parseShiftDays("-2")).toBe(-2);
    expect(parseShiftDays("－５")).toBe(-5);
  });
  it("0・小数・空・非数・極端な値は null", () => {
    for (const s of ["", "0", "1.5", "abc", "1e3", "99999"]) expect(parseShiftDays(s)).toBeNull();
  });
});
