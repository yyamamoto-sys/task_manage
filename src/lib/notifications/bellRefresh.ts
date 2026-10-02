// src/lib/notifications/bellRefresh.ts
//
// 自分の操作（お知らせの送信・確認しました・既読化）の直後に、右上のベルへ「今すぐ取り直して」と伝える（v3.133）。
// ベルは MainLayout、送信画面は設定ページと離れているため、props ではなく window のイベントでつなぐ。

const EVENT = "app:bell-refresh";

export function requestBellRefresh(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(EVENT));
}

export function onBellRefreshRequest(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
