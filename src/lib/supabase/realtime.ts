// src/lib/supabase/realtime.ts
//
// 主要11テーブルの DB 変更を WebSocket 経由で購読し、他クライアントの変更を
// appStore に流す。1チャンネル相乗りで接続数を最小化する。
// 対象は migrations/20260518_realtime_publication.sql の publication と一致。

import { REALTIME_LISTEN_TYPES, type RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { supabase } from "./client";
import type { RealtimeChange } from "../../stores/appStore";
import { createReconnectTracker } from "./resync";

const TABLES = [
  "tasks", "projects", "todos",
  "task_task_forces", "task_projects", "project_task_forces",
  "key_results", "task_forces", "milestones",
  "members", "task_dependencies",
] as const;

/**
 * Realtime 購読を開始する。返り値の関数を呼ぶと購読を解除する。
 * onChange は各 postgres_changes イベントごとに呼ばれる。
 * onResync は「切断（CHANNEL_ERROR/TIMED_OUT/CLOSED）から SUBSCRIBED に復帰したとき」だけ呼ばれる
 * （切断中のイベントは届いていないため、呼び出し側が全件再取得で埋める。最初の SUBSCRIBED では呼ばない）。
 */
export function subscribeToRealtime(
  onChange: (change: RealtimeChange) => void,
  opts?: { onResync?: () => void },
): () => void {
  const channel = supabase.channel("app-sync");

  for (const table of TABLES) {
    channel.on(
      REALTIME_LISTEN_TYPES.POSTGRES_CHANGES,
      { event: "*", schema: "public", table },
      (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
        onChange({
          table: payload.table,
          eventType: payload.eventType,
          new: (payload.new ?? null) as RealtimeChange["new"],
          old: (payload.old ?? null) as RealtimeChange["old"],
        });
      },
    );
  }

  const tracker = createReconnectTracker();
  channel.subscribe((status: string) => {
    if (tracker.onStatus(status)) opts?.onResync?.();
  });

  return () => {
    void supabase.removeChannel(channel);
  };
}
