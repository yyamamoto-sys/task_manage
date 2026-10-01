// src/lib/push/logoutCleanup.ts
//
// ログアウト時にこのブラウザの Web Push 購読を解除する（共有PCで前の利用者宛の
// タスク名入り通知が出続けるのを防ぐ。設計書 §8.1）。
// signOut() より前に呼ぶこと（DB側の削除は RLS で本人の行のみのため、セッションが
// 生きている間でないと通らない。NotificationSettingsSection の togglePush(false) と同じ手順）。
// 失敗してもログアウト自体は止めない（console.warn に留める＝呼び出し側の責務にしない）。

import { unsubscribeThisBrowser } from "./pushClient";
import { deletePushSubscription } from "../supabase/notificationStore";

export async function cleanupPushSubscriptionOnLogout(
  unsubscribe: () => Promise<string | null> = unsubscribeThisBrowser,
  deleteRow: (endpoint: string) => Promise<void> = deletePushSubscription,
): Promise<void> {
  try {
    const endpoint = await unsubscribe();
    if (endpoint) await deleteRow(endpoint);
  } catch (e) {
    console.warn("[logout] Web Push購読の解除に失敗しました（次回ログイン時に古い購読が残る可能性があります）:", e);
  }
}
