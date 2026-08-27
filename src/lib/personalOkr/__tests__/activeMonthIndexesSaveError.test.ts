import { describe, expect, it } from "vitest";
import { isActiveMonthIndexesColumnMissing, ACTIVE_MONTH_INDEXES_MISSING_MESSAGE } from "../activeMonthIndexesSaveError";

describe("isActiveMonthIndexesColumnMissing", () => {
  it("PGRST204でactive_month_indexesを含むmessageを検出する", () => {
    const e = {
      code: "PGRST204",
      message: "Could not find the 'active_month_indexes' column of 'personal_krs' in the schema cache",
    };
    expect(isActiveMonthIndexesColumnMissing(e)).toBe(true);
  });

  it("detailsにだけ含まれる場合も検出する", () => {
    const e = { code: "PGRST204", message: "column not found", details: "active_month_indexes" };
    expect(isActiveMonthIndexesColumnMissing(e)).toBe(true);
  });

  it("hintにだけ含まれる場合も検出する", () => {
    const e = { code: "PGRST204", message: "column not found", hint: "active_month_indexes" };
    expect(isActiveMonthIndexesColumnMissing(e)).toBe(true);
  });

  it("🔴 PGRST204でも列名が無関係ならfalse（他のPGRST204と誤判定しない）", () => {
    const e = { code: "PGRST204", message: "Could not find the 'weight_override_pct' column of 'personal_kr_months' in the schema cache" };
    expect(isActiveMonthIndexesColumnMissing(e)).toBe(false);
  });

  it("PGRST204以外のコードはfalse", () => {
    const e = { code: "42703", message: "active_month_indexes" };
    expect(isActiveMonthIndexesColumnMissing(e)).toBe(false);
  });

  it("null・非オブジェクト・codeなしはfalse", () => {
    expect(isActiveMonthIndexesColumnMissing(null)).toBe(false);
    expect(isActiveMonthIndexesColumnMissing("error")).toBe(false);
    expect(isActiveMonthIndexesColumnMissing({ message: "no code" })).toBe(false);
  });

  it("Errorインスタンス（codeプロパティ付き）でも検出する", () => {
    const e = Object.assign(new Error("Could not find the 'active_month_indexes' column"), { code: "PGRST204" });
    expect(isActiveMonthIndexesColumnMissing(e)).toBe(true);
  });
});

describe("ACTIVE_MONTH_INDEXES_MISSING_MESSAGE", () => {
  it("管理者への連絡を案内する文言である", () => {
    expect(ACTIVE_MONTH_INDEXES_MISSING_MESSAGE).toContain("管理者");
  });
});
