// src/components/gantt/ganttUtils.ts
// ガントビュー共通の定数・型・純粋関数

import type { Task, Milestone } from "../../lib/localData/types";
import { toDate, toDateStr, diffDays, addDays } from "../../lib/date";

export const DAY_WIDTH_DEFAULT = 28;
export const ZOOM_LEVELS = [14, 20, 28, 36, 48] as const;
export const STAGNANT_THRESHOLD_DAYS = 5;
export const TODO_COLOR = "#6ee7b7";
export const MS_COLOR   = "#f59e0b";
export const MS_BORDER  = "#d97706";

export type GanttSortOrder = "date" | "name";

export function isTaskStagnant(task: Task, now = Date.now()): boolean {
  if (task.status !== "in_progress" || !task.updated_at) return false;
  const diffMs = now - new Date(task.updated_at).getTime();
  return diffMs / (1000 * 60 * 60 * 24) >= STAGNANT_THRESHOLD_DAYS;
}

export function calcTaskBar(task: Task, rangeStart: Date, dayWidth: number): { barX: number; barWidth: number } | null {
  const due = toDate(task.due_date);
  if (!due) return null;
  const start = toDate(task.start_date ?? null);
  if (start && start <= due) {
    const barX = diffDays(rangeStart, start) * dayWidth;
    const barWidth = Math.max((diffDays(start, due) + 1) * dayWidth - 4, dayWidth - 4);
    return { barX, barWidth };
  }
  return { barX: diffDays(rangeStart, due) * dayWidth, barWidth: dayWidth - 4 };
}

// ===== B4：ベースライン（当初計画）差分 =====

/**
 * タスクのベースライン（baseline_start_date/baseline_due_date）の位置を計算する。
 * calcTaskBar を「ベースライン日付を差し込んだ仮タスク」で呼ぶだけ（座標計算ロジックの二重化を避ける）。
 * ベースライン未凍結（片方または両方 null）なら null。
 */
export function calcGhostBar(task: Task, rangeStart: Date, dayWidth: number): { barX: number; barWidth: number } | null {
  if (!task.baseline_start_date || !task.baseline_due_date) return null;
  return calcTaskBar({ ...task, start_date: task.baseline_start_date, due_date: task.baseline_due_date }, rangeStart, dayWidth);
}

/**
 * 現在の期日 − 当初計画（baseline）の期日（暦日）。正=遅延、負=前倒し。
 * ベースライン未凍結、または現在の期日が未設定なら null。
 */
export function computeDelayDays(task: Task): number | null {
  if (!task.baseline_due_date || !task.due_date) return null;
  return diffDays(task.baseline_due_date, task.due_date);
}

/** 遅延日数 → 表示ラベル。0（差分なし）は非表示（null）。 */
export function formatDelayLabel(delayDays: number | null): string | null {
  if (delayDays === null || delayDays === 0) return null;
  return delayDays > 0 ? `遅延${delayDays}日` : `${Math.abs(delayDays)}日前倒し`;
}

// ===== ヘッダー週ラベル（月内日数ブロック方式） =====
//
// 【設計方針】週の数え方は「月内の日数ブロック」で固定（山本さん確定・カレンダー週や暦週とは異なる）：
// W1=1〜7日／W2=8〜14日／W3=15〜21日／W4=22〜28日／W5=29日〜月末。各週は必ずその月に属し、
// 月をまたいだ瞬間に翌月のW1から数え直す（days は getDaysInRange の連続日付配列前提で、
// 年+月+週番号が変わったところでブロックを区切るだけで自然にこの定義になる）。
export interface WeekBlock {
  /** 例："8月W1" */
  label: string;
  startX: number;
  width: number;
  /** そのブロックが月の最初の週（W1）＝月の境界。ヘッダーの区切り線の強調に使う */
  isMonthStart: boolean;
}

export function computeWeekBlocks(days: Date[], dayWidth: number): WeekBlock[] {
  const blocks: WeekBlock[] = [];
  let i = 0;
  while (i < days.length) {
    const d = days[i];
    const year = d.getFullYear();
    const month = d.getMonth();
    const weekNum = Math.floor((d.getDate() - 1) / 7) + 1; // 1〜5
    let j = i + 1;
    while (j < days.length) {
      const dj = days[j];
      if (dj.getFullYear() !== year || dj.getMonth() !== month) break;
      if (Math.floor((dj.getDate() - 1) / 7) + 1 !== weekNum) break;
      j++;
    }
    blocks.push({
      label: `${month + 1}月W${weekNum}`,
      startX: i * dayWidth,
      width: (j - i) * dayWidth,
      isMonthStart: weekNum === 1,
    });
    i = j;
  }
  return blocks;
}

/**
 * 週コラム境界（週ブロックの開始x座標）の一覧。月初（W1＝月の境界）は borderDays 側の
 * 太い境界線が既に引かれているため対象外にする（同じ位置に二重線を描かない）。
 * 淡い列グリッドはこの関数が返す x 座標にだけ描く。
 */
export function computeWeekGridLines(weekBlocks: WeekBlock[]): number[] {
  return weekBlocks.filter(wb => !wb.isMonthStart).map(wb => wb.startX);
}

// ===== マイルストーン帯（PJ内・スクロールしても埋もれないようにする視認補助） =====

/**
 * マイルストーンの帯色を1箇所から取得する。現状は全マイルストーン共通の MS_COLOR だが、
 * 将来マイルストーンごとに個別色を持つようになったら、ここだけ変更すれば帯・◆印の色が揃う。
 */
export function getMilestoneBandColor(_ms: Milestone): string {
  return MS_COLOR;
}

export interface MilestoneBand {
  x: number;
  color: string;
}

/**
 * 同じPJ内のマイルストーンから、帯を描く対象日の x 座標一覧を計算する（純粋関数）。
 * 同一日に複数マイルストーンがあっても帯は1本だけ描く（重ねて濃くなりすぎるのを防ぐため、
 * 日付で重複除去する。色は最初に見つかった1件の色を採用する）。
 */
export function computeMilestoneBands(pjMilestones: Milestone[], rangeStart: Date, dayWidth: number): MilestoneBand[] {
  const seen = new Map<string, MilestoneBand>();
  for (const ms of pjMilestones) {
    const d = toDate(ms.date);
    if (!d) continue;
    const key = toDateStr(d);
    if (seen.has(key)) continue;
    seen.set(key, { x: diffDays(rangeStart, d) * dayWidth, color: getMilestoneBandColor(ms) });
  }
  return [...seen.values()];
}

// ===== バー端リサイズ（右端＝期日／左端＝開始日） =====

/** ドラッグ中のプレビュー日付。start/dueそれぞれ片方だけ書き換えている最中の状態を表す */
export interface ResizePreview {
  start?: string;
  due?: string;
}

/** プレビュー中の日付をタスクにマージした「実効タスク」を返す。preview が無ければ task をそのまま返す */
export function applyResizePreview(task: Task, preview: ResizePreview | undefined): Task {
  if (!preview) return task;
  return {
    ...task,
    ...(preview.start !== undefined ? { start_date: preview.start } : {}),
    ...(preview.due !== undefined ? { due_date: preview.due } : {}),
  };
}

/** 左端ドラッグ（開始日変更）のクランプ：開始日が期日を超えないようにする（同日は許可） */
export function clampStartDate(candidateStartDate: string, dueDate: string): string {
  return candidateStartDate > dueDate ? dueDate : candidateStartDate;
}

// ===== バー中央ドラッグ（タスク全体の移動） =====

/**
 * バー中央ドラッグによる全体移動：start_date/due_date を同じ日数だけシフトする（duration保持）。
 * origStartDate が null（期日のみタスク）の場合は due_date だけシフトする。
 * deltaDays===0 または origDueDate が無効な日付なら {}（プレビュー・保存とも no-op として扱われる）。
 */
export function computeMoveShift(origStartDate: string | null, origDueDate: string, deltaDays: number): ResizePreview {
  if (deltaDays === 0) return {};
  const due = toDate(origDueDate);
  if (!due) return {};
  const newDue = toDateStr(addDays(due, deltaDays));
  if (!origStartDate) return { due: newDue };
  const start = toDate(origStartDate);
  if (!start) return { due: newDue };
  return { start: toDateStr(addDays(start, deltaDays)), due: newDue };
}

// ===== 複数選択の一括シフト =====

export interface BulkMoveShift {
  taskId: string;
  oldStart: string | null;
  oldDue: string;
  newStart: string | null;
  newDue: string;
}

/**
 * 選択中の複数タスクを同じ日数だけシフトする際の、各タスクの新旧日付をまとめて計算する（純粋関数）。
 * 内部で computeMoveShift を1件ずつ適用するだけ（ロジックの二重化を避ける）。完了(done)・削除済み・
 * 期日未設定のタスクは対象外にする（バー中央ドラッグの単体移動と同じ「doneはシフト対象外」ルールを
 * ここ1箇所に集約する）。
 */
export function computeBulkMoveShifts(tasks: Task[], deltaDays: number): BulkMoveShift[] {
  if (deltaDays === 0) return [];
  const result: BulkMoveShift[] = [];
  for (const task of tasks) {
    if (task.status === "done" || task.is_deleted || !task.due_date) continue;
    const shift = computeMoveShift(task.start_date ?? null, task.due_date, deltaDays);
    if (Object.keys(shift).length === 0) continue;
    result.push({
      taskId: task.id,
      oldStart: task.start_date ?? null,
      oldDue: task.due_date,
      newStart: shift.start ?? null,
      newDue: shift.due!,
    });
  }
  return result;
}
