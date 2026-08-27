// src/lib/personalOkr/activeMonthIndexesSaveError.ts
//
// 【設計意図】
// KR編集モーダル（PersonalKrFormModal.tsx）の保存ペイロードに personal_krs.active_month_indexes
// を含めた状態で、そのマイグレーション（20260826b_add_personal_krs_active_month_indexes.sql）が
// 未適用だと、PostgRESTが PGRST204（"Could not find the 'active_month_indexes' column of
// 'personal_krs' in the schema cache"）を返し、KRの保存が全て失敗する。
// 2026-08-12にupsertTaskがTaskの全列を送って本番の保存が全滅した事故と同型
// （feedback_migration_deploy_ordering）。生のPostgrestエラーではなく、
// 「データベースへの適用がまだ済んでいません（管理者に連絡してください）」という
// 行動が分かる案内を出す。periodReviewSaveError.ts（v3.102）と同型の作り。
//
// 🔴 列名まで見て他のPGRST204と誤判定しないこと（他の未適用マイグレーションによる
// PGRST204まで「この機能が未適用」と誤案内すると、原因究明を妨げる）。

export function isActiveMonthIndexesColumnMissing(e: unknown): boolean {
  if (e == null || typeof e !== "object") return false;
  const obj = e as Record<string, unknown>;
  if (obj.code !== "PGRST204") return false;
  const text = [obj.message, obj.details, obj.hint]
    .filter((v): v is string => typeof v === "string")
    .join(" ");
  return text.includes("active_month_indexes");
}

export const ACTIVE_MONTH_INDEXES_MISSING_MESSAGE =
  "データベースへの適用がまだ済んでいません（管理者に連絡してください）。";
