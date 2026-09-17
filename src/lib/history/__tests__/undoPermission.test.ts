import { describe, it, expect } from "vitest";
import { canUndoEntityChangeLog } from "../undoPermission";

describe("canUndoEntityChangeLog", () => {
  it("管理者(is_admin)は他人の変更もUndoできる", () => {
    expect(canUndoEntityChangeLog(
      { changed_by: "member-b" },
      { id: "member-a", is_admin: true, is_super_admin: false },
    )).toBe(true);
  });

  it("全社スーパー管理者は他人の変更もUndoできる", () => {
    expect(canUndoEntityChangeLog(
      { changed_by: "member-b" },
      { id: "member-a", is_admin: false, is_super_admin: true },
    )).toBe(true);
  });

  it("一般メンバーは自分の変更のみUndoできる", () => {
    expect(canUndoEntityChangeLog(
      { changed_by: "member-a" },
      { id: "member-a", is_admin: false, is_super_admin: false },
    )).toBe(true);
  });

  it("一般メンバーは他人の変更をUndoできない", () => {
    expect(canUndoEntityChangeLog(
      { changed_by: "member-b" },
      { id: "member-a", is_admin: false, is_super_admin: false },
    )).toBe(false);
  });
});
