// src/stores/notificationPrefsStore.ts
//
// 期限リマインドの個人設定（notification_prefs）。設定ページの🔔タブ・メンション通知のゲート・
// 購読の再同期（MainLayout）が同じ値を見るため zustand に置く（appStore には足さない＝Section 19）。
// テーブル未適用・取得失敗は "unavailable" にして既定値で動かす（画面側で案内を出す）。

import { create } from "zustand";
import { DEFAULT_NOTIFICATION_PREFS, prefsFromRow, type NotificationPrefs } from "../lib/reminder/notificationPrefs";
import { fetchNotificationPrefsRow, upsertNotificationPrefs } from "../lib/supabase/notificationStore";
import { formatErrorForUser } from "../lib/errorMessage";

type Status = "idle" | "loading" | "ready" | "unavailable";

interface NotificationPrefsState {
  memberId: string | null;
  prefs: NotificationPrefs;
  status: Status;
  errorMessage: string | null;
  load: (memberId: string) => Promise<void>;
  /** 押した時点で保存する（設計書 §4.5）。失敗したら元に戻して例外を投げる */
  update: (patch: Partial<NotificationPrefs>) => Promise<void>;
}

export const useNotificationPrefsStore = create<NotificationPrefsState>((set, get) => ({
  memberId: null,
  prefs: { ...DEFAULT_NOTIFICATION_PREFS },
  status: "idle",
  errorMessage: null,

  load: async (memberId) => {
    set({ memberId, status: "loading", errorMessage: null });
    try {
      const row = await fetchNotificationPrefsRow(memberId);
      if (get().memberId !== memberId) return;
      set({ prefs: prefsFromRow(row), status: "ready" });
    } catch (e) {
      if (get().memberId !== memberId) return;
      console.warn("[notificationPrefs] 取得に失敗:", e);
      set({ prefs: { ...DEFAULT_NOTIFICATION_PREFS }, status: "unavailable", errorMessage: formatErrorForUser("通知設定を読み込めませんでした", e) });
    }
  },

  update: async (patch) => {
    const { memberId, prefs } = get();
    if (!memberId) throw new Error("ログイン中のメンバーが確定していません");
    const next = { ...prefs, ...patch };
    set({ prefs: next });
    try {
      await upsertNotificationPrefs(memberId, next);
    } catch (e) {
      set({ prefs });
      throw e;
    }
  },
}));
