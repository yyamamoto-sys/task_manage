import { describe, it, expect } from "vitest";
import { computeCriticalTaskIds } from "../criticalPath";
import type { Task, TaskDependency } from "../../localData/types";

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    name: "task",
    project_id: "pj1",
    todo_ids: [],
    assignee_member_id: "",
    assignee_member_ids: [],
    status: "todo",
    priority: null,
    start_date: null,
    due_date: null,
    estimated_hours: null,
    comment: "",
    is_deleted: false,
    ...overrides,
  };
}

function makeDep(overrides: Partial<TaskDependency> & { predecessor_task_id: string; successor_task_id: string }): TaskDependency {
  return {
    id: `${overrides.predecessor_task_id}->${overrides.successor_task_id}`,
    is_deleted: false,
    ...overrides,
  };
}

describe("computeCriticalTaskIds", () => {
  it("1. 単一チェーンの全タスクがクリティカル", () => {
    const a = makeTask({ id: "A", start_date: "2026-08-01", due_date: "2026-08-05" }); // 4日
    const b = makeTask({ id: "B", start_date: "2026-08-05", due_date: "2026-08-08" }); // 3日
    const c = makeTask({ id: "C", start_date: "2026-08-08", due_date: "2026-08-10" }); // 2日
    const deps = [
      makeDep({ predecessor_task_id: "A", successor_task_id: "B" }),
      makeDep({ predecessor_task_id: "B", successor_task_id: "C" }),
    ];
    const result = computeCriticalTaskIds([a, b, c], deps);
    expect(result).toEqual(new Set(["A", "B", "C"]));
  });

  it("2. 分岐では長い方のパスが選ばれる", () => {
    // A → B（短い枝：2日）／A → C → D（長い枝：3+4=7日）
    const a = makeTask({ id: "A", start_date: "2026-08-01", due_date: "2026-08-03" }); // 2日
    const b = makeTask({ id: "B", start_date: "2026-08-03", due_date: "2026-08-05" }); // 2日（短い枝）
    const c = makeTask({ id: "C", start_date: "2026-08-03", due_date: "2026-08-06" }); // 3日
    const d = makeTask({ id: "D", start_date: "2026-08-06", due_date: "2026-08-10" }); // 4日（長い枝）
    const deps = [
      makeDep({ predecessor_task_id: "A", successor_task_id: "B" }),
      makeDep({ predecessor_task_id: "A", successor_task_id: "C" }),
      makeDep({ predecessor_task_id: "C", successor_task_id: "D" }),
    ];
    const result = computeCriticalTaskIds([a, b, c, d], deps);
    expect(result).toEqual(new Set(["A", "C", "D"]));
    expect(result.has("B")).toBe(false);
  });

  it("3. 複数の最長パスが同率タイの場合は和集合を返す", () => {
    // A → B（4日）／A → C（4日）。どちらも同じ長さの最長パスなので両方クリティカル
    const a = makeTask({ id: "A", start_date: "2026-08-01", due_date: "2026-08-02" }); // 1日
    const b = makeTask({ id: "B", start_date: "2026-08-02", due_date: "2026-08-06" }); // 4日
    const c = makeTask({ id: "C", start_date: "2026-08-02", due_date: "2026-08-06" }); // 4日
    const deps = [
      makeDep({ predecessor_task_id: "A", successor_task_id: "B" }),
      makeDep({ predecessor_task_id: "A", successor_task_id: "C" }),
    ];
    const result = computeCriticalTaskIds([a, b, c], deps);
    expect(result).toEqual(new Set(["A", "B", "C"]));
  });

  it("4. 日付が欠けるタスクは duration=0 として安全に処理される（クラッシュしない）", () => {
    // A(日付あり) → B(日付なし) → C(日付あり)。唯一の経路なのでBもクリティカルに含まれる
    const a = makeTask({ id: "A", start_date: "2026-08-01", due_date: "2026-08-05" });
    const b = makeTask({ id: "B", start_date: null, due_date: null });
    const c = makeTask({ id: "C", start_date: "2026-08-05", due_date: "2026-08-08" });
    const deps = [
      makeDep({ predecessor_task_id: "A", successor_task_id: "B" }),
      makeDep({ predecessor_task_id: "B", successor_task_id: "C" }),
    ];
    expect(() => computeCriticalTaskIds([a, b, c], deps)).not.toThrow();
    const result = computeCriticalTaskIds([a, b, c], deps);
    expect(result).toEqual(new Set(["A", "B", "C"]));
  });

  it("4b. 全タスクの日付が欠けている場合は何も強調しない（ノイズ防止）", () => {
    const a = makeTask({ id: "A", start_date: null, due_date: null });
    const b = makeTask({ id: "B", start_date: null, due_date: null });
    const deps = [makeDep({ predecessor_task_id: "A", successor_task_id: "B" })];
    expect(computeCriticalTaskIds([a, b], deps)).toEqual(new Set());
  });

  it("5. プロジェクトをまたぐ依存はそのプロジェクトのCP計算に含めない", () => {
    // A(pj1) → B(pj2) という依存はどちらのプロジェクトの経路にも数えない。
    // pj1側はAのみの単独パス、pj2側はBのみの単独パスとして扱われる
    const a = makeTask({ id: "A", project_id: "pj1", start_date: "2026-08-01", due_date: "2026-08-10" });
    const b = makeTask({ id: "B", project_id: "pj2", start_date: "2026-08-01", due_date: "2026-08-03" });
    const deps = [makeDep({ predecessor_task_id: "A", successor_task_id: "B" })];
    const result = computeCriticalTaskIds([a, b], deps);
    // 両方とも「自分のプロジェクト内で唯一のタスク」なのでそれぞれのプロジェクト内で最長パス＝自分自身
    expect(result).toEqual(new Set(["A", "B"]));
  });

  it("5b. プロジェクトをまたぐ依存によって他PJのタスクが誤って延長されない", () => {
    // pj1: X(短い・1日) → Y(pj2・長い・10日) という越境依存があっても、
    // pj1側のXは「X単独」の長さでのみ評価され、pj1内に他の長いチェーンがあればそちらが選ばれる
    const x = makeTask({ id: "X", project_id: "pj1", start_date: "2026-08-01", due_date: "2026-08-02" }); // 1日
    const longChain1 = makeTask({ id: "L1", project_id: "pj1", start_date: "2026-08-01", due_date: "2026-08-15" }); // 14日
    const y = makeTask({ id: "Y", project_id: "pj2", start_date: "2026-08-01", due_date: "2026-08-11" }); // 10日
    const deps = [makeDep({ predecessor_task_id: "X", successor_task_id: "Y" })];
    const result = computeCriticalTaskIds([x, longChain1, y], deps);
    expect(result.has("L1")).toBe(true);
    expect(result.has("X")).toBe(false);
  });

  it("6. 循環データがあっても例外を投げずフォールバックする（空＝強調なし）", () => {
    const a = makeTask({ id: "A", start_date: "2026-08-01", due_date: "2026-08-05" });
    const b = makeTask({ id: "B", start_date: "2026-08-05", due_date: "2026-08-08" });
    const deps = [
      makeDep({ predecessor_task_id: "A", successor_task_id: "B" }),
      makeDep({ predecessor_task_id: "B", successor_task_id: "A" }),
    ];
    expect(() => computeCriticalTaskIds([a, b], deps)).not.toThrow();
    expect(computeCriticalTaskIds([a, b], deps)).toEqual(new Set());
  });

  it("7. project_id が無いタスクは対象外", () => {
    const a = makeTask({ id: "A", project_id: null, start_date: "2026-08-01", due_date: "2026-08-05" });
    expect(computeCriticalTaskIds([a], [])).toEqual(new Set());
  });

  it("8. 削除済みタスク・削除済み依存は無視する", () => {
    const a = makeTask({ id: "A", start_date: "2026-08-01", due_date: "2026-08-05" });
    const b = makeTask({ id: "B", start_date: "2026-08-05", due_date: "2026-08-08", is_deleted: true });
    const c = makeTask({ id: "C", start_date: "2026-08-01", due_date: "2026-08-02" });
    const deps = [
      makeDep({ predecessor_task_id: "A", successor_task_id: "B" }),
      makeDep({ predecessor_task_id: "A", successor_task_id: "C", is_deleted: true }),
    ];
    const result = computeCriticalTaskIds([a, b, c], deps);
    expect(result.has("B")).toBe(false);
    // Aは削除済みBへの生きた依存を失うので単独パス、Cは削除済み依存で孤立しどちらも単独パスとして評価される
    expect(result).toEqual(new Set(["A"]));
  });

  it("8b. cancelled/on_hold のタスクはノード集合から除外される（is_deletedと同じ扱い。2026-07-21）", () => {
    const a = makeTask({ id: "A", start_date: "2026-08-01", due_date: "2026-08-05" });
    const b = makeTask({ id: "B", start_date: "2026-08-05", due_date: "2026-08-08", status: "cancelled" });
    const c = makeTask({ id: "C", start_date: "2026-08-01", due_date: "2026-08-02" });
    const d = makeTask({ id: "D", start_date: "2026-08-01", due_date: "2026-08-03", status: "on_hold" });
    const deps = [
      makeDep({ predecessor_task_id: "A", successor_task_id: "B" }),
      makeDep({ predecessor_task_id: "A", successor_task_id: "D" }),
    ];
    const result = computeCriticalTaskIds([a, b, c, d], deps);
    expect(result.has("B")).toBe(false);
    expect(result.has("D")).toBe(false);
    expect(result).toEqual(new Set(["A"]));
  });

  it("8c. done のタスクは引き続きノード集合に含まれる（cancelled/on_holdとは異なる扱い）", () => {
    const a = makeTask({ id: "A", start_date: "2026-08-01", due_date: "2026-08-05", status: "done" });
    const b = makeTask({ id: "B", start_date: "2026-08-05", due_date: "2026-08-08" });
    const deps = [makeDep({ predecessor_task_id: "A", successor_task_id: "B" })];
    const result = computeCriticalTaskIds([a, b], deps);
    expect(result).toEqual(new Set(["A", "B"]));
  });

  it("空配列を渡すと空集合", () => {
    expect(computeCriticalTaskIds([], [])).toEqual(new Set());
  });

  it("単一タスク・依存なしなら自分自身がクリティカル", () => {
    const a = makeTask({ id: "A", start_date: "2026-08-01", due_date: "2026-08-05" });
    expect(computeCriticalTaskIds([a], [])).toEqual(new Set(["A"]));
  });
});
