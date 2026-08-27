import { describe, it, expect } from "vitest";
import { isActualActivitiesColumnMissing } from "../actualActivitiesSaveError";

describe("isActualActivitiesColumnMissing", () => {
  it("PGRST204でactual_activitiesを含むmessageを検出する（personal_kr_months）", () => {
    const e = {
      code: "PGRST204",
      message: "Could not find the 'actual_activities' column of 'personal_kr_months' in the schema cache",
    };
    expect(isActualActivitiesColumnMissing(e)).toBe(true);
  });

  it("PGRST204でactual_activitiesを含むmessageを検出する（personal_period_reviews）", () => {
    const e = {
      code: "PGRST204",
      message: "Could not find the 'actual_activities' column of 'personal_period_reviews' in the schema cache",
    };
    expect(isActualActivitiesColumnMissing(e)).toBe(true);
  });

  it("details/hintにactual_activitiesがあっても検出する", () => {
    expect(isActualActivitiesColumnMissing({ code: "PGRST204", message: "column not found", details: "actual_activities" })).toBe(true);
    expect(isActualActivitiesColumnMissing({ code: "PGRST204", message: "column not found", hint: "actual_activities" })).toBe(true);
  });

  it("🔴 PGRST204でも列名が無関係ならfalse（他のPGRST204と誤判定しない）", () => {
    const e = { code: "PGRST204", message: "Could not find the 'weight_override_pct' column of 'personal_kr_months' in the schema cache" };
    expect(isActualActivitiesColumnMissing(e)).toBe(false);
  });

  it("PGRST204以外のコードはfalse", () => {
    expect(isActualActivitiesColumnMissing({ code: "23505", message: "actual_activities duplicate" })).toBe(false);
  });

  it("null/undefined/非オブジェクトはfalse", () => {
    expect(isActualActivitiesColumnMissing(null)).toBe(false);
    expect(isActualActivitiesColumnMissing(undefined)).toBe(false);
    expect(isActualActivitiesColumnMissing("error")).toBe(false);
  });

  it("Errorインスタンス（code付き）でも検出する", () => {
    const e = Object.assign(new Error("Could not find the 'actual_activities' column"), { code: "PGRST204" });
    expect(isActualActivitiesColumnMissing(e)).toBe(true);
  });
});
