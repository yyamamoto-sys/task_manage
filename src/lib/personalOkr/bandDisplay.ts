// src/lib/personalOkr/bandDisplay.ts
//
// 【設計意図】
// 達成度バンドは3つの値を区別して持つ（docs/dev/okr-redesign-plan.md §6）：
//   band_target   … Kintoneに書いた当月の「狙い」
//   band_ai       … AIの「見通し」（月の途中でも出す。Phase 3後半で実装済み）
//   band_override … 人が決めた「決定」
// 🔴 この3つを混ぜて表示しないこと（混ぜると「AIが人事評価を付けた」ことになる）。
// 表示の優先順位は band_override（決定） > band_ai（見通し） > band_target（狙い）。
// 🔴 band_override が入っていれば、band_ai の値は以後表示に一切使わない（計画書§6）。
// band_ai は「見通し」であって「評価」ではないため、人の決定を上書きする力を持たない。

import type { PersonalKrBand } from "../localData/types";

export type BandDisplaySource = "override" | "ai" | "target" | "none";

export interface BandDisplay {
  value: PersonalKrBand | null;
  source: BandDisplaySource;
}

/**
 * band_override があればそれ、無ければ band_ai、どちらも無ければ band_target。
 * 全て無ければ none/null。
 */
export function resolveBandDisplay(
  bandOverride: PersonalKrBand | null | undefined,
  bandAi: PersonalKrBand | null | undefined,
  bandTarget: PersonalKrBand | null | undefined,
): BandDisplay {
  if (bandOverride != null) return { value: bandOverride, source: "override" };
  if (bandAi != null) return { value: bandAi, source: "ai" };
  if (bandTarget != null) return { value: bandTarget, source: "target" };
  return { value: null, source: "none" };
}
