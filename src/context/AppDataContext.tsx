// src/context/AppDataContext.tsx
//
// 【設計意図】
// 段階的移行 Phase 1：内部実装は zustand ストア（src/stores/appStore.ts）に
// 移行済み。このファイルは既存コンポーネントへの**互換性レイヤー**として
// 残し、useAppData() / AppDataProvider の API を保つ。
//
// 移行ロードマップ:
//   Phase 1 (現在): zustand ベースに切替・useAppData() は全 state を返す（挙動・性能不変）
//   Phase 2-4:      コンポーネントを順次 useAppStore(s => s.X) の selector 形式に移行
//   Phase 5:        useAppData() を撤去し、このファイル削除
//
// 【再エクスポート】
//   useAppData()       — 互換 API。useAppStore() のラッパー
//   AppDataProvider    — 初回 load + Supabase realtime 購読を行う Wrapper
//   ConflictError      — store.ts から再エクスポート（後方互換）

import { useEffect, type ReactNode } from "react";
import { supabase } from "../lib/supabase/client";
import { useAppStore, type AppState } from "../stores/appStore";

export { ConflictError } from "../lib/supabase/store";

/** 旧 Context 値の型。useAppData() の戻り値に対応 */
export type AppDataContextValue = AppState & { reload: () => Promise<void> };

/**
 * 初回データ読み込みと Supabase realtime 購読を行うプロバイダ。
 * （旧 React Context は使っていないが、副作用の管理を component lifecycle に
 *  紐付けるために Wrapper として残している）
 */
export function AppDataProvider({ children }: { children: ReactNode }) {
  const load = useAppStore(s => s.load);

  // 初回マウント時に全データを読み込む
  useEffect(() => {
    load();
  }, [load]);

  // Supabase realtime: tasks / projects テーブルへの外部書き込みを検知して再取得
  useEffect(() => {
    const channel = supabase
      .channel("app-data-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "projects" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  return <>{children}</>;
}

/**
 * 互換 API。zustand ストア全体を返すため、Phase 1 では
 * **既存の Context 実装と同じ再レンダー特性**になる。
 *
 * 【Phase 2 以降の移行手順】
 * 既存コード:
 *   const { tasks, saveTask } = useAppData();
 * 移行後:
 *   const tasks    = useAppStore(s => s.tasks);
 *   const saveTask = useAppStore(s => s.saveTask);
 * この書き換えで `tasks` 以外の state 変更による再レンダーが消える。
 */
export function useAppData(): AppDataContextValue {
  // 全 state を取得。selector を使わないので state 全体への購読となり、
  // 既存挙動と等価（=どれか1つの state 変更で全消費者が再レンダー）。
  return useAppStore() as AppDataContextValue;
}
