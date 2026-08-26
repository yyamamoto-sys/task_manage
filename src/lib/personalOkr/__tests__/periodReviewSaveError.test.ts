import { describe, expect, it } from "vitest";
import { isPeriodReviewUniqueViolation, PERIOD_REVIEW_DUPLICATE_MESSAGE } from "../periodReviewSaveError";

describe("isPeriodReviewUniqueViolation", () => {
  it("月ブロックの部分ユニークインデックス違反を検出する", () => {
    const e = {
      code: "23505",
      message: 'duplicate key value violates unique constraint "idx_personal_period_reviews_month_unique"',
      details: "Key (member_id, month)=(m1, 2026-08-01) already exists.",
    };
    expect(isPeriodReviewUniqueViolation(e)).toBe(true);
  });

  it("四半期ブロックの部分ユニークインデックス違反を検出する", () => {
    const e = {
      code: "23505",
      message: 'duplicate key value violates unique constraint "idx_personal_period_reviews_quarter_unique"',
    };
    expect(isPeriodReviewUniqueViolation(e)).toBe(true);
  });

  it("hintにだけ含まれる場合も検出する", () => {
    const e = { code: "23505", message: "conflict", hint: "idx_personal_period_reviews_month_unique" };
    expect(isPeriodReviewUniqueViolation(e)).toBe(true);
  });

  it("23505以外のコードはfalse", () => {
    const e = { code: "42703", message: "idx_personal_period_reviews_month_unique" };
    expect(isPeriodReviewUniqueViolation(e)).toBe(false);
  });

  it("23505でも無関係な制約名はfalse（他テーブルの一意制約違反と誤判定しない）", () => {
    const e = { code: "23505", message: 'duplicate key value violates unique constraint "members_email_unique"' };
    expect(isPeriodReviewUniqueViolation(e)).toBe(false);
  });

  it("null・非オブジェクト・codeなしはfalse", () => {
    expect(isPeriodReviewUniqueViolation(null)).toBe(false);
    expect(isPeriodReviewUniqueViolation("error")).toBe(false);
    expect(isPeriodReviewUniqueViolation({ message: "no code" })).toBe(false);
  });

  it("Errorインスタンス（code/detailsプロパティ付き）でも検出する", () => {
    const e = Object.assign(new Error('duplicate key value violates unique constraint "idx_personal_period_reviews_month_unique"'), { code: "23505" });
    expect(isPeriodReviewUniqueViolation(e)).toBe(true);
  });
});

describe("PERIOD_REVIEW_DUPLICATE_MESSAGE", () => {
  it("再読み込みしてからの再保存を案内する文言である", () => {
    expect(PERIOD_REVIEW_DUPLICATE_MESSAGE).toContain("再読み込み");
  });
});
