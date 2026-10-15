// src/lib/feedback/capture.ts
//
// ご意見の「入口」と「モーダルが開いた瞬間のスナップショットの確定」（v3.157・CLAUDE.md Section 82）。
//
// 入口（ベルの「💬 ご意見を送る」・設定「困ったとき」）は requestOpenFeedback() を呼ぶだけ。MainLayout が
// OPEN_FEEDBACK_EVENT を受け、その場（同じクリックの処理の中）で captureFeedbackSnapshot() を呼んでスナップショットを確定してから
// モーダルを出す。モーダルを開いた後の画面・クリックは含めない（ベル・モーダル自身のクリックは履歴から除く＝clickHistory.ts）。

import { APP_VERSION } from "../version";
import { getClientErrorScreen } from "../errors/clientErrorLog";
import { getRecentClicks } from "./clickHistory";
import { collectSnapshotContext } from "./snapshotContext";
import {
  buildFeedbackRoute, buildFeedbackSnapshot, finalizeSnapshot, type FeedbackSnapshot, type FinalizedSnapshot,
} from "./snapshot";

export const OPEN_FEEDBACK_EVENT = "app:open-feedback";

/** 入口から呼ぶ。ゲストには入口自体を出さない（呼び出し側）。MainLayout が受けて開く */
export function requestOpenFeedback(): void {
  window.dispatchEvent(new CustomEvent(OPEN_FEEDBACK_EVENT));
}

/** MainLayout がマウント時に購読する。返り値で解除する */
export function onOpenFeedbackRequest(cb: () => void): () => void {
  const handler = () => cb();
  window.addEventListener(OPEN_FEEDBACK_EVENT, handler);
  return () => window.removeEventListener(OPEN_FEEDBACK_EVENT, handler);
}

export interface FeedbackCapture {
  /** 確定したスナップショット（プレビューに出す。16KB超でも内容は見せる） */
  snapshot: FeedbackSnapshot;
  /** 送るときの判定（16KB 以内なら attached、超えたら too_large で本文だけを送る） */
  finalized: FinalizedSnapshot;
  screen: string | null;
  route: string;
  /** 送信時の表示部署（DB が本人のアクセス範囲か確かめる） */
  groupId: string | null;
}

/** 今の画面の状況を確定する。モーダルを開く操作と同じ処理の中で1回だけ呼ぶ */
export function captureFeedbackSnapshot(now: number = Date.now()): FeedbackCapture {
  const screenName = getClientErrorScreen();
  const route = buildFeedbackRoute(window.location.pathname, window.location.search);
  const snapshot = buildFeedbackSnapshot({
    now,
    screen: screenName,
    route,
    appVersion: APP_VERSION,
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    display: typeof window.screen === "undefined" ? null : { w: window.screen.width, h: window.screen.height },
    dpr: window.devicePixelRatio,
    context: collectSnapshotContext(),
    clicks: getRecentClicks(),
  });
  return {
    snapshot,
    finalized: finalizeSnapshot(snapshot),
    screen: screenName,
    route,
    groupId: snapshot.department?.displayGroupId ?? null,
  };
}
