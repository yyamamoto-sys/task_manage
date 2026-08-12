// src/lib/project/inheritTaskDates.ts
//
// 【設計意図】
// 「他PJから引き継ぐ」機能の日付移動計算（山本さん確定仕様・2026-08-12）。
// 旧実装（dateSlide.ts・computeSlidedDate）は「元PJ開始日→新PJ開始日」の相対日数を
// 常に保つ設計だったが、新仕様では基準（アンカー）を「マイルストーン／元PJ開始日／
// 引き継がない」の中から選べるようにする。dateSlide.ts はこのファイルに統合し撤去する
// （利用箇所は taskInheritance.ts のみだったため影響なし）。
//
// 基準の「元の日付→新しい日付」の符号付き差分（暦日）を1回だけ求め（computeInheritOffsetDays）、
// 各タスク・マイルストーンの日付にそのまま加算する（shiftDateByOffset）。
// 暦日計算（土日祝を飛ばさない）は既存のB3 computeCascadeShifts・B4 resolveBaselineFieldsと
// 同じ流儀に揃える。日付の文字列化・パースは src/lib/date.ts の addDays/diffDays/toDate/toDateStr
// を使う（タイムゾーンのずれを避けるため。diffDays は文字列を toDate() 経由で統一してから
// 差分を取る実装になっている＝ new Date("YYYY-MM-DD") のUTC解釈とのずれを防ぐ既存の対策）。

import { addDays, diffDays, toDate, toDateStr } from "../date";

/**
 * 基準の元日付→新日付の符号付きオフセット（暦日）を求める。
 * どちらか欠けている場合は null（オフセット未確定＝呼び出し側は移動しない・保存不可扱いにする）。
 */
export function computeInheritOffsetDays(
  originAnchorDate: string | null,
  newAnchorDate: string | null,
): number | null {
  if (!originAnchorDate || !newAnchorDate) return null;
  return diffDays(originAnchorDate, newAnchorDate);
}

/**
 * 1つの日付にオフセット（暦日）を加算する。
 * date が無ければ null のまま（開始日か期日の片方しか無いタスクは、設定されている方だけ
 * 移動させる仕様に対応）。
 */
export function shiftDateByOffset(date: string | null, offsetDays: number): string | null {
  if (!date) return null;
  if (offsetDays === 0) return date;
  const d = toDate(date);
  if (!d) return date; // 不正な日付文字列の安全策（通常は発生しない）
  return toDateStr(addDays(d, offsetDays));
}

/**
 * タスク1件の start_date/due_date に日付移動を適用する。
 * offsetDays が null（＝「日付を引き継がない」を選んだ場合）は、両方 null にする
 * （タスクの日付は nullable なので、引き継がないとはそのまま「日付無し」を意味する）。
 */
export function computeInheritedTaskDates(params: {
  offsetDays: number | null;
  startDate: string | null;
  dueDate: string | null;
}): { start_date: string | null; due_date: string | null } {
  const { offsetDays, startDate, dueDate } = params;
  if (offsetDays === null) return { start_date: null, due_date: null };
  return {
    start_date: shiftDateByOffset(startDate, offsetDays),
    due_date: shiftDateByOffset(dueDate, offsetDays),
  };
}

/**
 * マイルストーン1件の date に日付移動を適用する。
 * マイルストーンの date は DB上 NOT NULL のため、タスクと違い「引き継がない」を
 * 「日付を消す」で表現できない。offsetDays が null（＝「日付を引き継がない」選択時）は
 * 元の日付をそのまま（シフトせず）コピーする——「移動先の基準が無い以上、動かすより
 * 元の値をそのまま残す方が安全側」という dateSlide.ts 旧実装の判断を引き継ぐ。
 */
export function computeInheritedMilestoneDate(params: {
  offsetDays: number | null;
  date: string;
}): string {
  const { offsetDays, date } = params;
  if (offsetDays === null) return date;
  return shiftDateByOffset(date, offsetDays) ?? date;
}
