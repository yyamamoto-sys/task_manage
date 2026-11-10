// src/lib/loadProgress.ts
//
// 【設計意図】起動画面（FullScreenLoading）の進行度の計算。
// 起動は「認証確認 → Phase 1 データ取得 → 自動同定（currentUser 確定）」の3段で、同じ画面・同じバーが出続ける。
// バーが 100% に届くのは自動同定が終わる画面切替の直前だけにするため、データ取得は上限 PHASE1_DATA_MAX%、
// 自動同定の間は PREPARING_PROGRESS% を保つ。Phase 1 完了で 0 に戻さない（戻すと「始めからやり直し」に見える）。

/** fetchCriticalData が並列に取る表の数（進行度の分母）。 */
export const CRITICAL_TABLE_COUNT = 9;
export const PHASE1_DATA_MAX = 90;
export const PREPARING_PROGRESS = 95;
export const READY_PROGRESS = 100;

/** Phase 1 のデータ取得の進行度（done/total を 0〜PHASE1_DATA_MAX% に写す）。範囲外は丸める。 */
export function phase1Percent(done: number, total: number): number {
  if (!(total > 0)) return 0;
  const f = Math.min(1, Math.max(0, done / total));
  return Math.round(f * PHASE1_DATA_MAX);
}
