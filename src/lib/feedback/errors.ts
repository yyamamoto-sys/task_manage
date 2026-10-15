// src/lib/feedback/errors.ts
//
// ご意見の表・RPC が DB に無い（マイグレーション 20261015b が未適用）ときの判定（v3.157）。
// 管理ページは「適用がまだです」を出し（Section 24 Step Q の W2 と同じ方式）、送信側は原因が分かるエラーにする。

interface ErrorLike { code?: unknown; message?: unknown; details?: unknown }

const NOT_FOUND_CODES = ["42P01", "PGRST205", "PGRST202", "42883"];

/**
 * 表（app_feedback）・RPC（submit_feedback 等）が見つからないエラーか。
 * 42P01：表が無い／PGRST205：スキーマキャッシュに表が無い／PGRST202・42883：関数が見つからない。
 * どれもメッセージに対象の名前（…feedback…）が入る。他の表・関数の欠落を誤って「適用がまだ」と言わないよう、名前も見る。
 */
export function isFeedbackNotAppliedError(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const { code, message, details } = e as ErrorLike;
  if (typeof code !== "string" || !NOT_FOUND_CODES.includes(code)) return false;
  const text = `${typeof message === "string" ? message : ""} ${typeof details === "string" ? details : ""}`;
  return /feedback/i.test(text);
}
