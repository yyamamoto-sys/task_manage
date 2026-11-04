import { describe, it, expect } from "vitest";
import { findDependencyViolation } from "../violation";

const t = (start: string | null, due: string | null, status: "todo" | "done" = "todo", name = "A") =>
  ({ name, status, start_date: start, due_date: due });

describe("findDependencyViolation", () => {
  it("FS：先行の期日より前に後続が始まると矛盾（同日は可）", () => {
    const pred = t("2026-11-01", "2026-11-10");
    expect(findDependencyViolation({ dep_type: "FS", lag_days: 0 }, pred, t("2026-11-10", "2026-11-12", "todo", "B"))).toBeNull();
    const v = findDependencyViolation({ dep_type: "FS", lag_days: 0 }, pred, t("2026-11-08", "2026-11-12", "todo", "B"));
    expect(v?.shortfallDays).toBe(2);
    expect(v?.message).toBe("「A」の完了より前に開始しています（2日不足）");
  });
  it("FS＋ラグ・リード", () => {
    const pred = t("2026-11-01", "2026-11-10");
    expect(findDependencyViolation({ dep_type: "FS", lag_days: 2 }, pred, t("2026-11-11", "2026-11-15"))?.message)
      .toBe("「A」の完了＋2日より前に開始しています（1日不足）");
    expect(findDependencyViolation({ dep_type: "FS", lag_days: -3 }, pred, t("2026-11-07", "2026-11-15"))).toBeNull();
  });
  it("SS・FF・SF", () => {
    const pred = t("2026-11-05", "2026-11-10");
    expect(findDependencyViolation({ dep_type: "SS", lag_days: 0 }, pred, t("2026-11-04", "2026-11-20"))?.message)
      .toBe("「A」の開始より前に開始しています（1日不足）");
    expect(findDependencyViolation({ dep_type: "FF", lag_days: 0 }, pred, t("2026-11-01", "2026-11-09"))?.message)
      .toBe("「A」の完了より前に完了しています（1日不足）");
    expect(findDependencyViolation({ dep_type: "SF", lag_days: 1 }, pred, t("2026-11-01", "2026-11-05"))?.message)
      .toBe("「A」の開始＋1日より前に完了しています（1日不足）");
  });
  it("日付欠け・後続が完了/中止・未設定の種類は FS として扱う", () => {
    const pred = t("2026-11-01", "2026-11-10");
    expect(findDependencyViolation({}, pred, t(null, "2026-11-12"))).toBeNull();
    expect(findDependencyViolation({}, t(null, null), t("2026-11-01", "2026-11-12"))).toBeNull();
    expect(findDependencyViolation({}, pred, t("2026-11-01", "2026-11-12", "done"))).toBeNull();
    expect(findDependencyViolation({}, pred, t("2026-11-01", "2026-11-12"))?.shortfallDays).toBe(9);
  });
});
