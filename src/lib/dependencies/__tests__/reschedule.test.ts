import { describe, it, expect } from "vitest";
import { computeCascadeShifts, computeCascadeShiftsMulti } from "../reschedule";
import type { Task, TaskDependency } from "../../localData/types";

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    name: "task",
    project_id: null,
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

describe("computeCascadeShifts", () => {
  it("1. 単一リンクで違反時に押す", () => {
    // A: due 8/10（更新後）、B: start 8/5〜due 8/8（作業期間3日）。8/10 > 8/5 なので違反。
    const a = makeTask({ id: "A", start_date: "2026-08-01", due_date: "2026-08-10" });
    const b = makeTask({ id: "B", start_date: "2026-08-05", due_date: "2026-08-08" });
    const deps = [makeDep({ predecessor_task_id: "A", successor_task_id: "B" })];

    const shifts = computeCascadeShifts("A", [a, b], deps);

    expect(shifts).toEqual([
      { taskId: "B", oldStart: "2026-08-05", oldDue: "2026-08-08", newStart: "2026-08-10", newDue: "2026-08-13" },
    ]);
  });

  it("2. 余裕がある時は押さない", () => {
    // A due 8/10、B start 8/15（8/10より後）なので余裕あり → 動かさない
    const a = makeTask({ id: "A", start_date: "2026-08-01", due_date: "2026-08-10" });
    const b = makeTask({ id: "B", start_date: "2026-08-15", due_date: "2026-08-20" });
    const deps = [makeDep({ predecessor_task_id: "A", successor_task_id: "B" })];

    expect(computeCascadeShifts("A", [a, b], deps)).toEqual([]);
  });

  it("3. 複数先行は最大値で判定", () => {
    // B の先行が A1(due 8/10) と A2(due 8/14) の2つ。最大値 8/14 で判定する。
    const a1 = makeTask({ id: "A1", start_date: "2026-08-01", due_date: "2026-08-10" });
    const a2 = makeTask({ id: "A2", start_date: "2026-08-01", due_date: "2026-08-14" });
    const b = makeTask({ id: "B", start_date: "2026-08-05", due_date: "2026-08-08" });
    const deps = [
      makeDep({ predecessor_task_id: "A1", successor_task_id: "B" }),
      makeDep({ predecessor_task_id: "A2", successor_task_id: "B" }),
    ];

    // origin=A2 の保存を起点とする（A1側の枝は既存値のまま渡る）
    const shifts = computeCascadeShifts("A2", [a1, a2, b], deps);

    expect(shifts).toEqual([
      { taskId: "B", oldStart: "2026-08-05", oldDue: "2026-08-08", newStart: "2026-08-14", newDue: "2026-08-17" },
    ]);
  });

  it("4. A→B→Cの連鎖伝播", () => {
    const a = makeTask({ id: "A", start_date: "2026-08-01", due_date: "2026-08-10" });
    const b = makeTask({ id: "B", start_date: "2026-08-05", due_date: "2026-08-08" }); // 期間3日
    const c = makeTask({ id: "C", start_date: "2026-08-09", due_date: "2026-08-11" }); // 期間2日
    const deps = [
      makeDep({ predecessor_task_id: "A", successor_task_id: "B" }),
      makeDep({ predecessor_task_id: "B", successor_task_id: "C" }),
    ];

    const shifts = computeCascadeShifts("A", [a, b, c], deps);

    // B: 8/5→8/10（delta5）、due 8/8→8/13
    // C: Bの新due(8/13) > 元start(8/9) なので違反。delta = 8/13-8/9=4。newStart=8/13, newDue=8/11+4=8/15
    expect(shifts).toEqual([
      { taskId: "B", oldStart: "2026-08-05", oldDue: "2026-08-08", newStart: "2026-08-10", newDue: "2026-08-13" },
      { taskId: "C", oldStart: "2026-08-09", oldDue: "2026-08-11", newStart: "2026-08-13", newDue: "2026-08-15" },
    ]);
  });

  it("5. 前倒し時は動かさない（押す方向のみ）", () => {
    // A の due が前倒しになっても、B は元々余裕があった（start 8/12 > 新due 8/5）ので動かさない
    const a = makeTask({ id: "A", start_date: "2026-08-01", due_date: "2026-08-05" });
    const b = makeTask({ id: "B", start_date: "2026-08-12", due_date: "2026-08-15" });
    const deps = [makeDep({ predecessor_task_id: "A", successor_task_id: "B" })];

    expect(computeCascadeShifts("A", [a, b], deps)).toEqual([]);
  });

  it("6. 開始日の無い後続はスキップ", () => {
    const a = makeTask({ id: "A", start_date: "2026-08-01", due_date: "2026-08-10" });
    const b = makeTask({ id: "B", start_date: null, due_date: "2026-08-08" });
    const deps = [makeDep({ predecessor_task_id: "A", successor_task_id: "B" })];

    expect(computeCascadeShifts("A", [a, b], deps)).toEqual([]);
  });

  it("6b. 期日の無い後続もスキップ（作業期間を保持できないため）", () => {
    const a = makeTask({ id: "A", start_date: "2026-08-01", due_date: "2026-08-10" });
    const b = makeTask({ id: "B", start_date: "2026-08-05", due_date: null });
    const deps = [makeDep({ predecessor_task_id: "A", successor_task_id: "B" })];

    expect(computeCascadeShifts("A", [a, b], deps)).toEqual([]);
  });

  it("7. 作業期間(duration)が保持される", () => {
    const a = makeTask({ id: "A", start_date: "2026-08-01", due_date: "2026-08-20" });
    const b = makeTask({ id: "B", start_date: "2026-08-03", due_date: "2026-08-09" }); // 6日間
    const deps = [makeDep({ predecessor_task_id: "A", successor_task_id: "B" })];

    const shifts = computeCascadeShifts("A", [a, b], deps);
    expect(shifts).toHaveLength(1);
    const [shift] = shifts;
    const start = new Date(shift.newStart);
    const due = new Date(shift.newDue);
    const durationDays = Math.round((due.getTime() - start.getTime()) / 86400000);
    expect(durationDays).toBe(6);
    expect(shift.newStart).toBe("2026-08-20");
    expect(shift.newDue).toBe("2026-08-26");
  });

  it("8. 循環が無限ループにならない（防御的チェック）", () => {
    // 本来B1のcanAddDependencyで防止されるが、防御的にA→B→Aの循環データを渡してもハングしない
    const a = makeTask({ id: "A", start_date: "2026-08-01", due_date: "2026-08-10" });
    const b = makeTask({ id: "B", start_date: "2026-08-02", due_date: "2026-08-05" });
    const deps = [
      makeDep({ predecessor_task_id: "A", successor_task_id: "B" }),
      makeDep({ predecessor_task_id: "B", successor_task_id: "A" }),
    ];

    expect(() => computeCascadeShifts("A", [a, b], deps)).not.toThrow();
    expect(computeCascadeShifts("A", [a, b], deps)).toEqual([]);
  });

  it("9. deltaがゼロなら無変更（同日開始は可）", () => {
    // B の start がちょうど A の due と同じ → ギャップ強制なしなので動かさない
    const a = makeTask({ id: "A", start_date: "2026-08-01", due_date: "2026-08-10" });
    const b = makeTask({ id: "B", start_date: "2026-08-10", due_date: "2026-08-12" });
    const deps = [makeDep({ predecessor_task_id: "A", successor_task_id: "B" })];

    expect(computeCascadeShifts("A", [a, b], deps)).toEqual([]);
  });

  it("9b. deltaが負なら無変更", () => {
    const a = makeTask({ id: "A", start_date: "2026-08-01", due_date: "2026-08-10" });
    const b = makeTask({ id: "B", start_date: "2026-08-11", due_date: "2026-08-13" });
    const deps = [makeDep({ predecessor_task_id: "A", successor_task_id: "B" })];

    expect(computeCascadeShifts("A", [a, b], deps)).toEqual([]);
  });

  it("origin自体は返さない・依存の無いタスクは無視される", () => {
    const a = makeTask({ id: "A", start_date: "2026-08-01", due_date: "2026-08-10" });
    const unrelated = makeTask({ id: "X", start_date: "2026-08-01", due_date: "2026-08-02" });
    expect(computeCascadeShifts("A", [a, unrelated], [])).toEqual([]);
  });

  it("削除済みタスク・削除済み依存は無視する", () => {
    const a = makeTask({ id: "A", start_date: "2026-08-01", due_date: "2026-08-10" });
    const b = makeTask({ id: "B", start_date: "2026-08-05", due_date: "2026-08-08", is_deleted: true });
    const c = makeTask({ id: "C", start_date: "2026-08-05", due_date: "2026-08-08" });
    const deps = [
      makeDep({ predecessor_task_id: "A", successor_task_id: "B" }),
      makeDep({ predecessor_task_id: "A", successor_task_id: "C", is_deleted: true }),
    ];
    expect(computeCascadeShifts("A", [a, b, c], deps)).toEqual([]);
  });

  it("10. 後続がdoneなら自動で動かさない（computeBulkMoveShiftsと同じ「終わったタスク」ルール）", () => {
    const a = makeTask({ id: "A", start_date: "2026-08-01", due_date: "2026-08-10" });
    const b = makeTask({ id: "B", start_date: "2026-08-05", due_date: "2026-08-08", status: "done" });
    const deps = [makeDep({ predecessor_task_id: "A", successor_task_id: "B" })];
    expect(computeCascadeShifts("A", [a, b], deps)).toEqual([]);
  });

  it("11. 後続がcancelledなら自動で動かさない", () => {
    const a = makeTask({ id: "A", start_date: "2026-08-01", due_date: "2026-08-10" });
    const b = makeTask({ id: "B", start_date: "2026-08-05", due_date: "2026-08-08", status: "cancelled" });
    const deps = [makeDep({ predecessor_task_id: "A", successor_task_id: "B" })];
    expect(computeCascadeShifts("A", [a, b], deps)).toEqual([]);
  });

  it("12. 後続がon_holdなら引き続き自動で動かす（保留はシフト対象のまま）", () => {
    const a = makeTask({ id: "A", start_date: "2026-08-01", due_date: "2026-08-10" });
    const b = makeTask({ id: "B", start_date: "2026-08-05", due_date: "2026-08-08", status: "on_hold" });
    const deps = [makeDep({ predecessor_task_id: "A", successor_task_id: "B" })];
    expect(computeCascadeShifts("A", [a, b], deps)).toEqual([
      { taskId: "B", oldStart: "2026-08-05", oldDue: "2026-08-08", newStart: "2026-08-10", newDue: "2026-08-13" },
    ]);
  });

  it("13. 途中がdoneで動かない場合、その先の後続への伝播はそこで止まる（元の期日のまま判定）", () => {
    // A→B(done)→C。Bはdoneのため動かない。CはBの「元の」dueで判定し、余裕があるので動かない。
    const a = makeTask({ id: "A", start_date: "2026-08-01", due_date: "2026-08-10" });
    const b = makeTask({ id: "B", start_date: "2026-08-05", due_date: "2026-08-08", status: "done" });
    const c = makeTask({ id: "C", start_date: "2026-08-09", due_date: "2026-08-11" });
    const deps = [
      makeDep({ predecessor_task_id: "A", successor_task_id: "B" }),
      makeDep({ predecessor_task_id: "B", successor_task_id: "C" }),
    ];
    expect(computeCascadeShifts("A", [a, b, c], deps)).toEqual([]);
  });
});

describe("computeCascadeShiftsMulti（ガント複数選択の一括シフト用・複数origin版）", () => {
  it("単一originならcomputeCascadeShiftsと同じ結果", () => {
    const a = makeTask({ id: "A", start_date: "2026-08-01", due_date: "2026-08-10" });
    const b = makeTask({ id: "B", start_date: "2026-08-05", due_date: "2026-08-08" });
    const deps = [makeDep({ predecessor_task_id: "A", successor_task_id: "B" })];
    expect(computeCascadeShiftsMulti(["A"], [a, b], deps)).toEqual(computeCascadeShifts("A", [a, b], deps));
  });

  it("複数originからの後続を1回のパスで合成する（それぞれ別の後続を押す）", () => {
    // A→X、B→Y。AとBを一括シフトした後の状態（allTasksに反映済み）から、XとYがそれぞれ押される
    const a = makeTask({ id: "A", start_date: "2026-08-01", due_date: "2026-08-10" });
    const b = makeTask({ id: "B", start_date: "2026-08-01", due_date: "2026-08-12" });
    const x = makeTask({ id: "X", start_date: "2026-08-05", due_date: "2026-08-08" });
    const y = makeTask({ id: "Y", start_date: "2026-08-05", due_date: "2026-08-09" });
    const deps = [
      makeDep({ predecessor_task_id: "A", successor_task_id: "X" }),
      makeDep({ predecessor_task_id: "B", successor_task_id: "Y" }),
    ];
    const shifts = computeCascadeShiftsMulti(["A", "B"], [a, b, x, y], deps);
    expect(shifts).toEqual([
      { taskId: "X", oldStart: "2026-08-05", oldDue: "2026-08-08", newStart: "2026-08-10", newDue: "2026-08-13" },
      { taskId: "Y", oldStart: "2026-08-05", oldDue: "2026-08-09", newStart: "2026-08-12", newDue: "2026-08-16" },
    ]);
  });

  it("origin同士が依存で繋がっていても、origin自身はカスケード対象にしない（bulk側で既に同delta適用済みのため）", () => {
    // A→B（両方origin）。Aが押してもBはreachableに含めない＝Bはcascadeシフトされない
    const a = makeTask({ id: "A", start_date: "2026-08-01", due_date: "2026-08-10" });
    const b = makeTask({ id: "B", start_date: "2026-08-01", due_date: "2026-08-12" });
    const deps = [makeDep({ predecessor_task_id: "A", successor_task_id: "B" })];
    expect(computeCascadeShiftsMulti(["A", "B"], [a, b], deps)).toEqual([]);
  });

  it("複数originが同じ後続を押す場合、より大きい方（最大値）が採用される", () => {
    const a = makeTask({ id: "A", start_date: "2026-08-01", due_date: "2026-08-09" });
    const b = makeTask({ id: "B", start_date: "2026-08-01", due_date: "2026-08-12" });
    const c = makeTask({ id: "C", start_date: "2026-08-05", due_date: "2026-08-08" });
    const deps = [
      makeDep({ predecessor_task_id: "A", successor_task_id: "C" }),
      makeDep({ predecessor_task_id: "B", successor_task_id: "C" }),
    ];
    const shifts = computeCascadeShiftsMulti(["A", "B"], [a, b, c], deps);
    expect(shifts).toEqual([
      { taskId: "C", oldStart: "2026-08-05", oldDue: "2026-08-08", newStart: "2026-08-12", newDue: "2026-08-15" },
    ]);
  });

  it("空配列を渡すと空配列", () => {
    expect(computeCascadeShiftsMulti([], [], [])).toEqual([]);
  });
});
