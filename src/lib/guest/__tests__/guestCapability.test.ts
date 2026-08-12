import { describe, it, expect } from "vitest";
import { canGuestEdit, type GuestEditTarget } from "../guestCapability";

const ALL_TARGETS: GuestEditTarget[] = ["task", "kanban", "gantt", "project", "milestone", "aiApply", "adminSettings"];

describe("canGuestEdit", () => {
  it("非ゲストは常にtrue（対象を問わない）", () => {
    for (const target of ALL_TARGETS) {
      expect(canGuestEdit(false, target)).toBe(true);
    }
  });

  it("ゲストは日常編集の6種類がtrue", () => {
    expect(canGuestEdit(true, "task")).toBe(true);
    expect(canGuestEdit(true, "kanban")).toBe(true);
    expect(canGuestEdit(true, "gantt")).toBe(true);
    expect(canGuestEdit(true, "project")).toBe(true);
    expect(canGuestEdit(true, "milestone")).toBe(true);
    expect(canGuestEdit(true, "aiApply")).toBe(true);
  });

  it("ゲストは設定画面（adminSettings）が常にfalse", () => {
    expect(canGuestEdit(true, "adminSettings")).toBe(false);
  });
});
