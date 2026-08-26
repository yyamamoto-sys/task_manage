// src/lib/personalOkr/periodReviewSaveError.ts
//
// 【設計意図】
// 「全体」タブ（v3.101）の保存が部分ユニークインデックス
// （idx_personal_period_reviews_month_unique／idx_personal_period_reviews_quarter_unique。
// migrations/20260826_add_personal_period_reviews.sql）に衝突したとき（Postgres 23505）、
// 生のPostgrestエラーをそのまま見せるのではなく「画面を再読み込みしてから保存し直す」という
// 正しい手順を案内する。AdminView.tsxのisMemberEmailUniqueViolationと同じ考え方
// （統括のレビュー・2026-08-26で指摘）。
//
// 【起きうる原因】periodReviewsのロード完了前に保存操作を行った・複数タブや別端末で
// 同じ月/四半期の行を同時に新規作成した等で、クライアント側stateが既存行のidを
// 掴めておらず、PersonalPeriodReviewBlock.tsxが新しいuuidでINSERTしてしまう場合。
// 部分ユニークインデックスは「同じ人・同じ月（または同じ人・同じ年度・四半期）に
// 2件目が作られること」を意図どおり検出しているため、エラー自体は正しい。

export function isPeriodReviewUniqueViolation(e: unknown): boolean {
  if (e == null || typeof e !== "object") return false;
  const obj = e as Record<string, unknown>;
  if (obj.code !== "23505") return false;
  const text = [obj.message, obj.details, obj.hint]
    .filter((v): v is string => typeof v === "string")
    .join(" ");
  return text.includes("idx_personal_period_reviews_month_unique")
    || text.includes("idx_personal_period_reviews_quarter_unique");
}

export const PERIOD_REVIEW_DUPLICATE_MESSAGE =
  "この期間の全体の振り返りは、既に他の操作（別のタブ・別の端末等）で作成されています。画面を再読み込みしてから、あらためて保存してください。";
