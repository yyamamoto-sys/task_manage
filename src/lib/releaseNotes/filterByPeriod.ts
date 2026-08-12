// src/lib/releaseNotes/filterByPeriod.ts
//
// 【設計意図】
// バージョン履歴モーダルの「期間で絞り込む」「この期間の内容をコピー」を担う純粋関数。
// UI（VersionHistoryModal.tsx）から計算ロジックを分離し、テストで固定する
// （CLAUDE.md Section 5・weekLayout.ts等と同じ「純粋関数に切り出す」流儀）。

import type { ReleaseNoteEntry } from "../releaseNotes";

export interface ReleaseNotesPeriod {
  /** YYYY-MM-DD。null または空文字列は「下限なし」 */
  start: string | null;
  /** YYYY-MM-DD。null または空文字列は「上限なし」 */
  end: string | null;
}

/**
 * "YYYY-MM-DD" を比較可能な数値（時刻）に変換する。不正な文字列（空・パース不能）は null を返す。
 * new Date("YYYY-MM-DD") は不正な形式でも Invalid Date を返すだけで例外を投げないため、
 * isNaN で明示的に判定する。
 */
function parseDateBoundary(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * 指定した期間（両端を含む）に含まれるエントリだけを返す（新しい順のまま）。
 * - start/end が null・空文字列・不正な日付文字列の場合はその側の境界を無視する
 *   （UIの日付欄が未入力・入力途中でも、絞り込み自体を諦めずもう一方の境界だけで判定する）。
 * - エントリ自身の date が不正な場合は、期間を判定できないため除外する。
 */
export function filterReleaseNotesByPeriod(
  entries: ReleaseNoteEntry[],
  period: ReleaseNotesPeriod,
): ReleaseNoteEntry[] {
  const startTime = parseDateBoundary(period.start);
  const endTime = parseDateBoundary(period.end);
  return entries.filter(entry => {
    const t = parseDateBoundary(entry.date);
    if (t === null) return false;
    if (startTime !== null && t < startTime) return false;
    if (endTime !== null && t > endTime) return false;
    return true;
  });
}

/**
 * 絞り込み済みのエントリを、Kintone等の報告書にそのまま貼れるプレーンテキストに組み立てる。
 * 装飾（絵文字の多用・罫線）はしない。日付・バージョン・タイトル・変更点の箇条書きだけの素直な形。
 * 該当0件の場合は空文字列を返す（呼び出し側でコピー可否を判定する）。
 */
export function buildReleaseNotesText(entries: ReleaseNoteEntry[]): string {
  return entries
    .map(entry => {
      const lines = [
        `${entry.date}  ${entry.version}  ${entry.title}`,
        ...entry.highlights.map(h => `- ${h}`),
      ];
      return lines.join("\n");
    })
    .join("\n\n");
}
