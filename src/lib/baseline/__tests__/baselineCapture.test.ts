import { describe, it, expect } from "vitest";
import { resolveBaselineFields } from "../baselineCapture";

describe("resolveBaselineFields", () => {
  it("両日付が初めて揃った時だけ捕捉する", () => {
    const result = resolveBaselineFields(
      { baseline_start_date: null, baseline_due_date: null },
      { start_date: "2026-08-01", due_date: "2026-08-10" },
    );
    expect(result).toEqual({ baseline_start_date: "2026-08-01", baseline_due_date: "2026-08-10" });
  });

  it("existingがundefined（新規タスク）でも両日付が揃えば捕捉する", () => {
    const result = resolveBaselineFields(
      undefined,
      { start_date: "2026-08-01", due_date: "2026-08-10" },
    );
    expect(result).toEqual({ baseline_start_date: "2026-08-01", baseline_due_date: "2026-08-10" });
  });

  it("片方しか無ければ捕捉しない（開始日のみ）", () => {
    const result = resolveBaselineFields(
      { baseline_start_date: null, baseline_due_date: null },
      { start_date: "2026-08-01", due_date: null },
    );
    expect(result).toEqual({ baseline_start_date: null, baseline_due_date: null });
  });

  it("片方しか無ければ捕捉しない（期日のみ）", () => {
    const result = resolveBaselineFields(
      { baseline_start_date: null, baseline_due_date: null },
      { start_date: null, due_date: "2026-08-10" },
    );
    expect(result).toEqual({ baseline_start_date: null, baseline_due_date: null });
  });

  it("両方とも無ければ捕捉しない", () => {
    const result = resolveBaselineFields(
      { baseline_start_date: null, baseline_due_date: null },
      { start_date: null, due_date: null },
    );
    expect(result).toEqual({ baseline_start_date: null, baseline_due_date: null });
  });

  it("set済みは、候補の日付が変わっても上書きしない", () => {
    const result = resolveBaselineFields(
      { baseline_start_date: "2026-08-01", baseline_due_date: "2026-08-10" },
      { start_date: "2026-09-01", due_date: "2026-09-15" },
    );
    expect(result).toEqual({ baseline_start_date: "2026-08-01", baseline_due_date: "2026-08-10" });
  });

  it("set済みで日付が両方クリアされても凍結値が残る（リセットされない）", () => {
    const result = resolveBaselineFields(
      { baseline_start_date: "2026-08-01", baseline_due_date: "2026-08-10" },
      { start_date: null, due_date: null },
    );
    expect(result).toEqual({ baseline_start_date: "2026-08-01", baseline_due_date: "2026-08-10" });
  });

  it("未凍結の状態で片方だけクリアしても捕捉されない（もう片方が揃っていても片方が欠けたまま）", () => {
    // 開始日だけ設定→期日クリア、という操作を経ても、両方揃っていない限り捕捉されない
    const result = resolveBaselineFields(
      { baseline_start_date: null, baseline_due_date: null },
      { start_date: "2026-08-01", due_date: null },
    );
    expect(result).toEqual({ baseline_start_date: null, baseline_due_date: null });
  });
});
