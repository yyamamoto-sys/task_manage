// src/lib/personalOkr/quarterMonths.ts
//
// 【設計意図】
// 個人四半期KR（fiscal_year + quarter）が持つ3つの月（personal_kr_months.month_index 1/2/3）
// の月初日付を計算する純粋関数。四半期の定義はCLAUDE.md Section 6-14
// （1Q=1〜3月／2Q=4〜6月／3Q=7〜9月／4Q=10〜12月）に一元化して従う（新しい定義を作らない）。

import type { Quarter } from "../localData/types";

const QUARTER_START_MONTH: Record<Quarter, number> = { "1Q": 0, "2Q": 3, "3Q": 6, "4Q": 9 };

export interface QuarterMonthSlot {
  monthIndex: 1 | 2 | 3;
  monthStart: Date;
}

/** 指定の会計年度・四半期に属する3つの月（month_index 1〜3）の月初日付を返す */
export function quarterMonthSlots(fiscalYear: number, quarter: Quarter): QuarterMonthSlot[] {
  const startMonth = QUARTER_START_MONTH[quarter];
  return [1, 2, 3].map(i => ({
    monthIndex: i as 1 | 2 | 3,
    monthStart: new Date(fiscalYear, startMonth + i - 1, 1),
  }));
}

/** Date（月初想定）→ "YYYY-MM-01" 文字列。personal_kr_months.month の保存・比較に使う */
export function monthToDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

export type MonthTemporalStatus = "past" | "current" | "future";

/**
 * 対象月（月初Date）が「今日」から見て過去・今月・未来のどれかを判定する。
 * 過去月＝読み取り専用、今月＝編集可、未来月＝「計画がまだありません」の表示（Phase 1方針）。
 */
export function classifyMonth(monthStart: Date, today: Date = new Date()): MonthTemporalStatus {
  const todayMonthStart = new Date(today.getFullYear(), today.getMonth(), 1).getTime();
  const t = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1).getTime();
  if (t < todayMonthStart) return "past";
  if (t > todayMonthStart) return "future";
  return "current";
}
