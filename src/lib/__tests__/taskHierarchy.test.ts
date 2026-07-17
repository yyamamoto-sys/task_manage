import { describe, it, expect } from "vitest";
import type { Task, TaskDependency } from "../localData/types";
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
  buildParentDerivedMap,
  orderSiblingsWithDependencies,
  applyDependencyOrderWithinSiblings,
  filterHideCompletedTasks,
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

// テスト用の最小 TaskDependency ファクトリ（先行→後続の1件）
function mkDep(predecessor_task_id: string, successor_task_id: string, is_deleted = false): TaskDependency {
  return {
    id: `${predecessor_task_id}->${successor_task_id}`,
    predecessor_task_id,
    successor_task_id,
    is_deleted,
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

describe("buildParentDerivedMap：rollupStatus/parentProgressの一括版", () => {
  it("複数の親を1回の呼び出しでまとめて算出し、rollupStatus/parentProgressと同じ結果になる", () => {
    const t: Task[] = [
      mk({ id: "p1", status: "todo" }),
      mk({ id: "p1c1", parent_task_id: "p1", status: "done" }),
      mk({ id: "p1c2", parent_task_id: "p1", status: "done" }),
      mk({ id: "p1c3", parent_task_id: "p1", status: "todo" }),
      mk({ id: "p2", status: "in_progress" }),
      mk({ id: "p2c1", parent_task_id: "p2", status: "todo" }),
      mk({ id: "p2c2", parent_task_id: "p2", status: "todo" }),
      mk({ id: "leaf" }), // 子なし＝親ではない
    ];
    const map = buildParentDerivedMap(t);

    expect(map.get("p1")).toEqual({
      status: rollupStatus(t[0], t),
      ...parentProgress(t, "p1"),
    });
    expect(map.get("p2")).toEqual({
      status: rollupStatus(t[4], t),
      ...parentProgress(t, "p2"),
    });
  });

  it("子を持たないタスクはMapに含まれない（子0件=葉）", () => {
    const t: Task[] = [mk({ id: "leaf", status: "todo" })];
    expect(buildParentDerivedMap(t).has("leaf")).toBe(false);
  });

  it("削除済みの子は集計に含めない", () => {
    const t: Task[] = [
      mk({ id: "p", status: "todo" }),
      mk({ id: "c1", parent_task_id: "p", status: "done" }),
      mk({ id: "cdel", parent_task_id: "p", status: "todo", is_deleted: true }),
    ];
    expect(buildParentDerivedMap(t).get("p")).toEqual({ status: "done", done: 1, total: 1, pct: 100 });
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

describe("orderSiblingsWithDependencies：依存関係順の安定トポロジカルソート", () => {
  it("1. 先行タスクは後続タスクより上に来る", () => {
    const children = [
      mk({ id: "b", parent_task_id: "p", display_order: 1 }),
      mk({ id: "a", parent_task_id: "p", display_order: 2 }), // display_order順ならbの後ろだが、aがbの先行
    ];
    const deps = [mkDep("a", "b")];
    expect(orderSiblingsWithDependencies(children, deps).map(t => t.id)).toEqual(["a", "b"]);
  });

  it("2. チェーン A→B→C が順序どおりに並ぶ", () => {
    const children = [
      mk({ id: "c", parent_task_id: "p", display_order: 1 }),
      mk({ id: "b", parent_task_id: "p", display_order: 2 }),
      mk({ id: "a", parent_task_id: "p", display_order: 3 }),
    ];
    const deps = [mkDep("a", "b"), mkDep("b", "c")];
    expect(orderSiblingsWithDependencies(children, deps).map(t => t.id)).toEqual(["a", "b", "c"]);
  });

  it("3. 依存の無いタスクは display_order の並びをそのまま保つ（安定性）", () => {
    const children = [
      mk({ id: "x", parent_task_id: "p", display_order: 1 }),
      mk({ id: "y", parent_task_id: "p", display_order: 2 }),
      mk({ id: "z", parent_task_id: "p", display_order: 3 }),
    ];
    expect(orderSiblingsWithDependencies(children, []).map(t => t.id)).toEqual(["x", "y", "z"]);
  });

  it("4. 依存ありと無しが混在しても、無しは元の相対位置を保ちつつ依存制約を満たす", () => {
    // 元順：A,B,C,D。依存は C→A（Cが先行）のみ。B/Dは無関係で相対順を保つべき
    const children = [
      mk({ id: "a", parent_task_id: "p", display_order: 1 }),
      mk({ id: "b", parent_task_id: "p", display_order: 2 }),
      mk({ id: "c", parent_task_id: "p", display_order: 3 }),
      mk({ id: "d", parent_task_id: "p", display_order: 4 }),
    ];
    const deps = [mkDep("c", "a")];
    const result = orderSiblingsWithDependencies(children, deps).map(t => t.id);
    // c は a より前に来る（制約）
    expect(result.indexOf("c")).toBeLessThan(result.indexOf("a"));
    // b と d は無関係同士の相対順（元は b→d）を保つ
    expect(result.indexOf("b")).toBeLessThan(result.indexOf("d"));
    expect(result).toHaveLength(4);
  });

  it("5. 親をまたぐ依存エッジは無視される（両端がchildrenに無ければ制約にならない）", () => {
    const children = [
      mk({ id: "x", parent_task_id: "p", display_order: 1 }),
      mk({ id: "y", parent_task_id: "p", display_order: 2 }),
    ];
    // "other" はこの兄弟集合に含まれない（別の親の子、という想定）
    const deps = [mkDep("y", "x"), mkDep("other", "x")];
    // y→x の制約だけが有効なので x は y より後ろに来る
    expect(orderSiblingsWithDependencies(children, deps).map(t => t.id)).toEqual(["y", "x"]);
  });

  it("6. 循環（防御的に注入）は例外を投げず display_order 順にフォールバックする", () => {
    const children = [
      mk({ id: "a", parent_task_id: "p", display_order: 1 }),
      mk({ id: "b", parent_task_id: "p", display_order: 2 }),
    ];
    const deps = [mkDep("a", "b"), mkDep("b", "a")]; // 通常B1では発生しないはずの循環
    expect(() => orderSiblingsWithDependencies(children, deps)).not.toThrow();
    expect(orderSiblingsWithDependencies(children, deps).map(t => t.id)).toEqual(["a", "b"]);
  });

  it("7. 複数の先行を持つ後続は、全ての先行より下に来る", () => {
    const children = [
      mk({ id: "c", parent_task_id: "p", display_order: 1 }), // 後続
      mk({ id: "a", parent_task_id: "p", display_order: 2 }), // 先行1
      mk({ id: "b", parent_task_id: "p", display_order: 3 }), // 先行2
    ];
    const deps = [mkDep("a", "c"), mkDep("b", "c")];
    const result = orderSiblingsWithDependencies(children, deps).map(t => t.id);
    expect(result.indexOf("a")).toBeLessThan(result.indexOf("c"));
    expect(result.indexOf("b")).toBeLessThan(result.indexOf("c"));
  });

  it("論理削除された依存（is_deleted）は制約に使わない", () => {
    const children = [
      mk({ id: "a", parent_task_id: "p", display_order: 1 }),
      mk({ id: "b", parent_task_id: "p", display_order: 2 }),
    ];
    const deps = [mkDep("b", "a", true)]; // 削除済みなので無視される
    expect(orderSiblingsWithDependencies(children, deps).map(t => t.id)).toEqual(["a", "b"]);
  });

  it("要素0〜1件はそのまま返す", () => {
    expect(orderSiblingsWithDependencies([], [])).toEqual([]);
    const one = [mk({ id: "solo", parent_task_id: "p" })];
    expect(orderSiblingsWithDependencies(one, [])).toEqual(one);
  });
});

describe("childrenOf：dependencies を渡すと依存関係順を適用する", () => {
  it("dependencies 未指定では従来どおり display_order 順のまま（後方互換）", () => {
    const tasks = [
      mk({ id: "b", parent_task_id: "p", display_order: 1 }),
      mk({ id: "a", parent_task_id: "p", display_order: 2 }),
    ];
    expect(childrenOf(tasks, "p").map(t => t.id)).toEqual(["b", "a"]);
  });

  it("dependencies を渡すと先行→後続の並びに変わる", () => {
    const tasks = [
      mk({ id: "b", parent_task_id: "p", display_order: 1 }),
      mk({ id: "a", parent_task_id: "p", display_order: 2 }),
    ];
    const deps = [mkDep("a", "b")];
    expect(childrenOf(tasks, "p", deps).map(t => t.id)).toEqual(["a", "b"]);
  });
});

describe("applyDependencyOrderWithinSiblings：親子混在フラット配列での同親内並べ替え", () => {
  it("同じ親を共有する要素同士だけを依存順に並べ替え、他の要素の位置は変えない", () => {
    // 親p1の子: c1b(先行はc1a), 親p2の子: c2a/c2b（依存なし）。トップレベルtopも混在。
    const list = [
      mk({ id: "top", display_order: 0 }),
      mk({ id: "c1b", parent_task_id: "p1", display_order: 1 }),
      mk({ id: "c1a", parent_task_id: "p1", display_order: 2 }),
      mk({ id: "c2a", parent_task_id: "p2", display_order: 3 }),
      mk({ id: "c2b", parent_task_id: "p2", display_order: 4 }),
    ];
    const deps = [mkDep("c1a", "c1b")];
    const result = applyDependencyOrderWithinSiblings(list, deps).map(t => t.id);
    // p1の子だけ入れ替わり、その他の位置（枠）はそのまま
    expect(result).toEqual(["top", "c1a", "c1b", "c2a", "c2b"]);
  });

  it("親を持たないタスク（トップレベル）しか無ければ何も変えない", () => {
    const list = [
      mk({ id: "a", display_order: 1 }),
      mk({ id: "b", display_order: 2 }),
    ];
    expect(applyDependencyOrderWithinSiblings(list, [mkDep("b", "a")]).map(t => t.id)).toEqual(["a", "b"]);
  });
});

describe("filterHideCompletedTasks：ガント🙈トグル用の完了フィルタ（親子ロールアップ考慮）", () => {
  it("子0件の葉タスクは自身の status で判定：done は消え、それ以外は残る", () => {
    const t = [
      mk({ id: "a", status: "done" }),
      mk({ id: "b", status: "todo" }),
      mk({ id: "c", status: "in_progress" }),
    ];
    expect(filterHideCompletedTasks(t).map(x => x.id)).toEqual(["b", "c"]);
  });

  it("全子 done の親は、子ともども消える（完全に完了した枝だけ隠す）", () => {
    const t = [
      mk({ id: "p", status: "todo" }), // 親自身のstatus値は無視される（rollup優先）
      mk({ id: "c1", parent_task_id: "p", status: "done" }),
      mk({ id: "c2", parent_task_id: "p", status: "done" }),
    ];
    expect(filterHideCompletedTasks(t).map(x => x.id)).toEqual([]);
  });

  it("未完了の子を1件でも持つ親は残る（子は個別に done/非done で判定される）", () => {
    const t = [
      mk({ id: "p", status: "done" }), // 親自身のstatusがdoneでも rollup が優先される
      mk({ id: "c1", parent_task_id: "p", status: "done" }),
      mk({ id: "c2", parent_task_id: "p", status: "todo" }),
    ];
    const result = filterHideCompletedTasks(t).map(x => x.id);
    // 親pは残る（rollup=in_progress）。done の子c1は消え、未完了のc2は残る
    expect(result).toEqual(["p", "c2"]);
  });

  it("削除済みの子はロールアップ判定に含めない（既存 rollupStatus と同じ挙動）", () => {
    // cdel は is_deleted のため rollup 計算からは除外される。非削除の子は c1(done) のみなので
    // rollup=done→親p・c1は消える。cdel 自身は関数が is_deleted で除外する責務は持たない
    // （呼び出し側が active() 済みの配列を渡す前提。ここでは自身の status=todo で判定され残る）。
    const t = [
      mk({ id: "p", status: "todo" }),
      mk({ id: "c1", parent_task_id: "p", status: "done" }),
      mk({ id: "cdel", parent_task_id: "p", status: "todo", is_deleted: true }),
    ];
    expect(filterHideCompletedTasks(t).map(x => x.id)).toEqual(["cdel"]);
  });

  it("空配列を渡すと空配列を返す", () => {
    expect(filterHideCompletedTasks([])).toEqual([]);
  });
});
