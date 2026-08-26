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
 * 🔴 2026-08-26以降：過去月＝編集可（計画欄・週カード・バンド決定・振り返り欄すべて）、
 * 今月＝編集可、未来月のみ「計画がまだありません」の表示（isMonthEditable参照）。
 */
export function classifyMonth(monthStart: Date, today: Date = new Date()): MonthTemporalStatus {
  const todayMonthStart = new Date(today.getFullYear(), today.getMonth(), 1).getTime();
  const t = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1).getTime();
  if (t < todayMonthStart) return "past";
  if (t > todayMonthStart) return "future";
  return "current";
}

/**
 * 月の編集可否を判定する（Section 24・2026-08-26）。過去月も含めて編集可にする。
 * readOnly（ツアーのサンプル表示中）は monthStatus に関わらず常に編集不可。
 * 未来月は「計画がまだありません」の表示のため常に編集不可。
 */
export function isMonthEditable(monthStatus: MonthTemporalStatus, readOnly: boolean): boolean {
  return !readOnly && monthStatus !== "future";
}

/**
 * 対象期（fiscalYear・quarter）における既定の月インデックスを返す。
 * 当月がこの四半期に含まれていればその月、含まれていなければ（過去・未来の四半期を見ている
 * とき）先頭の月（monthIndex=1）にする。「対象期」で月を選ぶUI（PersonalOkrView.tsx。
 * 2026-08-12・月の選択をKRをまたいで共有するようにした際に追加）の既定値決定に使う。
 */
export function resolveDefaultMonthIndex(fiscalYear: number, quarter: Quarter, today: Date = new Date()): 1 | 2 | 3 {
  const slots = quarterMonthSlots(fiscalYear, quarter);
  const current = slots.find(s => classifyMonth(s.monthStart, today) === "current");
  return current?.monthIndex ?? slots[0].monthIndex;
}

/**
 * 四半期全体の編集可否を判定する（「全体」タブ・v3.101）。isMonthEditableと同じ思想＝
 * 未来のみ不可。四半期の1か月目（month_index=1）が「未来」でなければ、その四半期は
 * 既に始まっている（過去または進行中）とみなし編集可にする。1か月目が未来＝四半期
 * そのものがまだ始まっていないときのみ不可にする（2・3か月目の状態は見ない）。
 */
export function isQuarterEditable(fiscalYear: number, quarter: Quarter, readOnly: boolean, today: Date = new Date()): boolean {
  if (readOnly) return false;
  const firstMonth = quarterMonthSlots(fiscalYear, quarter)[0].monthStart;
  return classifyMonth(firstMonth, today) !== "future";
}
