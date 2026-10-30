// 親子の階層が任意の深さ（3〜5段）になったときの、純粋関数の挙動（v3.195）。
import { describe, it, expect } from "vitest";
import type { Task } from "../localData/types";
import {
  orderTasksAsTree, buildParentDerivedMap, buildEffectiveDatesMap, parentProgress, rollupStatus,
  buildProgressFractionMap, ancestorsOf, descendantsOf, buildChildrenMap, buildTaskById, taskDepthOf,
  wouldCreateParentCycle, hasParentCycle, indentLevelOf, parentArrowPrefix, sortTasksByOrder,
  MAX_INDENT_LEVEL, MAX_TASK_DEPTH,
} from "../taskHierarchy";
import { planProjectMove } from "../task/projectMove";
import { addTaskWithChildren, removeTaskWithChildren } from "../task/selectionWithChildren";
import { followParentSection } from "../section/sections";
import { saveTasksInDepthOrder, splitIntoDepthWaves } from "../task/saveInDepthOrder";
import { buildInheritedTasks } from "../project/taskInheritance";
import { buildDuplicatedTasks } from "../project/duplicateSelectedTasks";
import { buildPjViewGanttRows, computeVisibleOrderedTaskIds } from "../../components/gantt/ganttUtils";
import type { Project } from "../localData/types";

function mk(id: string, extra: Partial<Task> = {}): Task {
  return {
    id, name: id, project_id: "p1", todo_ids: [], assignee_member_id: "", assignee_member_ids: [],
    status: "todo", priority: null, start_date: null, due_date: null, estimated_hours: null, comment: "",
    is_deleted: false, ...extra,
  } as Task;
}

// A ─ B ─ C ─ D（4段）／A ─ E／F（単独）
function deepTree(): Task[] {
  return [
    mk("A", { display_order: 0 }),
    mk("B", { parent_task_id: "A", display_order: 0 }),
    mk("C", { parent_task_id: "B", display_order: 0 }),
    mk("D", { parent_task_id: "C", display_order: 0 }),
    mk("E", { parent_task_id: "A", display_order: 1 }),
    mk("F", { display_order: 1 }),
  ];
}
const byOrder = (ts: Task[]) => [...ts].sort(sortTasksByOrder);

describe("木順・深さ", () => {
  it("深さ優先で並び、深さと直下の子の件数が付く", () => {
    const rows = orderTasksAsTree(deepTree(), byOrder);
    expect(rows.map(r => `${r.task.id}:${r.depth}:${r.childCount}`)).toEqual([
      "A:0:2", "B:1:1", "C:2:1", "D:3:0", "E:1:0", "F:0:0",
    ]);
  });

  it("5段でも崩れない", () => {
    const t = [mk("1"), mk("2", { parent_task_id: "1" }), mk("3", { parent_task_id: "2" }), mk("4", { parent_task_id: "3" }), mk("5", { parent_task_id: "4" })];
    expect(orderTasksAsTree(t, byOrder).map(r => r.depth)).toEqual([0, 1, 2, 3, 4]);
  });

  it("親がこの集合に居ないタスクは最上位扱い（子孫は付いてくる）", () => {
    const rows = orderTasksAsTree(deepTree().filter(t => t.id !== "A"), byOrder);
    expect(rows.map(r => `${r.task.id}:${r.depth}`)).toEqual(["B:0", "C:1", "D:2", "E:0", "F:0"]);
  });

  it("兄弟の並びは呼び出し側の規則（逆順）に従う", () => {
    const rows = orderTasksAsTree(deepTree(), ts => [...byOrder(ts)].reverse());
    expect(rows.map(r => r.task.id)).toEqual(["F", "A", "E", "B", "C", "D"]);
  });

  it("循環データでも無限ループせず、全タスクを1回ずつ返す", () => {
    const cyc = [mk("X", { parent_task_id: "Y" }), mk("Y", { parent_task_id: "X" }), mk("Z", { parent_task_id: "Z" })];
    const rows = orderTasksAsTree(cyc, byOrder);
    expect(rows.map(r => r.task.id).sort()).toEqual(["X", "Y", "Z"]);
  });

  it("祖先列・子孫列・深さ", () => {
    const tasks = deepTree();
    const byId = buildTaskById(tasks);
    expect(ancestorsOf(byId.get("D")!, byId).map(t => t.id)).toEqual(["C", "B", "A"]);
    expect(taskDepthOf(byId.get("D")!, byId)).toBe(3);
    expect(descendantsOf("A", buildChildrenMap(tasks)).map(t => t.id).sort()).toEqual(["B", "C", "D", "E"]);
  });

  it("祖先列・子孫列は循環でも止まる", () => {
    const cyc = [mk("X", { parent_task_id: "Y" }), mk("Y", { parent_task_id: "X" })];
    const byId = buildTaskById(cyc);
    expect(ancestorsOf(byId.get("X")!, byId).map(t => t.id)).toEqual(["Y"]);
    expect(descendantsOf("X", buildChildrenMap(cyc)).map(t => t.id)).toEqual(["Y"]);
    expect(hasParentCycle(byId.get("X")!, byId)).toBe(true);
  });

  it("上限（32段）で打ち切る", () => {
    const chain: Task[] = [mk("n0")];
    for (let i = 1; i < 50; i++) chain.push(mk(`n${i}`, { parent_task_id: `n${i - 1}` }));
    const byId = buildTaskById(chain);
    expect(ancestorsOf(byId.get("n49")!, byId)).toHaveLength(MAX_TASK_DEPTH);
  });

  it("循環判定：自分・自分の子孫を親にすると循環", () => {
    const tasks = deepTree();
    expect(wouldCreateParentCycle(tasks, "A", "A")).toBe(true);
    expect(wouldCreateParentCycle(tasks, "A", "D")).toBe(true);
    expect(wouldCreateParentCycle(tasks, "B", "D")).toBe(true);
    expect(wouldCreateParentCycle(tasks, "D", "E")).toBe(false);
    expect(wouldCreateParentCycle(tasks, "D", null)).toBe(false);
  });

  it("インデントは MAX_INDENT_LEVEL で頭打ち", () => {
    expect(indentLevelOf(3)).toBe(3);
    expect(indentLevelOf(20)).toBe(MAX_INDENT_LEVEL);
    expect(indentLevelOf(-1)).toBe(0);
  });

  it("↳ の接頭辞は深さぶん", () => {
    const byId = buildTaskById(deepTree());
    expect(parentArrowPrefix(byId.get("A")!, byId)).toBe("");
    expect(parentArrowPrefix(byId.get("B")!, byId)).toBe("↳ ");
    expect(parentArrowPrefix(byId.get("D")!, byId)).toBe("↳↳↳ ");
  });
});

describe("集計の再帰化（末端数え）", () => {
  it("進捗は末端の完了数／末端の総数（中間の親は数えない）", () => {
    const tasks = [
      mk("A"),
      mk("B", { parent_task_id: "A" }),
      mk("b1", { parent_task_id: "B", status: "done" }),
      mk("b2", { parent_task_id: "B", status: "todo" }),
      mk("b3", { parent_task_id: "B", status: "done" }),
      mk("C", { parent_task_id: "A", status: "done" }),
    ];
    expect(parentProgress(tasks, "A")).toEqual({ done: 3, total: 4, pct: 75 });
    expect(parentProgress(tasks, "B")).toEqual({ done: 2, total: 3, pct: 67 });
    expect(parentProgress(tasks, "C")).toEqual({ done: 0, total: 0, pct: 0 });
    expect(buildParentDerivedMap(tasks).get("A")).toMatchObject({ done: 3, total: 4 });
    expect(buildProgressFractionMap(tasks).get("A")).toBeCloseTo(0.75, 2);
  });

  it("2段の木は従来と同じ（直下の子の数と一致）", () => {
    const tasks = [mk("P"), mk("c1", { parent_task_id: "P", status: "done" }), mk("c2", { parent_task_id: "P", status: "cancelled" }), mk("c3", { parent_task_id: "P" })];
    expect(parentProgress(tasks, "P")).toEqual({ done: 1, total: 3, pct: 33 });
  });

  it("状態は子の実効状態から再帰して派生する", () => {
    const tasks = [
      mk("A"), mk("B", { parent_task_id: "A", status: "todo" }),
      mk("b1", { parent_task_id: "B", status: "done" }), mk("b2", { parent_task_id: "B", status: "cancelled" }),
    ];
    // B は自身が todo でも、子が全員終了なので実効 done。A は子が B だけ＝done
    expect(rollupStatus(tasks[1], tasks)).toBe("done");
    expect(rollupStatus(tasks[0], tasks)).toBe("done");
    const tasks2 = [...tasks.slice(0, 3), mk("b2", { parent_task_id: "B", status: "in_progress" })];
    expect(buildParentDerivedMap(tasks2).get("A")!.status).toBe("in_progress");
    const allTodo = [mk("A"), mk("B", { parent_task_id: "A" }), mk("b1", { parent_task_id: "B" })];
    expect(buildParentDerivedMap(allTodo).get("A")!.status).toBe("todo");
  });

  it("期間は末端まで巻き上げる（開始の最小・終了の最大）", () => {
    const tasks = [
      mk("A", { start_date: "2020-01-01", due_date: "2020-01-02" }),
      mk("B", { parent_task_id: "A", start_date: "2020-01-01", due_date: "2020-01-02" }),
      mk("b1", { parent_task_id: "B", start_date: "2026-03-10", due_date: "2026-03-20" }),
      mk("b2", { parent_task_id: "B", start_date: "2026-03-05", due_date: "2026-03-12" }),
      mk("C", { parent_task_id: "A", start_date: "2026-04-01", due_date: "2026-04-30" }),
    ];
    const m = buildEffectiveDatesMap(tasks);
    expect(m.get("B")).toEqual({ start_date: "2026-03-05", due_date: "2026-03-20" });
    expect(m.get("A")).toEqual({ start_date: "2026-03-05", due_date: "2026-04-30" });
    expect(m.has("b1")).toBe(false);
  });

  it("循環データでも集計が止まる", () => {
    const cyc = [mk("X", { parent_task_id: "Y" }), mk("Y", { parent_task_id: "X" })];
    expect(() => buildParentDerivedMap(cyc)).not.toThrow();
    expect(() => buildEffectiveDatesMap(cyc)).not.toThrow();
  });
});

describe("ガント行：折りたたみ・深さ", () => {
  const pj = { id: "p1", name: "PJ" } as Project;
  function build(collapsed: Record<string, boolean>) {
    return buildPjViewGanttRows({
      visibleProjects: [pj],
      pjOrderedTasksMap: new Map([["p1", orderTasksAsTree(deepTree(), byOrder)]]),
      todoGroups: [], todoGroupSortedMap: new Map(), collapsed, isPreview: false,
    });
  }
  const ids = (rows: ReturnType<typeof build>) => rows.filter(r => r.kind === "task").map(r => r.kind === "task" ? `${r.task.id}:${r.depth}` : "");

  it("折りたたみなしは全行・深さ付き", () => {
    expect(ids(build({}))).toEqual(["A:0", "B:1", "C:2", "D:3", "E:1", "F:0"]);
  });
  it("祖先のどれかが閉じていたら隠す（中間の親でも最上位でも）", () => {
    expect(ids(build({ B: true }))).toEqual(["A:0", "B:1", "E:1", "F:0"]);
    expect(ids(build({ C: true }))).toEqual(["A:0", "B:1", "C:2", "E:1", "F:0"]);
    expect(ids(build({ A: true }))).toEqual(["A:0", "F:0"]);
  });
  it("表示順ID（全選択・範囲選択）も同じ規則", () => {
    const rows = orderTasksAsTree(deepTree(), byOrder).map(r => ({ taskId: r.task.id, depth: r.depth, parentTaskId: r.task.parent_task_id ?? null }));
    const got = computeVisibleOrderedTaskIds({
      viewMode: "pj", collapsed: { B: true }, personGroups: [], todoGroups: [],
      pjGroups: [{ pjId: "p1", rows }],
    });
    expect(got).toEqual(["A", "B", "E", "F"]);
  });
  it("折りたたみ判定は循環でも止まる", () => {
    const rows = [{ taskId: "X", depth: 1, parentTaskId: "Y" }, { taskId: "Y", depth: 1, parentTaskId: "X" }];
    expect(() => computeVisibleOrderedTaskIds({
      viewMode: "pj", collapsed: {}, personGroups: [], todoGroups: [], pjGroups: [{ pjId: "p1", rows }],
    })).not.toThrow();
  });
});

describe("親子選択・PJ移動・グループ揃え（子孫全体）", () => {
  it("親を選ぶと子孫すべてが選択に入り、外すとすべて外れる", () => {
    const tasks = deepTree();
    const sel = addTaskWithChildren(new Set(), "A", tasks);
    expect([...sel].sort()).toEqual(["A", "B", "C", "D", "E"]);
    expect([...removeTaskWithChildren(sel, "A", tasks)]).toEqual([]);
    expect([...addTaskWithChildren(new Set(), "B", tasks)].sort()).toEqual(["B", "C", "D"]);
  });

  it("PJ移動：最上位を選ぶと全子孫が連れて動く", () => {
    const plan = planProjectMove(deepTree(), new Set(["A"]), "p2");
    expect(plan.moves.map(m => m.id).sort()).toEqual(["A", "B", "C", "D", "E"]);
    expect(plan.moves.find(m => m.id === "D")!.kind).toBe("carriedChild");
    expect(plan.moves.find(m => m.id === "D")!.patch.parent_task_id).toBeUndefined();
  });

  it("PJ移動：中間の子だけ選ぶと親から外れて最上位になり、その子孫は連れて動く", () => {
    const plan = planProjectMove(deepTree(), new Set(["B"]), "p2");
    expect(plan.moves.map(m => `${m.id}:${m.kind}`).sort()).toEqual(["B:detached", "C:carriedChild", "D:carriedChild"]);
    expect(plan.moves.find(m => m.id === "B")!.patch.parent_task_id).toBeNull();
    expect(plan.detachedCount).toBe(1);
  });

  it("PJ移動：中間と孫を両方選ぶと孫は selectedChild として連れて動く", () => {
    const plan = planProjectMove(deepTree(), new Set(["B", "D"]), "p2");
    expect(plan.moves.find(m => m.id === "D")!.kind).toBe("selectedChild");
    expect(plan.moves).toHaveLength(3);
  });

  it("グループ揃え：親のグループが変わると子孫全体が揃う", () => {
    const tasks = deepTree().map(t => ({ ...t, section_id: null })) as Task[];
    const next = followParentSection(tasks, "A", "s1");
    expect(next.filter(t => t.section_id === "s1").map(t => t.id).sort()).toEqual(["B", "C", "D", "E"]);
  });
});

describe("複製・引き継ぎ・保存順", () => {
  it("引き継ぎ：孫以下の親IDも新IDに張り替わる", () => {
    let n = 0;
    const { tasks, idMap } = buildInheritedTasks({
      originTasks: deepTree(), checkedTaskIds: new Set(["A", "B", "C", "D"]), newProjectId: "p2",
      dateOffsetDays: 0, createdBy: "u", now: "2026-01-01T00:00:00Z", generateId: () => `new${++n}`,
    });
    const d = tasks.find(t => t.id === idMap.get("D"))!;
    expect(d.parent_task_id).toBe(idMap.get("C"));
    expect(tasks.find(t => t.id === idMap.get("A"))!.parent_task_id).toBeNull();
  });

  it("複製：孫以下も親IDが張り替わる", () => {
    let n = 0;
    const { tasks, idMap } = buildDuplicatedTasks({
      selectedTasks: deepTree().filter(t => ["A", "B", "C"].includes(t.id)),
      dateOffsetDays: 0, nameFind: "", nameReplace: "", createdBy: "u", now: "2026-01-01T00:00:00Z", generateId: () => `dup${++n}`,
    });
    expect(tasks.find(t => t.id === idMap.get("C"))!.parent_task_id).toBe(idMap.get("B"));
  });

  it("保存は浅い順の波に分かれる", () => {
    const waves = splitIntoDepthWaves(deepTree());
    expect(waves.map(w => w.map(t => t.id).sort())).toEqual([["A", "F"], ["B", "E"], ["C"], ["D"]]);
  });

  it("保存は親が先（入力が逆順でも）。順序を記録して確認する", async () => {
    const order: string[] = [];
    const ok = await saveTasksInDepthOrder([...deepTree()].reverse(), async t => { order.push(t.id); });
    expect(order.indexOf("A")).toBeLessThan(order.indexOf("B"));
    expect(order.indexOf("B")).toBeLessThan(order.indexOf("C"));
    expect(order.indexOf("C")).toBeLessThan(order.indexOf("D"));
    expect(ok.size).toBe(6);
  });

  it("親の保存が失敗した子は親なしに落として保存する（孫も連鎖して落とす）", async () => {
    const saved = new Map<string, string | null | undefined>();
    const ok = await saveTasksInDepthOrder(deepTree(), async t => {
      if (t.id === "B") throw new Error("fail");
      saved.set(t.id, t.parent_task_id);
    });
    expect(ok.has("B")).toBe(false);
    expect(saved.get("C")).toBeNull();
    expect(saved.get("D")).toBe("C");
    expect(saved.get("E")).toBe("A");
  });

  it("循環していても保存順の計算が止まる", () => {
    expect(() => splitIntoDepthWaves([mk("X", { parent_task_id: "Y" }), mk("Y", { parent_task_id: "X" })])).not.toThrow();
  });
});
