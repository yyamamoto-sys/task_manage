// src/lib/workload/workloadMetric.ts
//
// ワークロード画面の集計単位（件数／工数）と過負荷判定（v3.201・純粋関数）。
// 判定は「アクティブな負荷がある人の平均の1.5倍以上、かつ下限以上」。下限は単位ごとに持つ：
// 件数＝3件（従来どおり）／工数＝8時間（1人日。既存に工数の定数は無いため新設）。
// 0〜1件・数時間の僅差を強調表示で目立たせないための下限。

import type { MemberWorkloadRow } from "./computeWorkload";

export type WorkloadUnit = "count" | "hours";

export const OVERLOAD_MIN_COUNT = 3;
export const OVERLOAD_MIN_HOURS = 8;
export const OVERLOAD_AVG_RATIO = 1.5;

export const WORKLOAD_UNIT_STORAGE_VALUES: readonly WorkloadUnit[] = ["count", "hours"];

export function parseStoredWorkloadUnit(raw: string | null): WorkloadUnit {
  return raw === "hours" ? "hours" : "count";
}

/** バー・並び順・過負荷判定の基準値。工数モードは工数入力済みタスクの合計（未入力は0扱いせず合計に含めない） */
export function workloadValue(row: MemberWorkloadRow, unit: WorkloadUnit): number {
  return unit === "hours" ? (row.total_estimated_hours ?? 0) : row.active_count;
}

export function overloadThreshold(values: readonly number[], unit: WorkloadUnit): number {
  const withLoad = values.filter(v => v > 0);
  const avg = withLoad.length > 0 ? withLoad.reduce((s, v) => s + v, 0) / withLoad.length : 0;
  return Math.max(unit === "hours" ? OVERLOAD_MIN_HOURS : OVERLOAD_MIN_COUNT, avg * OVERLOAD_AVG_RATIO);
}

/** 並び順：基準値の降順。同値は件数の降順（工数モードで工数0同士を件数順にする） */
export function sortWorkloadRows(rows: readonly MemberWorkloadRow[], unit: WorkloadUnit): MemberWorkloadRow[] {
  return [...rows].sort((a, b) => workloadValue(b, unit) - workloadValue(a, unit) || b.active_count - a.active_count);
}

export function formatHours(h: number): string {
  return `${Math.round(h * 10) / 10}h`;
}
