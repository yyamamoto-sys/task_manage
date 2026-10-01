// supabase/functions/_shared/concurrencyPool.ts
//
// push-reminders の送信を「1人ずつ await」から、同時実行数に上限をつけた並列処理に
// 変える（独立レビュー指摘・中）。Promise.allSettled ベース＝1件の失敗・例外で
// 他の処理を止めない。結果は入力と同じ順序の配列で返す（集計側が対応づけやすいように）。

export type PoolResult<R> =
  | { status: "fulfilled"; value: R }
  | { status: "rejected"; reason: unknown };

export async function runWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<PoolResult<R>[]> {
  const results: PoolResult<R>[] = new Array(items.length);
  const limit = Math.max(1, Math.min(concurrency, items.length || 1));
  let next = 0;

  async function runner(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try {
        const value = await worker(items[i], i);
        results[i] = { status: "fulfilled", value };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  }

  // Promise.allSettled で待つ（runner 自体は内部で例外を握りつぶすため常に fulfilled になるが、
  // 将来 runner に手を入れても全体が落ちないよう allSettled を使う）
  await Promise.allSettled(Array.from({ length: limit }, () => runner()));
  return results;
}
