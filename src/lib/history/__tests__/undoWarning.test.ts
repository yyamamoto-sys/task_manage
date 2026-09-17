import { describe, it, expect } from "vitest";
import { hasLaterConflictingChange } from "../undoWarning";
import type { EntityChangeLog } from "../../localData/types";

function mkLog(partial: Partial<EntityChangeLog> & { changed_at: string }): Pick<EntityChangeLog, "changed_at" | "diff"> {
  return {
    changed_at: partial.changed_at,
    diff: partial.diff ?? {},
  };
}

describe("hasLaterConflictingChange", () => {
  it("その後に同じ項目が変更されていれば true を返す", () => {
    const target = mkLog({ changed_at: "2026-09-01T00:00:00Z", diff: { name: { before: "A", after: "B" } } });
    const later = [
      mkLog({ changed_at: "2026-09-02T00:00:00Z", diff: { name: { before: "B", after: "C" } } }),
    ];
    expect(hasLaterConflictingChange(target, later)).toBe(true);
  });

  it("その後に何も変更されていなければ false を返す", () => {
    const target = mkLog({ changed_at: "2026-09-01T00:00:00Z", diff: { name: { before: "A", after: "B" } } });
    expect(hasLaterConflictingChange(target, [])).toBe(false);
  });

  it("その後に別の項目だけが変更されていれば false を返す", () => {
    const target = mkLog({ changed_at: "2026-09-01T00:00:00Z", diff: { name: { before: "A", after: "B" } } });
    const later = [
      mkLog({ changed_at: "2026-09-02T00:00:00Z", diff: { status: { before: "todo", after: "done" } } }),
    ];
    expect(hasLaterConflictingChange(target, later)).toBe(false);
  });

  it("target自身より前の変更は無視する", () => {
    const target = mkLog({ changed_at: "2026-09-02T00:00:00Z", diff: { name: { before: "A", after: "B" } } });
    const earlier = [
      mkLog({ changed_at: "2026-09-01T00:00:00Z", diff: { name: { before: "X", after: "A" } } }),
    ];
    expect(hasLaterConflictingChange(target, earlier)).toBe(false);
  });

  it("diffが空（create等）なら常に false を返す", () => {
    const target = mkLog({ changed_at: "2026-09-01T00:00:00Z", diff: {} });
    const later = [
      mkLog({ changed_at: "2026-09-02T00:00:00Z", diff: { name: { before: "A", after: "B" } } }),
    ];
    expect(hasLaterConflictingChange(target, later)).toBe(false);
  });

  it("複数フィールドのうち1つでも一致すれば true を返す", () => {
    const target = mkLog({
      changed_at: "2026-09-01T00:00:00Z",
      diff: { name: { before: "A", after: "B" }, status: { before: "todo", after: "in_progress" } },
    });
    const later = [
      mkLog({ changed_at: "2026-09-02T00:00:00Z", diff: { status: { before: "in_progress", after: "done" } } }),
    ];
    expect(hasLaterConflictingChange(target, later)).toBe(true);
  });
});
