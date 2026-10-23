// src/lib/personalOkr/periodReviewsLoadError.ts
//
// 【設計意図・M61】
// 「全体」タブの personal_period_reviews 取得エラーは、種類を問わず「データベースへの適用がまだです」と
// 表示されていた。ネットワーク断・権限エラーでも同じ文言になり、再読み込みの手段も無かった。
// 未適用（テーブル・列が無い）だけを従来の案内にし、それ以外は原因が見える文言＋再読み込みにする。

export type PeriodReviewsErrorKind = "not_applied" | "other";

const MISSING_CODES = new Set(["42P01", "42703", "PGRST205", "PGRST204"]);

export function classifyPeriodReviewsLoadError(e: unknown): PeriodReviewsErrorKind {
  if (e == null || typeof e !== "object") return "other";
  const obj = e as Record<string, unknown>;
  if (typeof obj.code !== "string" || !MISSING_CODES.has(obj.code)) return "other";
  const text = [obj.message, obj.details, obj.hint]
    .filter((v): v is string => typeof v === "string")
    .join(" ");
  return text.includes("personal_period_reviews") ? "not_applied" : "other";
}
