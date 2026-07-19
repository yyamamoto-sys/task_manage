import { describe, it, expect } from "vitest";
import { isOverWipLimit, WIP_LIMIT_DEFAULT } from "../kanbanWip";

describe("isOverWipLimit", () => {
  it("既定上限(4)ちょうどは超過ではない", () => {
    expect(isOverWipLimit(WIP_LIMIT_DEFAULT)).toBe(false);
  });

  it("既定上限を1件でも超えると超過", () => {
    expect(isOverWipLimit(WIP_LIMIT_DEFAULT + 1)).toBe(true);
  });

  it("上限未満は超過ではない", () => {
    expect(isOverWipLimit(0)).toBe(false);
    expect(isOverWipLimit(WIP_LIMIT_DEFAULT - 1)).toBe(false);
  });

  it("カスタム上限を指定できる", () => {
    expect(isOverWipLimit(3, 2)).toBe(true);
    expect(isOverWipLimit(2, 2)).toBe(false);
  });
});
