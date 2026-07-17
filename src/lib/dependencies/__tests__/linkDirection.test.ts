// src/lib/dependencies/__tests__/linkDirection.test.ts

import { describe, it, expect } from "vitest";
import { resolveLinkDirection } from "../linkDirection";

describe("resolveLinkDirection", () => {
  it("due(先行候補)→start(後続候補)：明示ハンドル同士は素直にpredecessor/successorになる", () => {
    const result = resolveLinkDirection(
      { taskId: "A", side: "due" },
      { taskId: "B", side: "start" },
    );
    expect(result).toEqual({ predecessorTaskId: "A", successorTaskId: "B" });
  });

  it("start→due：向きが逆でもfinish側が先行に解決される", () => {
    const result = resolveLinkDirection(
      { taskId: "A", side: "start" },
      { taskId: "B", side: "due" },
    );
    expect(result).toEqual({ predecessorTaskId: "B", successorTaskId: "A" });
  });

  it("due同士はNG（曖昧な組み合わせ）", () => {
    const result = resolveLinkDirection(
      { taskId: "A", side: "due" },
      { taskId: "B", side: "due" },
    );
    expect(result).toBeNull();
  });

  it("start同士はNG（曖昧な組み合わせ）", () => {
    const result = resolveLinkDirection(
      { taskId: "A", side: "start" },
      { taskId: "B", side: "start" },
    );
    expect(result).toBeNull();
  });

  it("due→バー本体（side未確定）：ドラッグ元の逆側(start)を自動で補い解決する", () => {
    const result = resolveLinkDirection(
      { taskId: "A", side: "due" },
      { taskId: "B", side: null },
    );
    expect(result).toEqual({ predecessorTaskId: "A", successorTaskId: "B" });
  });

  it("start→バー本体（side未確定）：ドラッグ元の逆側(due)を自動で補い解決する", () => {
    const result = resolveLinkDirection(
      { taskId: "A", side: "start" },
      { taskId: "B", side: null },
    );
    expect(result).toEqual({ predecessorTaskId: "B", successorTaskId: "A" });
  });

  it("自分自身へのドロップはNG", () => {
    const result = resolveLinkDirection(
      { taskId: "A", side: "due" },
      { taskId: "A", side: "start" },
    );
    expect(result).toBeNull();
  });

  it("両端ともside未確定な組み合わせは解決不能でNG", () => {
    const result = resolveLinkDirection(
      { taskId: "A", side: null },
      { taskId: "B", side: null },
    );
    expect(result).toBeNull();
  });
});
