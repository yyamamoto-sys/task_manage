// push-reminders（Edge Function）の並列送信（同時実行数の上限つき）。実体は
// supabase/functions/_shared/ の純粋関数で、ここから相対 import して検証する
// （reminderLogic.test.ts と同じ置き方）。

import { describe, it, expect } from "vitest";
import { runWithConcurrency } from "../../../../supabase/functions/_shared/concurrencyPool";

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("runWithConcurrency", () => {
  it("件数の少ない配列はそのまま全件処理する（結果は入力順）", async () => {
    const results = await runWithConcurrency([1, 2, 3], 10, async (n) => n * 10);
    expect(results).toEqual([
      { status: "fulfilled", value: 10 },
      { status: "fulfilled", value: 20 },
      { status: "fulfilled", value: 30 },
    ]);
  });

  it("同時実行数が上限を超えない", async () => {
    const items = Array.from({ length: 25 }, (_, i) => i);
    let active = 0;
    let maxActive = 0;
    const results = await runWithConcurrency(items, 10, async (n) => {
      active++;
      maxActive = Math.max(maxActive, active);
      // 他のworkerが追いつく時間を作る（即resolveだと直列と区別がつかない）
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return n;
    });
    expect(maxActive).toBeLessThanOrEqual(10);
    expect(maxActive).toBeGreaterThan(1); // 並列になっていること自体の確認
    expect(results.map((r) => (r.status === "fulfilled" ? r.value : null))).toEqual(items);
  });

  it("1人の失敗（reject）が他の人の処理を止めない。集計も正しい（成功・失敗が正しく件数に残る）", async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await runWithConcurrency(items, 2, async (n) => {
      if (n === 3) throw new Error(`member ${n} failed`);
      return n * 100;
    });
    const succeeded = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");
    expect(succeeded).toHaveLength(4);
    expect(failed).toHaveLength(1);
    expect(results[2]).toMatchObject({ status: "rejected" });
    expect((results[2] as { status: "rejected"; reason: unknown }).reason).toBeInstanceOf(Error);
    // 他の4件は失敗の影響を受けず成功している
    expect(results[0]).toEqual({ status: "fulfilled", value: 100 });
    expect(results[4]).toEqual({ status: "fulfilled", value: 500 });
  });

  it("空配列は何もせず空配列を返す", async () => {
    const results = await runWithConcurrency([], 10, async () => 1);
    expect(results).toEqual([]);
  });

  it("concurrencyが要素数より大きくても安全に動く", async () => {
    const results = await runWithConcurrency([1, 2], 100, async (n) => n);
    expect(results).toEqual([
      { status: "fulfilled", value: 1 },
      { status: "fulfilled", value: 2 },
    ]);
  });

  it("後発のworkerがまだ処理中でも先発の完了を待たされない（スケジューリングの確認）", async () => {
    const slow = deferred<number>();
    const order: number[] = [];
    const resultsPromise = runWithConcurrency([0, 1, 2], 2, async (n) => {
      if (n === 0) { await slow.promise; order.push(0); return 0; }
      order.push(n);
      return n;
    });
    // n=1 は n=0 を待たずに先に完了できる（同時実行枠が空いているため n=2 も走り出す）
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual([1, 2]);
    slow.resolve(0);
    const results = await resultsPromise;
    expect(results.map((r) => (r.status === "fulfilled" ? r.value : null))).toEqual([0, 1, 2]);
  });
});
