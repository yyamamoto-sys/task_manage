// src/lib/workload/weekGrid.ts
//
// ワークロードの「週グリッド」（行＝担当者、列＝週。v3.205）の集計と、チップをマスへドラッグしたときの
// 更新内容の計算（純粋関数）。週は月曜始まり。日付は "YYYY-MM-DD" 文字列を UTC で数える
// （ブラウザのタイムゾーンや夏時間で日付がずれない）。
// 集計の対象は ワークロード本体と同じ「アクティブ（todo／進行中）・削除なし」のタスク。
// 共同担当のタスクは各担当者の行に出す（ワークロード本体の数え方と同じ）。

import type { Task } from "../localData/types";
import { getAssigneeIds, isActiveTaskStatus } from "../taskMeta";
import { UNASSIGNED_KEY, assigneePatch, moveAssigneeIds } from "../task/assigneeMove";
import { overloadThreshold, type WorkloadUnit } from "./workloadMetric";

export const WEEK_COUNT_OPTIONS = [4, 8, 12] as const;
export type WeekCount = typeof WEEK_COUNT_OPTIONS[number];
export const WEEK_COUNT_DEFAULT: WeekCount = 8;

export type WorkloadViewMode = "list" | "week";

export function parseStoredWorkloadViewMode(raw: string | null): WorkloadViewMode {
  return raw === "week" ? "week" : "list";
}
export function parseStoredWeekCount(raw: string | null): WeekCount {
  const n = Number(raw);
  return (WEEK_COUNT_OPTIONS as readonly number[]).includes(n) ? (n as WeekCount) : WEEK_COUNT_DEFAULT;
}

// ----- 日付（UTC 暦日） -----
const DAY_MS = 86_400_000;
function ymdToUtc(s: string): number {
  const [y, m, d] = s.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}
function utcToYmd(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getUTCFullYear()).padStart(4, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
export function addDaysYmd(s: string, n: number): string {
  return utcToYmd(ymdToUtc(s) + n * DAY_MS);
}
/** その日を含む週の月曜日 */
export function mondayOf(s: string): string {
  const dow = new Date(ymdToUtc(s)).getUTCDay(); // 0=日
  return addDaysYmd(s, -((dow + 6) % 7));
}
/** 週の月曜 start から数えて date が何週目か（0始まり。start より前は負） */
export function weekIndexOf(date: string, startMonday: string): number {
  return Math.floor((ymdToUtc(date) - ymdToUtc(startMonday)) / DAY_MS / 7);
}

// ----- 集計 -----
export interface WeekCell {
  tasks: Task[];
  count: number;
  /** 工数入力済みタスクの合計（未入力は含めない） */
  hours: number;
  withoutEstimate: number;
}
export interface WeekGridRow {
  /** メンバー id または UNASSIGNED_KEY */
  key: string;
  cells: WeekCell[];
  /** 期日なし（件数だけ別枠で出す） */
  noDue: Task[];
  /** 期日はあるが表示する週の範囲外（期限超過や、さらに先の期日） */
  outOfRange: Task[];
}
export interface WeekGrid {
  weeks: string[];
  rows: WeekGridRow[];
}

const emptyCell = (): WeekCell => ({ tasks: [], count: 0, hours: 0, withoutEstimate: 0 });

/** memberIds の順に行を作り、最後に未割り当て行を足す */
export function buildWeekGrid(tasks: readonly Task[], memberIds: readonly string[], startMonday: string, weekCount: number): WeekGrid {
  const weeks = Array.from({ length: weekCount }, (_, i) => addDaysYmd(startMonday, i * 7));
  const rowKeys = [...memberIds, UNASSIGNED_KEY];
  const rows = new Map<string, WeekGridRow>(rowKeys.map(k => [k, {
    key: k, cells: weeks.map(emptyCell), noDue: [], outOfRange: [],
  }]));
  for (const t of tasks) {
    if (t.is_deleted || !isActiveTaskStatus(t.status)) continue;
    const ids = getAssigneeIds(t);
    const keys = ids.length === 0 ? [UNASSIGNED_KEY] : ids.filter(id => rows.has(id));
    for (const k of keys) {
      const row = rows.get(k)!;
      if (!t.due_date) { row.noDue.push(t); continue; }
      const w = weekIndexOf(t.due_date, startMonday);
      if (w < 0 || w >= weekCount) { row.outOfRange.push(t); continue; }
      const cell = row.cells[w];
      cell.tasks.push(t);
      cell.count += 1;
      if (t.estimated_hours != null) cell.hours += t.estimated_hours; else cell.withoutEstimate += 1;
    }
  }
  return { weeks, rows: rowKeys.map(k => rows.get(k)!) };
}

export function cellValue(cell: WeekCell, unit: WorkloadUnit): number {
  return unit === "hours" ? cell.hours : cell.count;
}

/** 過負荷の色分けの基準。ワークロード本体と同じ式（平均の1.5倍以上かつ下限＝件数3／工数8h）をマス単位で当てる。未割り当て行は人ではないので基準に入れない */
export function weekGridOverloadThreshold(grid: WeekGrid, unit: WorkloadUnit): number {
  const values: number[] = [];
  for (const row of grid.rows) {
    if (row.key === UNASSIGNED_KEY) continue;
    for (const c of row.cells) values.push(cellValue(c, unit));
  }
  return overloadThreshold(values, unit);
}

/**
 * チップを別のマスへ落としたときの更新内容。変化なしは null。
 * 行が変わる＝担当者の入れ替え（カンバンと同じ moveAssigneeIds）／列が変わる＝期日と（あれば）開始日を週の差×7日ずらす。
 */
export function computeWeekGridDrop(
  task: Pick<Task, "assignee_member_id" | "assignee_member_ids" | "start_date" | "due_date">,
  fromRowKey: string, toRowKey: string, fromWeek: number, toWeek: number,
): Partial<Task> | null {
  const patch: Partial<Task> = {};
  const ids = moveAssigneeIds(getAssigneeIds(task), fromRowKey, toRowKey);
  if (ids) Object.assign(patch, assigneePatch(ids));
  const delta = (toWeek - fromWeek) * 7;
  if (delta !== 0 && task.due_date) {
    patch.due_date = addDaysYmd(task.due_date, delta);
    if (task.start_date) patch.start_date = addDaysYmd(task.start_date, delta);
  }
  return Object.keys(patch).length > 0 ? patch : null;
}
