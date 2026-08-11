// src/lib/personalOkr/bandDisplay.ts
//
// 【設計意図】
// 達成度バンドは3つの値を区別して持つ（docs/dev/okr-redesign-plan.md §6）：
//   band_target   … Kintoneに書いた当月の「狙い」
//   band_ai       … AIの「見通し」（月の途中でも出す。Phase 3後半で実装。今回は常に無い）
//   band_override … 人が決めた「決定」
// 🔴 この3つを混ぜて表示しないこと（混ぜると「AIが人事評価を付けた」ことになる）。
// 表示は band_override があればそれ、無ければ band_target。band_ai はPhase 3前半では
// まだ計算しない（personal_kr_outlooksへの書き込みが無い）ため、常に resolveBandDisplay の
// 対象外——「AI判定」バッジの位置はUI側（AheadBlock.tsx）で空き枠として用意するだけに留める。

import type { PersonalKrBand } from "../localData/types";

export type BandDisplaySource = "override" | "target" | "none";

export interface BandDisplay {
  value: PersonalKrBand | null;
  source: BandDisplaySource;
}

/** band_override があればそれ、無ければ band_target。どちらも無ければ none/null */
export function resolveBandDisplay(
  bandOverride: PersonalKrBand | null | undefined,
  bandTarget: PersonalKrBand | null | undefined,
): BandDisplay {
  if (bandOverride != null) return { value: bandOverride, source: "override" };
  if (bandTarget != null) return { value: bandTarget, source: "target" };
  return { value: null, source: "none" };
}
