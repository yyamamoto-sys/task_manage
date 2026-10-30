// タスクの親子を任意の深さにする Phase B（編集操作）の純粋ロジック（v3.196）。
// Tab／Shift+Tab の結果・複数選択・Undo 用の prev・編集面の親欄の選択肢・DB の循環拒否の文言・配線の走査。
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { Task } from "../../localData/types";
import { computeIndent, computeOutdent } from "../indentOutdent";
import { buildParentOptions } from "../parentOptions";
import { formatErrorForUser } from "../../errorMessage";
import { buildTaskUpdatePayload, computeFormDirty } from "../../taskEditPayload";

function mk(id: string, extra: Partial<Task> = {}): Task {
  return {
    id, name: id, project_id: "p1", todo_ids: [], assignee_member_id: "", assignee_member_ids: [],
    status: "todo", priority: null, start_date: null, due_date: null, estimated_hours: null, comment: "",
    is_deleted: false, display_order: 0, ...extra,
  } as Task;
}

// A(0) ├ A1(0) ├ A1a / A2(1)   B(1)   C(2) ├ C1
const tree = (): Task[] => [
  mk("A", { display_order: 0 }),
  mk("A1", { parent_task_id: "A", display_order: 0 }),
  mk("A1a", { parent_task_id: "A1", display_order: 0 }),
  mk("A2", { parent_task_id: "A", display_order: 1 }),
  mk("B", { display_order: 1 }),
  mk("C", { display_order: 2 }),
  mk("C1", { parent_task_id: "C", display_order: 0 }),
];
const VISIBLE = ["A", "A1", "A1a", "A2", "B", "C", "C1"];

function apply(tasks: Task[], r: { patches: { id: string; patch: Partial<Task> }[] }): Task[] {
  const m = new Map(r.patches.map(p => [p.id, p.patch]));
  return tasks.map(t => (m.has(t.id) ? { ...t, ...m.get(t.id) } : t));
}
function parentOf(tasks: Task[], id: string) {
  return tasks.find(t => t.id === id)!.parent_task_id ?? null;
}
function kidsInOrder(tasks: Task[], parentId: string | null) {
  return tasks.filter(t => (t.parent_task_id ?? null) === parentId)
    .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0)).map(t => t.id);
}

describe("Tab（1段下げる）", () => {
  it("直前の兄弟の最後の子になる（B → A の最後の子）", () => {
    const r = computeIndent(tree(), VISIBLE, ["B"]);
    const next = apply(tree(), r);
    expect(parentOf(next, "B")).toBe("A");
    expect(kidsInOrder(next, "A")).toEqual(["A1", "A2", "B"]);
    expect(r.newParentIds).toEqual(["A"]);
  });

  it("深い段でも1段下がる（A2 → A1 の最後の子。A1 の既存の子 A1a の後ろ）", () => {
    const r = computeIndent(tree(), VISIBLE, ["A2"]);
    const next = apply(tree(), r);
    expect(parentOf(next, "A2")).toBe("A1");
    expect(kidsInOrder(next, "A1")).toEqual(["A1a", "A2"]);
  });

  it("子持ちのタスクも子孫ごと下がる（C は B の子に。C1 は C の子のまま）", () => {
    const next = apply(tree(), computeIndent(tree(), VISIBLE, ["C"]));
    expect(parentOf(next, "C")).toBe("B");
    expect(parentOf(next, "C1")).toBe("C");
  });

  it("直前の兄弟が居なければ動かさない（先頭の A・A の最初の子 A1）", () => {
    expect(computeIndent(tree(), VISIBLE, ["A"])).toMatchObject({ patches: [], skippedCount: 1 });
    expect(computeIndent(tree(), VISIBLE, ["A1"])).toMatchObject({ patches: [], skippedCount: 1 });
  });

  it("複数選択：連続する兄弟は同じ直前の兄弟の下へ、表示順のまま入る", () => {
    const next = apply(tree(), computeIndent(tree(), VISIBLE, ["B", "C"]));
    expect(parentOf(next, "B")).toBe("A");
    expect(parentOf(next, "C")).toBe("A");
    expect(kidsInOrder(next, "A")).toEqual(["A1", "A2", "B", "C"]);
  });

  it("選択に祖先と子孫が両方あれば祖先側だけ動く", () => {
    const r = computeIndent(tree(), VISIBLE, ["C", "C1"]);
    expect(r.patches.map(p => p.id)).toEqual(["C"]);
  });

  it("別グループの最上位の下へは入らない", () => {
    const all = [mk("X", { section_id: "s1", display_order: 0 }), mk("Y", { section_id: "s2", display_order: 1 })];
    expect(computeIndent(all, ["X", "Y"], ["Y"]).patches).toEqual([]);
  });

  it("Undo 用に旧い親と並びを持つ", () => {
    const r = computeIndent(tree(), VISIBLE, ["B"]);
    expect(r.patches[0].prev).toMatchObject({ parent_task_id: null, display_order: 1 });
  });
});

describe("Shift+Tab（1段上げる）", () => {
  it("親の次の兄弟になる（A1a → A の子 A1 の直後）", () => {
    const next = apply(tree(), computeOutdent(tree(), VISIBLE, ["A1a"]));
    expect(parentOf(next, "A1a")).toBe("A");
    expect(kidsInOrder(next, "A")).toEqual(["A1", "A1a", "A2"]);
  });

  it("2段目から最上位へ（A2 → A の直後）。並びは親の兄弟として振り直される", () => {
    const next = apply(tree(), computeOutdent(tree(), VISIBLE, ["A2"]));
    expect(parentOf(next, "A2")).toBeNull();
    expect(kidsInOrder(next, null)).toEqual(["A", "A2", "B", "C"]);
  });

  it("最上位のタスクは動かさない", () => {
    expect(computeOutdent(tree(), VISIBLE, ["B"])).toMatchObject({ patches: [], skippedCount: 1 });
  });

  it("複数選択：同じ親の兄弟は、親の直後に表示順のまま並ぶ", () => {
    const next = apply(tree(), computeOutdent(tree(), VISIBLE, ["A1", "A2"]));
    expect(kidsInOrder(next, null)).toEqual(["A", "A1", "A2", "B", "C"]);
    expect(parentOf(next, "A1a")).toBe("A1");
  });

  it("Undo 用の旧い親", () => {
    const r = computeOutdent(tree(), VISIBLE, ["A1a"]);
    expect(r.patches.find(p => p.id === "A1a")!.prev.parent_task_id).toBe("A1");
  });
});

describe("編集面の親欄", () => {
  const projects = [{ id: "p1", name: "PJ1", color_tag: "#111" }];

  it("選択肢は同じPJの任意のタスクをパスで並べ、自分と子孫は出ない", () => {
    const opts = buildParentOptions(tree(), "p1", "A1", null, projects, "なし");
    expect(opts.map(o => o.value)).toEqual(["", "A", "A2", "B", "C", "C1"]);
    expect(opts.find(o => o.value === "C1")!.label).toBe("C > C1");
  });

  it("いまの親（中間の段）が選択肢に居る。保存しても親が外れない", () => {
    const t = tree();
    const opts = buildParentOptions(t, "p1", "A1a", "A1", projects, "なし");
    expect(opts.find(o => o.value === "A1")!.label).toBe("A > A1");
    const original = t.find(x => x.id === "A1a")!;
    const form = {
      name: original.name, status: original.status, priority: original.priority, project_id: "p1",
      parent_task_id: "A1", assignee_member_ids: [], start_date: "", due_date: "", estimated_hours: "", comment: "",
      todo_ids: [], section_id: null, deliverable: "",
    } as never;
    const payload = buildTaskUpdatePayload(original, form, t.find(x => x.id === "A1"), "u1");
    expect(payload.parent_task_id).toBe("A1");
    expect(computeFormDirty(form, form)).toBe(false);
  });

  it("候補に居ない現在の親（旧データ）も末尾に足して、欄が空に見えないようにする", () => {
    const t = [...tree(), mk("Z", { project_id: "p2" })];
    const opts = buildParentOptions(t, "p1", "B", "Z", projects, "なし");
    expect(opts[opts.length - 1].value).toBe("Z");
  });
});

describe("DB の循環拒否", () => {
  it("トリガーの例外は原因が分かる文言になる", () => {
    const e = Object.assign(new Error("task parent cycle: setting parent x on task y would create a cycle"), { code: "23514" });
    const msg = formatErrorForUser("保存に失敗しました", e);
    expect(msg).toContain("23514");
    expect(msg).toContain("循環");
    expect(msg).not.toContain("task parent cycle");
  });
});

describe("配線（ソース走査・コメントを除いて照合）", () => {
  const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, "../../../", rel), "utf-8")
    .split("\n").filter(l => !/^\s*(\/\/|\/\*|\*)/.test(l)).join("\n");

  it("Tab は入力欄・モーダル・IME では発火しない判定（shouldIgnoreSingleKey）より後ろにある", () => {
    const src = read("hooks/useTaskKeyboardNav.ts");
    expect(src.indexOf("shouldIgnoreSingleKey(e")).toBeGreaterThan(-1);
    expect(src.indexOf('e.key === "Tab"')).toBeGreaterThan(src.indexOf("shouldIgnoreSingleKey(e"));
  });

  it("リストだけが onIndent を渡す（カンバン・ガントの Tab は奪わない）", () => {
    expect(read("components/list/ListView.tsx")).toContain("onIndent: handleIndentKey");
    expect(read("components/kanban/KanbanView.tsx")).not.toContain("onIndent");
    expect(read("components/gantt/GanttView.tsx")).not.toContain("onIndent");
  });

  it("2段の制約が残っていない（親にできるのは最上位のみ・子持ちは子にできない、の判定）", () => {
    expect(read("hooks/useTaskDragReorder.ts")).not.toContain("isParentTask");
    expect(read("lib/task/multiReorder.ts")).not.toContain("ERR_PARENT_AS_CHILD");
    expect(read("lib/taskHierarchy.ts")).not.toContain("eligibleChildTasks");
    expect(read("components/list/ListView.tsx")).not.toContain("!target.parent_task_id");
  });
});
