// src/lib/supabase/realtime.ts
//
// 【設計意図】
// 主要9テーブルの DB 変更を WebSocket 経由でリアルタイム購読し、
// 他クライアントが起こした変更を appStore に流し込む。
// これにより、複数人が同じ画面を見ているとき、リロードなしで反映される。
//
// AI トークンは一切消費しない（Supabase の postgres_changes は DB のWAL を
// 流すだけで、OpenAI/Claude API とは無関係）。
//
// 1チャンネルで複数テーブルを購読することで接続数を最小化する。
//
// 対象テーブル（migrations/20260518_realtime_publication.sql と一致）:
//   tasks, projects, todos, task_task_forces, task_projects,
//   project_task_forces, key_results, task_forces, milestones, members

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

  // 各テーブルに postgres_changes リスナーを登録
  for (const table of TABLES) {
    channel.on(
      // 第1引数の型は Supabase の RealtimePostgresChangesFilter。
      // 'postgres_changes' は string リテラルだが Supabase 側で REALTIME_LISTEN_TYPES と
      // して定義されているため as の型キャストが不要。
      // ESLint 上は any 警告が出る可能性があるため eslint-disable で抑制。
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      "postgres_changes" as any,
      { event: "*", schema: "public", table },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (payload: any) => {
        onChange({
          table: payload.table as string,
          eventType: payload.eventType as RealtimeChange["eventType"],
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
