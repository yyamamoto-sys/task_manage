// src/lib/supabase/realtime.ts
//
// 主要10テーブルの DB 変更を WebSocket 経由で購読し、他クライアントの変更を
// appStore に流す。1チャンネル相乗りで接続数を最小化する。
// 対象は migrations/20260518_realtime_publication.sql の publication と一致。

import { REALTIME_LISTEN_TYPES, type RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { supabase } from "./client";
import type { RealtimeChange } from "../../stores/appStore";

const TABLES = [
  "tasks", "projects", "todos",
  "task_task_forces", "task_projects", "project_task_forces",
  "key_results", "task_forces", "milestones",
  "members",
] as const;

/**
 * Realtime 購読を開始する。返り値の関数を呼ぶと購読を解除する。
 * onChange は各 postgres_changes イベントごとに呼ばれる。
 */
export function subscribeToRealtime(
  onChange: (change: RealtimeChange) => void,
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

  channel.subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
