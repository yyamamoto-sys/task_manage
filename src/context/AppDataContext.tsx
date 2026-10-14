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
// 【v3.146：tasks/projects の変更で load() を呼ぶ購読は撤去した（CLAUDE.md Section 76）】
// 旧実装は tasks/projects の変更のたびに 400ms 後に全テーブルを取り直していた。自分の保存も
// realtime で自分へ返ってくるため、ガントのドラッグ・一括シフト・AI 反映のたびに15テーブルの
// 全件取得と全画面の再描画が走り、長く使うほど重くなる原因だった。realtime の反映は App.tsx の
// subscribeToRealtime(applyRemoteChange)（11表を差分で反映）に一本化している。
// 取りこぼしを埋める load() は、切断からの復帰・長時間非表示からの復帰のときだけ App.tsx が呼ぶ。
//
// 【ゲスト（サンプル閲覧）モードのガード（2026-08-06）】
// App.tsx はゲストモード時にこの Provider 自体を配下に置かない（appStore にはサンプル
// データを直接注入し、Supabase load() / realtime 購読を経由させない設計）。ここでの
// isGuestMode() チェックは、万一将来 AppDataProvider がゲスト配下にも置かれるように
// なった場合の二重防衛（実データが読み込まれてしまう事故を構造的に防ぐ）。

import { useEffect, type ReactNode } from "react";
import { useAppStore } from "../stores/appStore";
import { isGuestMode } from "../lib/guestMode";

export { ConflictError } from "../lib/supabase/store";

/**
 * 初回データ読み込みを行うプロバイダ（realtime 購読は App.tsx）。
 * App.tsx の認証済み配下に1つだけ置く。
 */
export function AppDataProvider({ children }: { children: ReactNode }) {
  const load = useAppStore(s => s.load);

  // 初回マウント時に全データを読み込む（ゲストモードは Supabase に一切アクセスしない）
  useEffect(() => {
    if (isGuestMode()) return;
    load();
  }, [load]);

  return <>{children}</>;
}
