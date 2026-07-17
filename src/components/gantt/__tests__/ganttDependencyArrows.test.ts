import { describe, it, expect } from "vitest";
import {
  buildDependencyElbowPoints, pointsToPathD, computeDependencyRenders,
  ARROW_KICK, type TaskRect,
} from "../ganttDependencyArrows";
import type { TaskDependency } from "../../../lib/localData/types";

function dep(id: string, predecessor_task_id: string, successor_task_id: string): TaskDependency {
  return { id, predecessor_task_id, successor_task_id, is_deleted: false };
}

describe("buildDependencyElbowPoints", () => {
  it("順方向（後続が先行の右に十分離れている）は4点の直角エルボーになる", () => {
    const points = buildDependencyElbowPoints({ x: 100, y: 20 }, { x: 200, y: 60 });
    expect(points).toHaveLength(4);
    expect(points[0]).toEqual({ x: 100, y: 20 });
    expect(points[1]).toEqual({ x: 100 + ARROW_KICK, y: 20 });
    expect(points[2]).toEqual({ x: 100 + ARROW_KICK, y: 60 });
    expect(points[3]).toEqual({ x: 200, y: 60 });
    // 最終区間は右向き（後続の左端へ入る）
    expect(points[3].x).toBeGreaterThan(points[2].x);
  });

  it("逆方向（後続が先行より前から始まる）は5点のS字迂回になる", () => {
    const points = buildDependencyElbowPoints({ x: 200, y: 20 }, { x: 100, y: 60 });
    expect(points).toHaveLength(5);
    // 最後の区間は必ず右向き（後続の左端へ入る）
    const last = points[points.length - 1];
    const secondLast = points[points.length - 2];
    expect(last.x).toBeGreaterThan(secondLast.x);
    expect(last).toEqual({ x: 100, y: 60 });
  });

  it("近接していて順方向のスペースが無い場合もS字迂回になる（矢印方向の逆転を防ぐ）", () => {
    const points = buildDependencyElbowPoints({ x: 100, y: 20 }, { x: 105, y: 60 });
    // kickX = 110 > succLeft.x(105) なので迂回ルート
    expect(points).toHaveLength(5);
  });
});

describe("pointsToPathD", () => {
  it("先頭がM、以降がLのpath文字列になる", () => {
    const d = pointsToPathD([{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }]);
    expect(d).toBe("M1,2 L3,4 L5,6");
  });
});

describe("computeDependencyRenders", () => {
  const rectA: TaskRect = { x: 0, y: 0, width: 40, height: 20 };
  const rectB: TaskRect = { x: 100, y: 60, width: 40, height: 20 };

  it("両端が実測できたペアは矢印になり、バッジは出ない", () => {
    const deps = [dep("d1", "a", "b")];
    const rectMap = new Map([["a", rectA], ["b", rectB]]);
    const result = computeDependencyRenders(deps, rectMap);
    expect(result.arrows).toHaveLength(1);
    expect(result.arrows[0].dep.id).toBe("d1");
    expect(result.badgesByTaskId.size).toBe(0);
  });

  it("先行だけ実測できた場合、先行側に『後続が画面外』バッジが立つ", () => {
    const deps = [dep("d1", "a", "b")];
    const rectMap = new Map([["a", rectA]]);
    const result = computeDependencyRenders(deps, rectMap);
    expect(result.arrows).toHaveLength(0);
    const badges = result.badgesByTaskId.get("a");
    expect(badges).toHaveLength(1);
    expect(badges?.[0]).toMatchObject({ taskId: "a", otherTaskId: "b", hiddenSide: "successor" });
  });

  it("後続だけ実測できた場合、後続側に『先行が画面外』バッジが立つ", () => {
    const deps = [dep("d1", "a", "b")];
    const rectMap = new Map([["b", rectB]]);
    const result = computeDependencyRenders(deps, rectMap);
    expect(result.arrows).toHaveLength(0);
    const badges = result.badgesByTaskId.get("b");
    expect(badges).toHaveLength(1);
    expect(badges?.[0]).toMatchObject({ taskId: "b", otherTaskId: "a", hiddenSide: "predecessor" });
  });

  it("両端とも実測できない依存は矢印もバッジも出さない", () => {
    const deps = [dep("d1", "a", "b")];
    const result = computeDependencyRenders(deps, new Map());
    expect(result.arrows).toHaveLength(0);
    expect(result.badgesByTaskId.size).toBe(0);
  });

  it("同じタスクに複数バッジが積み上がる", () => {
    const deps = [dep("d1", "a", "b"), dep("d2", "a", "c")];
    const rectMap = new Map([["a", rectA]]);
    const result = computeDependencyRenders(deps, rectMap);
    expect(result.badgesByTaskId.get("a")).toHaveLength(2);
  });
});
