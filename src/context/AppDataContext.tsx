// src/context/AppDataContext.tsx
//
// 【設計意図】
// Phase 5 完了：全コンポーネントが useAppStore() の selector ベースに移行済み。
// このファイルは初回 load + Supabase realtime 購読の lifecycle 管理のみを担う薄い Wrapper。
//
// 旧 useAppData() は撤去済み。新規コードは src/stores/appStore.ts の
// useAppStore(s => s.X) で必要な state だけを購読すること。
//
// 【再エクスポート（後方互換）】
//   ConflictError — store.ts から再エクスポート
//
// 【Thundering herd 対策（2026-06-23）】
// realtime イベントを 400ms デバウンスして複数ユーザーの同時接続時でも
// load() が殺到しないようにする。store 側の並列ガードと二重防衛。

import { useEffect, type ReactNode } from "react";
import { supabase } from "../lib/supabase/client";
import { useAppStore } from "../stores/appStore";

export { ConflictError } from "../lib/supabase/store";

/**
 * 初回データ読み込みと Supabase realtime 購読を行うプロバイダ。
 * App.tsx の認証済み配下に1つだけ置く。
 */
export function AppDataProvider({ children }: { children: ReactNode }) {
  const load = useAppStore(s => s.load);

  // 初回マウント時に全データを読み込む
  useEffect(() => {
    load();
  }, [load]);

  // Supabase realtime: tasks / projects テーブルへの外部書き込みを検知して再取得
  // デバウンス 400ms: 複数ユーザーが同時接続しても load() が一度に大量発行されないよう集約する
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const debouncedLoad = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => load(), 400);
    };

    const channel = supabase
      .channel("app-data-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, debouncedLoad)
      .on("postgres_changes", { event: "*", schema: "public", table: "projects" }, debouncedLoad)
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [load]);

  return <>{children}</>;
}
