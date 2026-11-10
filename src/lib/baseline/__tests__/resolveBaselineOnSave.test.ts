import { describe, it, expect } from "vitest";
import { resolveBaselineOnSave } from "../baselineCapture";

const existing = {
  start_date: "2026-08-01", due_date: "2026-08-10",
  baseline_start_date: "2026-08-01", baseline_due_date: "2026-08-10",
};

describe("resolveBaselineOnSave（v3.207 期限前の延長は計画変更扱い）", () => {
  it("更新前の期日が今日より後なら、延長でベースラインを更新後の日付に揃える", () => {
    const r = resolveBaselineOnSave(existing, { start_date: "2026-08-03", due_date: "2026-08-15" }, "2026-08-05");
    expect(r.fields).toEqual({ baseline_start_date: "2026-08-03", baseline_due_date: "2026-08-15" });
    expect(r.record).toEqual({
      kind: "push",
      value: {
        prevStart: "2026-08-01", prevDue: "2026-08-10",
        prevBaseline: { baseline_start_date: "2026-08-01", baseline_due_date: "2026-08-10" },
        newBaseline: { baseline_start_date: "2026-08-03", baseline_due_date: "2026-08-15" },
      },
    });
  });

  it("境界：更新前の期日＝今日はまだ期限切れでない（引き直す）", () => {
    const r = resolveBaselineOnSave(existing, { start_date: "2026-08-01", due_date: "2026-08-12" }, "2026-08-10");
    expect(r.fields.baseline_due_date).toBe("2026-08-12");
  });

  it("境界：更新前の期日が昨日（期限切れ）なら据え置き", () => {
    const r = resolveBaselineOnSave(existing, { start_date: "2026-08-01", due_date: "2026-08-12" }, "2026-08-11");
    expect(r.fields).toEqual({ baseline_start_date: "2026-08-01", baseline_due_date: "2026-08-10" });
    expect(r.record.kind).toBe("none");
  });

  it("前倒し・期日が変わらない変更は据え置き", () => {
    expect(resolveBaselineOnSave(existing, { start_date: "2026-08-01", due_date: "2026-08-08" }, "2026-08-01").fields.baseline_due_date).toBe("2026-08-10");
    expect(resolveBaselineOnSave(existing, { start_date: "2026-08-05", due_date: "2026-08-10" }, "2026-08-01").fields.baseline_start_date).toBe("2026-08-01");
  });

  it("ベースライン未凍結は従来どおり（延長でも初回凍結の規則だけ）", () => {
    const r = resolveBaselineOnSave(
      { start_date: null, due_date: "2026-08-10", baseline_start_date: null, baseline_due_date: null },
      { start_date: null, due_date: "2026-08-20" }, "2026-08-01",
    );
    expect(r.fields).toEqual({ baseline_start_date: null, baseline_due_date: null });
    expect(r.record.kind).toBe("none");
  });

  it("開始日の無いタスクの延長は、ベースラインの開始日を残して期日だけ揃える", () => {
    const r = resolveBaselineOnSave({ ...existing, start_date: null }, { start_date: null, due_date: "2026-08-15" }, "2026-08-01");
    expect(r.fields).toEqual({ baseline_start_date: "2026-08-01", baseline_due_date: "2026-08-15" });
  });

  it("引き直した直後に日付が延長前へ戻されたら（Undo）、ベースラインも戻す", () => {
    const pushed = resolveBaselineOnSave(existing, { start_date: "2026-08-03", due_date: "2026-08-15" }, "2026-08-05");
    if (pushed.record.kind !== "push") throw new Error("push expected");
    const after = { start_date: "2026-08-03", due_date: "2026-08-15", ...pushed.fields };
    const undone = resolveBaselineOnSave(after, { start_date: "2026-08-01", due_date: "2026-08-10" }, "2026-08-05", pushed.record.value);
    expect(undone.fields).toEqual({ baseline_start_date: "2026-08-01", baseline_due_date: "2026-08-10" });
    expect(undone.record.kind).toBe("pop");
  });

  it("その後ベースラインが別に変わっていたら、記録が残っていても戻さない", () => {
    const pushed = resolveBaselineOnSave(existing, { start_date: "2026-08-03", due_date: "2026-08-15" }, "2026-08-05");
    if (pushed.record.kind !== "push") throw new Error("push expected");
    const other = { start_date: "2026-08-03", due_date: "2026-08-20", baseline_start_date: "2026-08-03", baseline_due_date: "2026-08-20" };
    const r = resolveBaselineOnSave(other, { start_date: "2026-08-01", due_date: "2026-08-10" }, "2026-08-05", pushed.record.value);
    expect(r.fields.baseline_due_date).toBe("2026-08-20");
    expect(r.record.kind).toBe("none");
  });
});
