// src/lib/personalOkr/actualActivitiesSaveError.ts
//
// 【設計意図】
// 「実施記録」欄（山本さんの依頼・2026-08-27・v3.105）の保存が、
// actual_activities列（migrations/20260827_add_actual_activities.sql）未適用の窓で
// PGRST204（"Could not find the 'actual_activities' column of '...' in the schema cache"）を
// 返したとき、生のPostgrestエラーではなく「データベースへの適用がまだ済んでいません」という
// 行動が分かる案内を出す。activeMonthIndexesSaveError.ts（v3.104）と同型の作り。
//
// 🔴 personal_kr_months・personal_period_reviews の両方でこの列名を使うため、テーブル名を
// 問わず「actual_activities」という列名の言及だけで判定する（1つの検出関数を両方で使う）。
// 🔴 列名まで見て他のPGRST204と誤判定しないこと（他の未適用マイグレーションによる
// PGRST204まで「この機能が未適用」と誤案内すると、原因究明を妨げる）。

export function isActualActivitiesColumnMissing(e: unknown): boolean {
  if (e == null || typeof e !== "object") return false;
  const obj = e as Record<string, unknown>;
  if (obj.code !== "PGRST204") return false;
  const text = [obj.message, obj.details, obj.hint]
    .filter((v): v is string => typeof v === "string")
    .join(" ");
  return text.includes("actual_activities");
}

export const ACTUAL_ACTIVITIES_MISSING_MESSAGE =
  "この機能はデータベースへの適用がまだです（管理者に連絡してください）。";
