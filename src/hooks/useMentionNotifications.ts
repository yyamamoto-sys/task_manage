// src/hooks/useMentionNotifications.ts
//
// 他のメンバーが自分を @short_name でメンションし、タスク編集モーダルを閉じたときにブラウザ通知を出す。
// コメント文字列（autosave のたびに変わる）ではなく、モーダルを閉じたときだけ更新される
// tasks.finalized_mentions の変化を監視することで「閉じた時方式」を実現する。
// v3.128：Windows通知（notification_prefs.push_enabled）をオンにした人で、許可済みのときだけ動作する
// （旧ゲートは members.notify_pref==="browser"。設計書 §4.3）。
// v3.129：通知の種類「メンション」の Windows がオフの人には出さない（CLAUDE.md Section 67）。

import { useEffect, useRef } from "react";
import { useAppStore } from "../stores/appStore";
import { useNotificationPrefsStore } from "../stores/notificationPrefsStore";
import { isKindEnabled } from "../lib/notifications/notificationKinds";

export function useMentionNotifications(currentUserId: string) {
  // 通知は表示部署に関係なく、見えている全タスクを監視する（表示部署で絞ると兼務先のメンションが届かない・v3.139）
  const tasks   = useAppStore(s => s.tasks);
  const members = useAppStore(s => s.members);
  const pushEnabled = useNotificationPrefsStore(s => s.status === "ready" && isKindEnabled(s.prefs, "mention", "push"));

  // タスクごとの前回 finalized_mentions（カンマ結合文字列で保持）
  const prevRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (!currentUserId) return;
    if (typeof window === "undefined" || !("Notification" in window)) return;

    const me = members.find(m => m.id === currentUserId);
    if (!me || !pushEnabled) return;
    if (Notification.permission !== "granted") return;

    const prev = prevRef.current;

    for (const task of tasks) {
      if (task.is_deleted) continue;

      const currFM   = (task.finalized_mentions ?? []).join(",");
      const prevFM   = prev.get(task.id) ?? null;

      // 初回ロード時はベースラインを記録するだけで通知しない
      if (prevFM === null) { prev.set(task.id, currFM); continue; }

      // finalized_mentions が変化し、自分の short_name が新たに含まれ、自分の編集でない場合に通知
      const currMentions = task.finalized_mentions ?? [];
      const prevMentions = prevFM ? prevFM.split(",").filter(Boolean) : [];

      if (
        currFM !== prevFM &&
        currMentions.includes(me.short_name) &&
        !prevMentions.includes(me.short_name) &&
        task.updated_by !== currentUserId
      ) {
        const editor = members.find(m => m.id === task.updated_by);
        const who = editor?.short_name ?? "メンバー";
        try {
          const n = new Notification(`💬 ${who} があなたをメンション`, {
            body: `タスク: ${task.name}`,
            tag: `mention-${task.id}`,
          });
          n.onclick = () => { window.focus(); n.close(); };
        } catch { /* 環境によっては new Notification() 不可 */ }
      }
      prev.set(task.id, currFM);
    }
  }, [tasks, members, currentUserId, pushEnabled]);
}
