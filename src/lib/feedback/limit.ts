// src/lib/feedback/limit.ts
//
// ご意見の頻度上限（v3.157・CLAUDE.md Section 82）。実際の判定と加算は DB の submit_feedback（アドバイザリロック付き）が行う。
// ここは ①その判定の手順を1対1で写した参照実装（テストで境界値を固定する。SQL を変えたらここも見直す）
// ②RPC の戻り値を利用者向けの文言キーに直す対応表、の2つだけ。本番の判定経路ではない
// （guestQuota.ts の simulateConsumeGuestAiQuota と同じ位置づけ）。

import {
  FEEDBACK_DUPLICATE_WINDOW_MS, FEEDBACK_LIMIT_PER_DAY, FEEDBACK_LIMIT_PER_HOUR,
} from "./constants";

export type FeedbackSubmitResult = "ok" | "throttled" | "limited_hour" | "limited_day";

export interface FeedbackSendRecord {
  /** 送った時刻（ms） */
  at: number;
  /** 保存された本文（伏せ字後） */
  comment: string;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * submit_feedback の判定の写し：
 *  1. 同一本文が1分以内にある → throttled（黙って1件にまとめる。成功として扱う）
 *  2. 直近1時間が3件以上 → limited_hour
 *  3. 直近24時間が10件以上 → limited_day
 *  4. それ以外 → ok
 * 「以内」「以上」の境界は SQL（created_at > now() - interval）と同じ：ちょうど1分前・1時間前・24時間前の送信は数えない。
 */
export function judgeFeedbackSend(prior: readonly FeedbackSendRecord[], comment: string, now: number): FeedbackSubmitResult {
  if (prior.some((r) => now - r.at < FEEDBACK_DUPLICATE_WINDOW_MS && r.comment === comment)) return "throttled";
  const hour = prior.filter((r) => now - r.at < HOUR_MS).length;
  const day = prior.filter((r) => now - r.at < DAY_MS).length;
  if (hour >= FEEDBACK_LIMIT_PER_HOUR) return "limited_hour";
  if (day >= FEEDBACK_LIMIT_PER_DAY) return "limited_day";
  return "ok";
}

/** 成功として扱う戻り値（throttled は二重送信のまとめなので利用者には成功に見せる） */
export function isFeedbackAccepted(result: FeedbackSubmitResult): boolean {
  return result === "ok" || result === "throttled";
}

/** 失敗の戻り値 → i18n キー（成功は null） */
export function feedbackResultMessageKey(result: FeedbackSubmitResult): string | null {
  switch (result) {
    case "limited_hour": return "layout.feedback.err.limitedHour";
    case "limited_day": return "layout.feedback.err.limitedDay";
    default: return null;
  }
}

export function parseSubmitResult(v: unknown): FeedbackSubmitResult {
  return v === "throttled" || v === "limited_hour" || v === "limited_day" ? v : "ok";
}
