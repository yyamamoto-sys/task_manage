// src/hooks/usePushSubscriptionSync.ts
//
// Windows通知をオンにしている人がアプリを開いたら、このブラウザの購読をDBと突き合わせて登録し直す
// （購読の失効・鍵の変更・SW の更新を吸収する。設計書 §3.1・§8.1）。
// 許可ダイアログは出さない（許可済みのブラウザだけが対象）。失敗しても画面は止めない。

import { useEffect } from "react";
import { getVapidPublicKey, isInIframe, isPushSupported, subscribeThisBrowser } from "../lib/push/pushClient";
import { registerPushSubscription } from "../lib/supabase/notificationStore";

export function usePushSubscriptionSync(memberId: string | null, pushEnabled: boolean) {
  useEffect(() => {
    if (!memberId || !pushEnabled) return;
    const key = getVapidPublicKey();
    if (!key || !isPushSupported() || isInIframe()) return;
    if (Notification.permission !== "granted") return;
    let cancelled = false;
    (async () => {
      try {
        const keys = await subscribeThisBrowser(key);
        if (cancelled) return;
        await registerPushSubscription(keys.endpoint, keys.p256dh, keys.auth);
      } catch (e) {
        console.warn("[push] 購読の再同期に失敗:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [memberId, pushEnabled]);
}
