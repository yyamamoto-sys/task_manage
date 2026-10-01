// src/lib/push/swMessage.ts
//
// public/sw.js の push ハンドラが postMessage する合図（InAppNotificationBell が受けて
// 未読数を再取得する。タブを開いたままでもバッジを追従させるため）。

export function isPushReceivedMessage(data: unknown): boolean {
  return !!data && typeof data === "object" && (data as { type?: unknown }).type === "push-received";
}
