// src/lib/progress/progressCurve.ts
//
// 【設計意図】
// AIProgressLoader（AI生成中の疑似進捗）とSaveProgressLoader（DB保存の実進捗の演出）が
// 共有する計算ロジック。AI呼び出しはストリーミングしていないため「本当の進捗」は
// 取得できない（トークン生成の途中経過が分からない）。そのため経過時間から
// 「止まらない・95%を超えない」漸近曲線で進捗を演出する。
//
// pct = cap × (1 − exp(−t / τ))
//
// cap（既定95）に対して τ = expectedMs / 2 とすると、t=expectedMs で約82%、
// t=2×expectedMsで約93%になる（設計メモどおり）。この関数は時間が経つほど
// capに近づくが、どれだけ待ってもcapを超えない（数学的な漸近線のため）。
//
// 🔴 パーセント表示だけに「止まらない」ことを担わせない。
// 待ち時間が長引くと漸近曲線の増分は指数的に小さくなり、割合の表示は
// 実用上ほぼ静止して見える瞬間が来る（これは数式の性質であり、上限を超えず
// かつ永久に知覚できる速さで動き続けることは数学的に両立しない）。
// 経過秒数（computeElapsedSeconds）は実時間に比例して単調に増え続けるため、
// 「処理が止まっていない」ことの最終的な保証はこちらが担う。

export const PROGRESS_CAP_PCT = 95;

/**
 * 経過時間から漸近的な進捗（0以上・capPct未満）を計算する。
 * capPctに到達も超過もしない（数学的な漸近線）。
 */
export function computeAsymptoticProgress(
  elapsedMs: number,
  expectedMs: number,
  capPct: number = PROGRESS_CAP_PCT,
): number {
  const safeExpected = Math.max(1, expectedMs);
  const tau = safeExpected / 2;
  const t = Math.max(0, elapsedMs);
  const raw = capPct * (1 - Math.exp(-t / tau));
  // 浮動小数点の丸めで `1 - exp(-x)` が厳密に1になる（極端に長い待ち時間で
  // capPctと完全一致してしまう）ケースへの安全網。数式上は漸近線で決してcapPctに
  // 到達しないため、常にcapPct未満を保証する。
  return Math.min(raw, capPct - 1e-6);
}

/** AIProgressLoader用の既定cap（95%）を使う漸近進捗。 */
export function computeAsymptoticPct(elapsedMs: number, expectedMs: number): number {
  return computeAsymptoticProgress(elapsedMs, expectedMs, PROGRESS_CAP_PCT);
}

/**
 * 経過時間からフェーズindexを求める。expectedMsに比例した間隔で進み、
 * 最後のフェーズに達したらそこで止まる（マイナスにも配列外にもならない）。
 * フェーズ文言は止まっても、pct・経過秒数は呼び出し側で別途進み続ける。
 */
export function resolvePhaseIndex(elapsedMs: number, expectedMs: number, phaseCount: number): number {
  if (phaseCount <= 0) return 0;
  const safeExpected = Math.max(1, expectedMs);
  const perPhase = safeExpected / phaseCount;
  const idx = Math.floor(Math.max(0, elapsedMs) / perPhase);
  return Math.min(phaseCount - 1, Math.max(0, idx));
}

/** 経過秒数（切り捨て）。実時間に比例するため、どれだけ待っても増え続ける。 */
export function computeElapsedSeconds(elapsedMs: number): number {
  return Math.floor(Math.max(0, elapsedMs) / 1000);
}

/** 経過時間が「目安の上限×1.5」を超えたか（エラー扱いにはしない。補足文の切替にのみ使う）。 */
export function isTakingLongerThanUsual(elapsedMs: number, expectedMaxMs: number): boolean {
  return elapsedMs > Math.max(1, expectedMaxMs) * 1.5;
}

/**
 * 目安の範囲（秒）を求める。明示的な範囲（ms）が渡されればそれを使い、
 * 省略時は expectedMs の 2/3〜4/3 倍から見やすい5秒刻みに丸めて算出する
 * （例：expectedMs=30000 → 20〜40秒）。
 */
export function resolveExpectedRangeSeconds(
  expectedMs: number,
  rangeMs?: readonly [number, number],
): [number, number] {
  if (rangeMs) {
    return [Math.max(0, Math.round(rangeMs[0] / 1000)), Math.max(0, Math.round(rangeMs[1] / 1000))];
  }
  const roundTo5Sec = (ms: number) => Math.max(5, Math.round(ms / 1000 / 5) * 5);
  const min = roundTo5Sec(expectedMs * (2 / 3));
  const max = roundTo5Sec(expectedMs * (4 / 3));
  return [min, Math.max(max, min + 5)];
}
