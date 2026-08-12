// src/lib/personalOkr/availablePeriods.ts
//
// 【設計意図】
// 個人OKRビューの「対象期」（年・四半期）にヒットするKRが0件のとき、
// 「{年}年{Q}の個人KRがまだありません」と出すだけでは、取込が別の年度・四半期に
// 書き込まれてしまった場合（AIのfiscal_year/quarter誤抽出・入力ミス等）に利用者が
// 詰む（CLAUDE.md Section 24・2026-08-12の個人OKR画面調査で指摘）。
// このファイルは「実際にKRが存在する年度・四半期の一覧」を返す純粋関数のみを持つ
// （UIのボタン描画はPersonalOkrView.tsx側の責務）。

import type { PersonalKr, Quarter } from "../localData/types";

export interface PersonalKrPeriod {
  fiscalYear: number;
  quarter: Quarter;
  /** その期に属する（論理削除されていない）個人KRの件数 */
  count: number;
}

const QUARTER_ORDER: Record<Quarter, number> = { "1Q": 0, "2Q": 1, "3Q": 2, "4Q": 3 };

/**
 * 論理削除されていない個人KRから、実際にデータが存在する（年度・四半期）の一覧を返す。
 * 新しい期が先頭になるよう降順（年→四半期）でソートする。
 */
export function listAvailablePersonalKrPeriods(krs: PersonalKr[]): PersonalKrPeriod[] {
  const counts = new Map<string, PersonalKrPeriod>();
  for (const kr of krs) {
    if (kr.is_deleted) continue;
    const key = `${kr.fiscal_year}::${kr.quarter}`;
    const existing = counts.get(key);
    if (existing) existing.count++;
    else counts.set(key, { fiscalYear: kr.fiscal_year, quarter: kr.quarter, count: 1 });
  }
  return Array.from(counts.values()).sort((a, b) =>
    b.fiscalYear - a.fiscalYear || QUARTER_ORDER[b.quarter] - QUARTER_ORDER[a.quarter]);
}
