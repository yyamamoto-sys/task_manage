/* global self, URL */
// public/sw.js
//
// 期限リマインドの Windows 通知（Web Push）を受けるだけの Service Worker（v3.128）。
// 正本：docs/dev/web-push-reminder-design.md §3.1
//
// 🔴 fetch ハンドラを書かない（キャッシュしない）。キャッシュを持つ SW を入れると、デプロイ後も
//    古い画面が出続ける障害を呼び込む（再読み込みの案内＝version.json の仕組みとも衝突する）。
// 🔴 このファイルは vercel.json で Cache-Control: no-store 配信、登録側も updateViaCache:"none"。
//    更新を出したら、install で skipWaiting・activate で clients.claim して古い版を残さない。

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = { title: "通知", body: "", url: "/", tag: "app" };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    if (event.data) payload.body = event.data.text();
  }
  // Chrome は userVisibleOnly のため、受信したら必ず通知を出す
  event.waitUntil((async () => {
    await self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      data: { url: payload.url },
    });
    // タブを開いたままでも未読バッジが追従するよう、開いているクライアントへ知らせる
    // （InAppNotificationBell が受けて再取得する。取りこぼしても数分おきの再取得が保険）
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of clients) c.postMessage({ type: "push-received" });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const rawUrl = (event.notification.data && event.notification.data.url) || "/";
  // 他オリジンのURLが来たら開かない（src/lib/push/notificationClickUrl.ts と同じ判定。
  // sw.js はクラシックスクリプトのため import できず、ロジックを複製している）
  let url = "/";
  try {
    const resolved = new URL(rawUrl, self.location.origin);
    url = resolved.origin === self.location.origin ? `${resolved.pathname}${resolved.search}${resolved.hash}` || "/" : "/";
  } catch {
    url = "/";
  }
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const sameOrigin = all.filter((c) => new URL(c.url).origin === self.location.origin);
    const target = sameOrigin.find((c) => c.focused) || sameOrigin[0];
    if (target) {
      // 開いているタブは再読み込みせず、アプリ側（MainLayout）に画面切替を頼む。
      // navigate() で再読み込みすると、保存前の編集が無言で消えるため
      target.postMessage({ type: "notification-click", url });
      if ("focus" in target) await target.focus();
      return;
    }
    await self.clients.openWindow(url);
  })());
});
