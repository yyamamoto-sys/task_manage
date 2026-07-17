import { describe, it, expect } from "vitest";
import { wouldCreateCycle, canAddDependency } from "../cycleCheck";

describe("wouldCreateCycle", () => {
  it("自己依存は循環とみなす", () => {
    expect(wouldCreateCycle([], "t1", "t1")).toBe(true);
  });

  it("依存が無ければ循環しない", () => {
    expect(wouldCreateCycle([], "t1", "t2")).toBe(false);
  });

  it("直接の逆向き依存（B→A が既にあるとき A→B を足す）は循環になる", () => {
    const deps = [{ predecessor_task_id: "t2", successor_task_id: "t1" }];
    expect(wouldCreateCycle(deps, "t1", "t2")).toBe(true);
  });

  it("間接的な循環（A→B→C→A）を検出する", () => {
    const deps = [
      { predecessor_task_id: "t1", successor_task_id: "t2" },
      { predecessor_task_id: "t2", successor_task_id: "t3" },
    ];
    // t3 → t1 を足すと t1→t2→t3→t1 の循環になる
    expect(wouldCreateCycle(deps, "t3", "t1")).toBe(true);
  });

  it("循環しない鎖への追加は許可する", () => {
    const deps = [
      { predecessor_task_id: "t1", successor_task_id: "t2" },
      { predecessor_task_id: "t2", successor_task_id: "t3" },
    ];
    expect(wouldCreateCycle(deps, "t3", "t4")).toBe(false);
  });

  it("無関係な既存依存は判定に影響しない", () => {
    const deps = [{ predecessor_task_id: "x1", successor_task_id: "x2" }];
    expect(wouldCreateCycle(deps, "t1", "t2")).toBe(false);
  });
});

describe("canAddDependency", () => {
  it("自己依存を拒否する", () => {
    const result = canAddDependency([], "t1", "t1");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/自分自身/);
  });

  it("重複を拒否する", () => {
    const deps = [{ predecessor_task_id: "t1", successor_task_id: "t2" }];
    const result = canAddDependency(deps, "t1", "t2");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/すでに設定済み/);
  });

  it("循環を作る組み合わせを拒否する", () => {
    const deps = [{ predecessor_task_id: "t2", successor_task_id: "t1" }];
    const result = canAddDependency(deps, "t1", "t2");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/循環/);
  });

  it("問題のない組み合わせは許可する", () => {
    const result = canAddDependency([], "t1", "t2");
    expect(result.ok).toBe(true);
    expect(result.reason).toBeUndefined();
  });
});
