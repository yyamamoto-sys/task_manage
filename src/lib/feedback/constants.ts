// src/lib/feedback/constants.ts
//
// アプリ内フィードバック（v3.157・CLAUDE.md Section 82）の定数。DB（20261015b_app_feedback.sql）に直書きした
// 上限・状態の一覧と食い違わないよう、src/lib/feedback/__tests__/feedbackMigration.test.ts が SQL の文面と照合する。

export type FeedbackKind = "request" | "bug" | "other" | "unspecified";
/** 画面で選べる種類（未選択のときは unspecified で保存する） */
export const FEEDBACK_PICKABLE_KINDS: readonly Exclude<FeedbackKind, "unspecified">[] = ["request", "bug", "other"];
export const FEEDBACK_ALL_KINDS: readonly FeedbackKind[] = ["request", "bug", "other", "unspecified"];

export type FeedbackStatus = "new" | "in_progress" | "done" | "wontfix";
export const FEEDBACK_STATUSES: readonly FeedbackStatus[] = ["new", "in_progress", "done", "wontfix"];
/** 管理ページの既定の絞り込み（新規＋対応中） */
export const FEEDBACK_OPEN_STATUSES: readonly FeedbackStatus[] = ["new", "in_progress"];

/** snapshot_state：attached＝付けて送った／off＝本人がオフにした／too_large＝16KB超／purged＝90日で消した */
export type FeedbackSnapshotState = "attached" | "off" | "too_large" | "purged";

/** 画面のコメント上限（DB は2000字まで） */
export const FEEDBACK_COMMENT_MAX = 1000;
export const FEEDBACK_COMMENT_DB_MAX = 2000;
export const FEEDBACK_ADMIN_MEMO_MAX = 2000;

export const FEEDBACK_SNAPSHOT_VERSION = 1;
export const FEEDBACK_SNAPSHOT_MAX_BYTES = 16 * 1024;
/** 直近のクリックを何件残すか */
export const FEEDBACK_CLICK_HISTORY_MAX = 5;

/** 頻度上限（DB の submit_feedback と同じ値。同一本文の1分以内の再送は黙って1件にまとめる） */
export const FEEDBACK_LIMIT_PER_HOUR = 3;
export const FEEDBACK_LIMIT_PER_DAY = 10;
export const FEEDBACK_DUPLICATE_WINDOW_MS = 60 * 1000;

/** 設定の「アプリの管理」ページ・ベル通知のクリック先 */
export const FEEDBACK_OPEN_TARGET = "admin-feedback";

/** 管理ページの一覧の取得件数（新しい順） */
export const FEEDBACK_ADMIN_LIST_LIMIT = 200;
/** 「選んだN件をコピー」の上限（スナップショットの取得量を抑える） */
export const FEEDBACK_COPY_LIMIT = 50;

export function isFeedbackKind(v: unknown): v is FeedbackKind {
  return typeof v === "string" && (FEEDBACK_ALL_KINDS as readonly string[]).includes(v);
}
export function isFeedbackStatus(v: unknown): v is FeedbackStatus {
  return typeof v === "string" && (FEEDBACK_STATUSES as readonly string[]).includes(v);
}
