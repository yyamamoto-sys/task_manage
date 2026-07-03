// src/hooks/useDeadlineNotifications.ts
//
// 【設計意図】
// 自分宛て・未完了・「期限切れ／本日期限」のタスクを、ブラウザのOS通知で能動的に知らせる（方式B）。
// - 発火条件：自分の member.notify_pref === "browser" かつ Notification 許可が "granted"
// - アプリ（タブ）を開いている間のみ動作する。タブを閉じている間の通知は Teams 側
//   （サーバ送信＝notify-deadlines Edge Function）が担当する役割分担。
// - 同じ日に同じタスクを二重通知しないよう localStorage（ユーザーごと）に当日通知済みを記録。
// - 日付替わり・新規期限に追従するため一定間隔でも再チェックする。
//
// CLAUDE.md：派生値は state に保存しない方針に従い、対象タスクは都度算出する。

import { useEffect, useRef } from "react";
import { useAppStore, selectScopedTasks } from "../stores/appStore";
import { todayStr } from "../lib/date";
import { isAssignedTo } from "../lib/taskMeta";
import { active, LS_KEY } from "../lib/localData/localStore";

const RECHECK_MS = 30 * 60 * 1000; // 30分ごと（日付替わり・新規期限の取りこぼし防止）

type NotifiedRecord = { date: string; ids: string[] };

function loadNotified(userId: string): NotifiedRecord {
  try {
    const raw = localStorage.getItem(LS_KEY.deadlineNotified(userId));
    if (raw) {
      const parsed = JSON.parse(raw) as NotifiedRecord;
      if (parsed && typeof parsed.date === "string" && Array.isArray(parsed.ids)) return parsed;
    }
  } catch { /* ignore */ }
  return { date: "", ids: [] };
}

function saveNotified(userId: string, rec: NotifiedRecord) {
  try { localStorage.setItem(LS_KEY.deadlineNotified(userId), JSON.stringify(rec)); } catch { /* ignore */ }
}

/**
 * 期限のブラウザ通知を有効化するフック。アプリ最上位（MainLayout）で1回だけ呼ぶ。
 * notify_pref が "browser" 以外、または通知未許可のときは何もしない。
 */
export function useDeadlineNotifications(currentUserId: string) {
  const tasks   = useAppStore(selectScopedTasks);
  const members = useAppStore(s => s.members);

  // interval 内で stale を避けるため最新値を ref に保持
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const membersRef = useRef(members);
  membersRef.current = members;

  useEffect(() => {
    if (!currentUserId) return;
    if (typeof window === "undefined" || !("Notification" in window)) return;

    const check = () => {
      const me = membersRef.current.find(m => m.id === currentUserId);
      if (!me || me.notify_pref !== "browser") return;
      if (Notification.permission !== "granted") return;

      const today = todayStr();
      // 自分担当・未完了・期限切れ／本日期限
      const myDue = active(tasksRef.current).filter(t =>
        isAssignedTo(t, currentUserId) &&
        t.status !== "done" &&
        t.due_date != null &&
        t.due_date <= today,
      );
      if (myDue.length === 0) return;

      // 当日すでに通知済みのIDは除外（新たに期限入りしたものだけ通知）
      const rec = loadNotified(currentUserId);
      const base: NotifiedRecord = rec.date === today ? rec : { date: today, ids: [] };
      const already = new Set(base.ids);
      const fresh = myDue.filter(t => !already.has(t.id));
      if (fresh.length === 0) return;

      const overdue = myDue.filter(t => (t.due_date ?? "") < today).length;
      const titleLine = overdue > 0
        ? `期限切れ ${overdue}件・本日まで ${myDue.length}件`
        : `本日までの期限タスク ${myDue.length}件`;
      const names = myDue.slice(0, 3).map(t => `・${t.name}`).join("\n");
      const bodyText = names + (myDue.length > 3 ? `\n…ほか ${myDue.length - 3} 件` : "");

      try {
        const n = new Notification("🔔 タスクの期限", {
          body: `${titleLine}\n${bodyText}`,
          tag: `deadline-${today}`, // 同タグで上書き（通知の氾濫防止）
        });
        n.onclick = () => { window.focus(); n.close(); };
      } catch { /* 一部環境で new Notification() が不可な場合は黙って無視 */ }

      // 当日表示したIDをすべて通知済みに記録
      saveNotified(currentUserId, { date: today, ids: myDue.map(t => t.id) });
    };

    check();
    const id = setInterval(check, RECHECK_MS);
    return () => clearInterval(id);
    // tasks / members 変化時にも再評価（check は ref 経由で最新を参照）
  }, [currentUserId, tasks, members]);
}
