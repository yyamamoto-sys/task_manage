// src/lib/stats.ts
// 進捗率など、複数Viewで重複していた集計ロジックを集約する。

/** done/total から完了率(%)を算出。total=0 は 0 を返す */
export function calcProgressPct(done: number, total: number): number {
  return total > 0 ? Math.round((done / total) * 100) : 0;
}
