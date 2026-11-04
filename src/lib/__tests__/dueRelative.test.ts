import { describe, it, expect } from "vitest";
import { formatDueRelative, formatFullDateWithWeekday } from "../dueRelative";

const T = "2026-11-04";
describe("formatDueRelative", () => {
  it("超過・今日・明日・あとN日・それ以外", () => {
    expect(formatDueRelative("2026-11-01", "todo", T)).toEqual({ label: "3日超過", tone: "overdue" });
    expect(formatDueRelative("2026-11-04", "in_progress", T)).toEqual({ label: "今日", tone: "today" });
    expect(formatDueRelative("2026-11-05", "todo", T)).toEqual({ label: "明日", tone: "normal" });
    expect(formatDueRelative("2026-11-06", "todo", T)).toEqual({ label: "あと2日", tone: "normal" });
    expect(formatDueRelative("2026-11-10", "todo", T)).toEqual({ label: "あと6日", tone: "normal" });
    expect(formatDueRelative("2026-11-11", "todo", T)).toEqual({ label: "11/11", tone: "normal" });
  });
  it("月またぎ・年またぎ", () => {
    expect(formatDueRelative("2026-12-31", "todo", "2026-12-29").label).toBe("あと2日");
    expect(formatDueRelative("2027-01-01", "todo", "2026-12-31").label).toBe("明日");
  });
  it("完了・中止は相対表示せず灰色", () => {
    expect(formatDueRelative("2026-11-01", "done", T)).toEqual({ label: "11/01", tone: "muted" });
    expect(formatDueRelative("2026-11-04", "cancelled", T)).toEqual({ label: "11/04", tone: "muted" });
  });
  it("保留は相対表示するが赤くしない", () => {
    expect(formatDueRelative("2026-11-01", "on_hold", T).tone).toBe("normal");
  });
});
describe("formatFullDateWithWeekday", () => {
  it("YYYY/MM/DD(曜)", () => {
    expect(formatFullDateWithWeekday("2026-11-04")).toBe("2026/11/04(水)");
  });
});
