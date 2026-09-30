// public/push-proto-sw.js
//
// web-push ライブラリ選定の dev 最小試作（proto/web-push ブランチ専用）用の最小 Service Worker。
// docs/dev/web-push-reminder-design.md §3.1 の方針どおり、push と notificationclick の
// 2ハンドラだけを持つ（fetch ハンドラは持たない＝キャッシュしない）。
//
// 🔴 このファイルはプロトタイプ専用。本番の public/sw.js とは無関係（別ファイル・別スコープ）。

self.addEventListener("push", (event) => {
  let payload = { title: "push-proto テスト通知", body: "(本文なし)", url: "/", tag: "push-proto-test" };
  try {
    if (event.data) {
      payload = { ...payload, ...event.data.json() };
    }
  } catch (e) {
    payload.body = event.data ? event.data.text() : "(本文の解析に失敗)";
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      data: { url: payload.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of allClients) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            try {
              await client.navigate(url);
            } catch {
              // navigate不可でもfocusできていればよしとする
            }
          }
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
