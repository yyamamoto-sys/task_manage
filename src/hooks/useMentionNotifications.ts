// src/hooks/useMentionNotifications.ts
//
// 他のメンバーが自分を @short_name でメンションしたときにブラウザ通知を出す。
// Supabase Realtime → appStore へのタスク更新を監視し、コメントに @自分 が新たに現れたら通知する。
// 期限通知（useDeadlineNotifications）と同じ仕組み。notify_pref==="browser" かつ許可済みのみ動作。

import { useEffect, useRef } from "react";
import { useAppStore } from "../stores/appStore";

export function useMentionNotifications(currentUserId: string) {
  const tasks   = useAppStore(s => s.tasks);
  const members = useAppStore(s => s.members);

  // タスクごとの前回コメントを保持（変更差分の検出に使う）
  const prevRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (!currentUserId) return;
    if (typeof window === "undefined" || !("Notification" in window)) return;

    const me = members.find(m => m.id === currentUserId);
    if (!me || (me.notify_pref ?? "none") !== "browser") return;
    if (Notification.permission !== "granted") return;

    const token = `@${me.short_name}`;
    const prev  = prevRef.current;

    for (const task of tasks) {
      if (task.is_deleted) continue;
      const prevComment = prev.get(task.id) ?? null;
      const currComment = task.comment ?? "";

      // 初回ロード時はベースラインを記録するだけで通知しない
      if (prevComment === null) { prev.set(task.id, currComment); continue; }

      // コメントが変化し、新たに @自分 が含まれ、かつ自分自身の編集でない場合に通知
      if (
        currComment !== prevComment &&
        currComment.includes(token) &&
        !prevComment.includes(token) &&
        task.updated_by !== currentUserId
      ) {
        const editor = members.find(m => m.id === task.updated_by);
        const who = editor?.short_name ?? "メンバー";
        try {
          const n = new Notification(`💬 ${who} があなたをメンション`, {
            body: `タスク: ${task.name}`,
            tag: `mention-${task.id}`,  // 同タスクで上書き（連打防止）
          });
          n.onclick = () => { window.focus(); n.close(); };
        } catch { /* 環境によっては new Notification() 不可 */ }
      }
      prev.set(task.id, currComment);
    }
  }, [tasks, members, currentUserId]);
}
