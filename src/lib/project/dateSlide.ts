// src/lib/project/dateSlide.ts
//
// 【設計意図】
// プロジェクト作成時の「他PJからタスクを引き継ぐ」機能（山本さん確定仕様）の日付スライド計算。
// 元PJの開始日からの相対日数を保ったまま、新PJの開始日を基準に平行移動する
// （例：元PJ開始日の3日後が期日のタスクは、新PJ開始日の3日後が期日になる）。
// 暦日計算（土日祝を飛ばさない・既存のB3自動リスケ連鎖と同じ流儀）。

import { addDays, diffDays, toDate, toDateStr } from "../date";

export interface SlideDateParams {
  /** 元PJの開始日（無ければ相対日数の基準が取れない） */
  originStartDate: string | null;
  /** 新PJの開始日（基準日） */
  newStartDate: string;
  /** スライド対象の元タスクの日付（start_date または due_date） */
  originalDate: string | null;
}

/**
 * 引き継ぎ元タスクの1つの日付を、新PJの開始日基準にスライドする。
 *
 * - originalDate が無ければ null（日付の無いタスクは日付無しのまま引き継ぐ）
 * - originStartDate（元PJの開始日）が無ければ、相対日数の基準が取れないため
 *   originalDate をそのまま返す（シフトしない＝日付を消してしまうより安全側に倒す）
 * - 両方揃っていれば、元PJ開始日からの相対日数（負値も可＝PJ開始前の日付）を
 *   新PJ開始日に足した日付を返す。start_date/due_date の両方に同じ関数を使うため、
 *   タスクの作業期間（due-start）は自動的に保持される
 */
export function computeSlidedDate(params: SlideDateParams): string | null {
  const { originStartDate, newStartDate, originalDate } = params;
  if (!originalDate) return null;
  if (!originStartDate) return originalDate;
  const offsetDays = diffDays(originStartDate, originalDate);
  const newStart = toDate(newStartDate);
  if (!newStart) return originalDate; // newStartDate が不正な場合の安全策（通常は発生しない）
  return toDateStr(addDays(newStart, offsetDays));
}
