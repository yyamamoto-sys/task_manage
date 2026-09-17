// src/lib/ai/__tests__/bulkEditPlan.test.ts
//
// bulk_rename / bulk_status の安全装置（CLAUDE.md Section 56）を固定するテスト。

import { describe, it, expect } from "vitest";
import {
  buildBulkRenamePlan,
  buildBulkExclusionSummary,
  buildBulkStatusPlan,
  BULK_WARNING_THRESHOLD,
} from "../bulkEditPlan";

describe("buildBulkRenamePlan", () => {
  it("findが対象タスク名を置換し、新しい名前を算出する", () => {
    const plan = buildBulkRenamePlan(
      [{ id: "t1", name: "第2回定例会議" }, { id: "t2", name: "第2回準備" }],
      "第2回",
      "第3回",
    );
    expect(plan.items).toEqual([
      { task_id: "t1", task_name: "第2回定例会議", new_name: "第3回定例会議" },
      { task_id: "t2", task_name: "第2回準備", new_name: "第3回準備" },
    ]);
    expect(plan.excluded).toEqual([]);
    expect(plan.totalTargetCount).toBe(2);
    expect(plan.overLimit).toBe(false);
  });

  it("findが空文字だと全タスクが「変化なし」で除外される", () => {
    const plan = buildBulkRenamePlan([{ id: "t1", name: "タスクA" }], "", "第3回");
    expect(plan.items).toEqual([]);
    expect(plan.excluded).toEqual([{ task_id: "t1", task_name: "タスクA", reason: "unchanged" }]);
  });

  it("置換後に空文字（trim含む）になるタスクは除外される", () => {
    const plan = buildBulkRenamePlan(
      [{ id: "t1", name: "第2回" }, { id: "t2", name: "第2回 " }],
      "第2回",
      "",
    );
    // "第2回" → "" (空文字) / "第2回 " → " " (trimすると空文字)
    expect(plan.items).toEqual([]);
    expect(plan.excluded).toEqual([
      { task_id: "t1", task_name: "第2回", reason: "empty" },
      { task_id: "t2", task_name: "第2回 ", reason: "empty" },
    ]);
  });

  it("findを含まないタスクは「変化なし」で除外される（AIの誤判定混入対策）", () => {
    const plan = buildBulkRenamePlan(
      [{ id: "t1", name: "第2回会議" }, { id: "t2", name: "無関係タスク" }],
      "第2回",
      "第3回",
    );
    expect(plan.items).toEqual([{ task_id: "t1", task_name: "第2回会議", new_name: "第3回会議" }]);
    expect(plan.excluded).toEqual([{ task_id: "t2", task_name: "無関係タスク", reason: "unchanged" }]);
  });

  it("全角・半角が混在していても文字列一致した分だけ置換する", () => {
    const plan = buildBulkRenamePlan(
      [{ id: "t1", name: "第２回会議" }, { id: "t2", name: "第2回会議" }],
      "第2回",
      "第3回",
    );
    // "第２回"（全角２）は "第2回"（半角2）と文字列として一致しないため対象外＝変化なし
    expect(plan.items).toEqual([{ task_id: "t2", task_name: "第2回会議", new_name: "第3回会議" }]);
    expect(plan.excluded).toEqual([{ task_id: "t1", task_name: "第２回会議", reason: "unchanged" }]);
  });

  it("対象が50件を超えるとoverLimit=trueになる", () => {
    const tasks = Array.from({ length: 51 }, (_, i) => ({ id: `t${i}`, name: `第2回-${i}` }));
    const plan = buildBulkRenamePlan(tasks, "第2回", "第3回");
    expect(plan.totalTargetCount).toBe(51);
    expect(plan.overLimit).toBe(true);
  });

  it("ちょうど50件はoverLimit=falseのまま", () => {
    const tasks = Array.from({ length: BULK_WARNING_THRESHOLD }, (_, i) => ({ id: `t${i}`, name: `第2回-${i}` }));
    const plan = buildBulkRenamePlan(tasks, "第2回", "第3回");
    expect(plan.overLimit).toBe(false);
  });
});

describe("buildBulkExclusionSummary", () => {
  it("除外が無ければundefinedを返す", () => {
    expect(buildBulkExclusionSummary([])).toBeUndefined();
  });

  it("除外理由ごとの件数を含む文言を返す", () => {
    const summary = buildBulkExclusionSummary([
      { task_id: "t1", task_name: "A", reason: "empty" },
      { task_id: "t2", task_name: "B", reason: "unchanged" },
      { task_id: "t3", task_name: "C", reason: "unchanged" },
    ]);
    expect(summary).toContain("3件");
    expect(summary).toContain("置換後に名前が空になる：1件");
    expect(summary).toContain("置換しても変化なし：2件");
  });
});

describe("buildBulkStatusPlan", () => {
  it("全対象タスクをitemsに含める（自動除外はしない）", () => {
    const plan = buildBulkStatusPlan([
      { id: "t1", name: "A", status: "todo" },
      { id: "t2", name: "B", status: "done" },
    ]);
    expect(plan.items).toEqual([
      { task_id: "t1", task_name: "A", current_status: "todo" },
      { task_id: "t2", task_name: "B", current_status: "done" },
    ]);
    expect(plan.totalTargetCount).toBe(2);
  });

  it("対象が50件を超えるとoverLimit=trueになる", () => {
    const tasks = Array.from({ length: 60 }, (_, i) => ({ id: `t${i}`, name: `T${i}`, status: "todo" as const }));
    const plan = buildBulkStatusPlan(tasks);
    expect(plan.overLimit).toBe(true);
  });
});
