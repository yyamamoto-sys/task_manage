// src/lib/push/notificationClickUrl.ts
//
// public/sw.js の notificationclick が開く先を決める判定（独立レビュー指摘：軽）。
// プッシュのペイロード（notification.data.url）はサーバ側で組み立てるが、念のため
// 他オリジンのURLが来ても外部へ遷移しない（オープンリダイレクト対策）。
//
// 🔴 public/sw.js はクラシックスクリプト（import不可）のため、同じロジックをsw.js側にも
// 複製している（src/lib/date/holidays.ts を Edge Function 側で複製しているのと同じ事情）。
// sw.js の notificationclick を変えたら、ここと __tests__ も必ず合わせて直すこと。

export function resolveNotificationClickUrl(rawUrl: string, origin: string): string {
  try {
    const resolved = new URL(rawUrl, origin);
    if (resolved.origin !== origin) return "/";
    return `${resolved.pathname}${resolved.search}${resolved.hash}` || "/";
  } catch {
    return "/";
  }
}
