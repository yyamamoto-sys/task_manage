// src/lib/progress/__tests__/progressCurve.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  PROGRESS_CAP_PCT,
  computeAsymptoticProgress,
  computeAsymptoticPct,
  resolvePhaseIndex,
  computeElapsedSeconds,
  isTakingLongerThanUsual,
  resolveExpectedRangeSeconds,
} from "../progressCurve";

describe("computeAsymptoticPct", () => {
  it("t=0 で 0 を返す", () => {
    expect(computeAsymptoticPct(0, 20000)).toBe(0);
  });

  it("t=expectedMs でおよそ82%になる（τ=expectedMs/2 の設計どおり）", () => {
    const pct = computeAsymptoticPct(20000, 20000);
    expect(pct).toBeGreaterThan(81);
    expect(pct).toBeLessThan(83);
  });

  it("t=2×expectedMs でおよそ93%になる", () => {
    const pct = computeAsymptoticPct(40000, 20000);
    expect(pct).toBeGreaterThan(92);
    expect(pct).toBeLessThan(94);
  });

  it("どれだけ経過時間が長くても95%を超えない（負の経過・非常に長い経過の両方）", () => {
    expect(computeAsymptoticPct(-1000, 20000)).toBeLessThan(PROGRESS_CAP_PCT);
    expect(computeAsymptoticPct(0, 20000)).toBeLessThan(PROGRESS_CAP_PCT);
    // 10分待っても（現実にはまず起こらない極端な長さ）指数関数は厳密に1未満のため95%未満を保つ
    expect(computeAsymptoticPct(600_000, 20000)).toBeLessThan(PROGRESS_CAP_PCT);
    expect(computeAsymptoticPct(600_000, 20000)).toBeGreaterThan(94.9);
  });

  it("時間が経つほど単調に増加する（フリーズしない）", () => {
    const samples = [0, 5000, 10000, 20000, 40000, 80000, 160000].map(t => computeAsymptoticPct(t, 20000));
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeGreaterThan(samples[i - 1]);
    }
  });
});

describe("computeAsymptoticProgress（capPctを変えられる版・SaveProgressLoaderのステップ内演出用）", () => {
  it("capPctを90にすると90%未満に収まる", () => {
    expect(computeAsymptoticProgress(600_000, 1500, 90)).toBeLessThan(90);
    expect(computeAsymptoticProgress(600_000, 1500, 90)).toBeGreaterThan(89.9);
  });
});

describe("resolvePhaseIndex", () => {
  it("経過時間0ではフェーズ0", () => {
    expect(resolvePhaseIndex(0, 20000, 4)).toBe(0);
  });

  it("expectedMsに比例した間隔で1つずつ進む（4フェーズ・expectedMs=20000）", () => {
    expect(resolvePhaseIndex(4999, 20000, 4)).toBe(0);
    expect(resolvePhaseIndex(5000, 20000, 4)).toBe(1);
    expect(resolvePhaseIndex(10000, 20000, 4)).toBe(2);
    expect(resolvePhaseIndex(15000, 20000, 4)).toBe(3);
  });

  it("🔴 最後のフェーズに達した後、時間がどれだけ経っても最後のインデックスのまま（配列外に出ない）", () => {
    expect(resolvePhaseIndex(20000, 20000, 4)).toBe(3);
    expect(resolvePhaseIndex(100000, 20000, 4)).toBe(3);
    expect(resolvePhaseIndex(10_000_000, 20000, 4)).toBe(3);
  });

  it("phaseCountが0以下なら常に0", () => {
    expect(resolvePhaseIndex(5000, 20000, 0)).toBe(0);
  });
});

describe("computeElapsedSeconds", () => {
  it("切り捨てで秒数を返す", () => {
    expect(computeElapsedSeconds(0)).toBe(0);
    expect(computeElapsedSeconds(999)).toBe(0);
    expect(computeElapsedSeconds(1000)).toBe(1);
    expect(computeElapsedSeconds(23499)).toBe(23);
  });

  it("負の経過時間は0に丸める", () => {
    expect(computeElapsedSeconds(-500)).toBe(0);
  });

  it("🔴 どれだけ待っても増え続ける（『止まらない』ことの最終的な保証）", () => {
    const a = computeElapsedSeconds(60_000);
    const b = computeElapsedSeconds(120_000);
    const c = computeElapsedSeconds(600_000);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });
});

describe("isTakingLongerThanUsual", () => {
  it("目安上限の1.5倍ちょうどでは切り替わらない・超えたら切り替わる", () => {
    expect(isTakingLongerThanUsual(30000, 20000)).toBe(false); // 20000*1.5=30000 ちょうど
    expect(isTakingLongerThanUsual(30001, 20000)).toBe(true);
  });

  it("エラー扱いにはしない（真偽値だけを返す・例外を投げない）", () => {
    expect(() => isTakingLongerThanUsual(1_000_000, 20000)).not.toThrow();
  });
});

describe("resolveExpectedRangeSeconds", () => {
  it("expectedMs=30000 なら 20〜40秒（設計メモの例と一致）", () => {
    expect(resolveExpectedRangeSeconds(30000)).toEqual([20, 40]);
  });

  it("明示的な範囲（ms）が渡されればそれを秒に変換して使う", () => {
    expect(resolveExpectedRangeSeconds(30000, [10000, 50000])).toEqual([10, 50]);
  });

  it("最小値が最大値以上にならないよう保証する", () => {
    const [min, max] = resolveExpectedRangeSeconds(1000);
    expect(max).toBeGreaterThan(min);
  });
});

// ---------------------------------------------------------------------------
// 旧実装との比較（回帰確認）：旧AIProgressLoaderのロジックを再現し、
// 「最後のフェーズに入った後、時間が経っても表示が増えない」という
// 修正前の不具合を、新しい漸近曲線が実際に解決していることを示す。
// vitest の fake timers で経過時間を進め、Date.now() 差分から両者を計算する。
// ---------------------------------------------------------------------------
describe("旧実装との比較：最後のフェーズに入った後も新実装だけが動き続ける", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** 旧AIProgressLoaderの実装を再現した関数（修正前のsubProgressロジック）。 */
  function legacyTotalPct(elapsedMs: number, intervalMs: number, phaseCount: number): number {
    const phaseIndex = Math.min(phaseCount - 1, Math.floor(elapsedMs / intervalMs));
    const msIntoPhase = elapsedMs - phaseIndex * intervalMs;
    const duration = intervalMs * 0.88;
    const t = Math.min(msIntoPhase / duration, 1);
    const subProgress = 0.88 * (1 - Math.pow(1 - t, 2));
    return Math.min(99, Math.round(((phaseIndex + subProgress) / phaseCount) * 100));
  }

  it("旧実装：最後のフェーズに入ってしばらくすると、以後は時間が経っても値が変わらない（この挙動を再現できていることの確認）", () => {
    const intervalMs = 4000;
    const phaseCount = 4;
    const start = Date.now();

    // 最後のフェーズ(index 3)に入った直後
    vi.advanceTimersByTime(intervalMs * 3 + 10);
    const justEntered = legacyTotalPct(Date.now() - start, intervalMs, phaseCount);

    // フェーズ内のsubProgressが88%上限に達するのに十分な時間が経過した後、さらに長時間待つ
    vi.advanceTimersByTime(intervalMs * 0.88 + 1000);
    const afterCap = legacyTotalPct(Date.now() - start, intervalMs, phaseCount);

    vi.advanceTimersByTime(60_000);
    const muchLater = legacyTotalPct(Date.now() - start, intervalMs, phaseCount);

    // 88%上限に達するまでは動き、達した後は固定される（旧実装の実際の挙動）
    expect(afterCap).toBeGreaterThan(justEntered);
    // 🔴 旧実装は一定時間後に固定されて、それ以上待っても数字が変わらない（今回のクレームの原因）
    expect(afterCap).toBe(muchLater);
  });

  it("新実装：同じ経過時間でも、最後のフェーズに入った後、時間とともに表示が増え続ける", () => {
    const expectedMs = 16000; // 旧実装の 4 phases × 4000ms 相当
    const phaseCount = 4;
    const start = Date.now();

    vi.advanceTimersByTime(expectedMs * 0.75 + 10); // 最後のフェーズに入った直後
    const elapsedA = Date.now() - start;
    expect(resolvePhaseIndex(elapsedA, expectedMs, phaseCount)).toBe(phaseCount - 1);
    const pctA = computeAsymptoticPct(elapsedA, expectedMs);

    vi.advanceTimersByTime(expectedMs * 0.88 + 1000);
    const elapsedB = Date.now() - start;
    const pctB = computeAsymptoticPct(elapsedB, expectedMs);

    vi.advanceTimersByTime(60_000);
    const elapsedC = Date.now() - start;
    const pctC = computeAsymptoticPct(elapsedC, expectedMs);

    // 新実装は旧実装と違い、同じ経過シナリオでも増え続ける
    expect(pctB).toBeGreaterThan(pctA);
    expect(pctC).toBeGreaterThan(pctB);
    // かつ、どの時点でも95%は超えない
    expect(pctC).toBeLessThan(PROGRESS_CAP_PCT);
  });

  it("新実装：現実的な遅延範囲（目安の1〜2倍）でも整数丸めの表示が複数回変化する（旧実装は数秒でフリーズする）", () => {
    const expectedMs = 20000;
    const start = Date.now();

    const samples: number[] = [];
    // 最後のフェーズ開始（3/4*expectedMs）〜2倍の経過まで、5秒刻みでサンプリング
    for (let elapsed = expectedMs * 0.75; elapsed <= expectedMs * 2; elapsed += 5000) {
      vi.setSystemTime(start + elapsed);
      samples.push(Math.round(computeAsymptoticPct(Date.now() - start, expectedMs)));
    }
    const distinctValues = new Set(samples);
    // 旧実装は最後のフェーズに入って ~3.5秒 でフリーズするため、この長さのサンプル列で
    // 複数の異なる整数値が出ることはない。新実装は明確に複数の値へ変化する。
    expect(distinctValues.size).toBeGreaterThan(3);
  });
});
