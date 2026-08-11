import { describe, it, expect } from "vitest";
import { computeOutlookInputFingerprint, resolveMonthPlanTimestamp, type OutlookFingerprintInput } from "../outlookFingerprint";

function baseInput(overrides: Partial<OutlookFingerprintInput> = {}): OutlookFingerprintInput {
  return {
    maxLinkedTaskUpdatedAt: "2026-08-06T10:00:00.000Z",
    weeks: [
      { weekIndex: 1, goalState: "検証ログの形式が決まっている", selfRating: "o" },
      { weekIndex: 2, goalState: "判定基準の合意が取れている", selfRating: "t" },
    ],
    monthPlanTimestamp: "2026-08-01T00:00:00.000Z",
    lastMemoUpdatedAt: "2026-08-06T18:42:00.000Z",
    currentWeekNumber: 2,
    ...overrides,
  };
}

describe("computeOutlookInputFingerprint", () => {
  it("同じ入力なら常に同じ値を返す（決定性）", () => {
    const input = baseInput();
    expect(computeOutlookInputFingerprint(input)).toBe(computeOutlookInputFingerprint(baseInput()));
  });

  it("週の配列の順序を変えても同じ値になる", () => {
    const input1 = baseInput();
    const input2 = baseInput({ weeks: [...input1.weeks].reverse() });
    expect(computeOutlookInputFingerprint(input1)).toBe(computeOutlookInputFingerprint(input2));
  });

  it("紐づくタスクのupdated_atが変わると値が変わる", () => {
    const a = computeOutlookInputFingerprint(baseInput());
    const b = computeOutlookInputFingerprint(baseInput({ maxLinkedTaskUpdatedAt: "2026-08-07T10:00:00.000Z" }));
    expect(a).not.toBe(b);
  });

  it("紐づくタスクが無い(null)場合とある場合で値が異なる", () => {
    const a = computeOutlookInputFingerprint(baseInput({ maxLinkedTaskUpdatedAt: null }));
    const b = computeOutlookInputFingerprint(baseInput());
    expect(a).not.toBe(b);
  });

  it("週の自己評価が変わると値が変わる", () => {
    const input = baseInput();
    const changed = baseInput({
      weeks: input.weeks.map(w => (w.weekIndex === 2 ? { ...w, selfRating: "x" as const } : w)),
    });
    expect(computeOutlookInputFingerprint(input)).not.toBe(computeOutlookInputFingerprint(changed));
  });

  it("週の目標状態(goal_state)が変わると値が変わる", () => {
    const input = baseInput();
    const changed = baseInput({
      weeks: input.weeks.map(w => (w.weekIndex === 1 ? { ...w, goalState: "別の目標" } : w)),
    });
    expect(computeOutlookInputFingerprint(input)).not.toBe(computeOutlookInputFingerprint(changed));
  });

  it("週が増減すると値が変わる", () => {
    const input = baseInput();
    const changed = baseInput({ weeks: [...input.weeks, { weekIndex: 3, goalState: null, selfRating: null }] });
    expect(computeOutlookInputFingerprint(input)).not.toBe(computeOutlookInputFingerprint(changed));
  });

  it("月次計画のタイムスタンプが変わると値が変わる", () => {
    const a = computeOutlookInputFingerprint(baseInput());
    const b = computeOutlookInputFingerprint(baseInput({ monthPlanTimestamp: "2026-08-02T00:00:00.000Z" }));
    expect(a).not.toBe(b);
  });

  it("メモの最終updated_atが変わると値が変わる", () => {
    const a = computeOutlookInputFingerprint(baseInput());
    const b = computeOutlookInputFingerprint(baseInput({ lastMemoUpdatedAt: "2026-08-07T09:00:00.000Z" }));
    expect(a).not.toBe(b);
  });

  it("現在の週番号が変わると値が変わる", () => {
    const a = computeOutlookInputFingerprint(baseInput());
    const b = computeOutlookInputFingerprint(baseInput({ currentWeekNumber: 3 }));
    expect(a).not.toBe(b);
  });

  it("全て未設定(null/空配列)でも例外を投げず安定した値を返す", () => {
    const input: OutlookFingerprintInput = {
      maxLinkedTaskUpdatedAt: null, weeks: [], monthPlanTimestamp: null, lastMemoUpdatedAt: null, currentWeekNumber: 1,
    };
    const a = computeOutlookInputFingerprint(input);
    const b = computeOutlookInputFingerprint({ ...input });
    expect(a).toBe(b);
    expect(typeof a).toBe("string");
    expect(a.length).toBeGreaterThan(0);
  });
});

describe("resolveMonthPlanTimestamp", () => {
  it("imported_atがあればそれを優先する", () => {
    expect(resolveMonthPlanTimestamp("2026-08-01T00:00:00.000Z", "2026-08-05T00:00:00.000Z")).toBe("2026-08-01T00:00:00.000Z");
  });

  it("imported_atが無ければupdated_atを使う", () => {
    expect(resolveMonthPlanTimestamp(null, "2026-08-05T00:00:00.000Z")).toBe("2026-08-05T00:00:00.000Z");
    expect(resolveMonthPlanTimestamp(undefined, "2026-08-05T00:00:00.000Z")).toBe("2026-08-05T00:00:00.000Z");
  });

  it("どちらも無ければnull", () => {
    expect(resolveMonthPlanTimestamp(null, null)).toBeNull();
    expect(resolveMonthPlanTimestamp(undefined, undefined)).toBeNull();
  });
});
