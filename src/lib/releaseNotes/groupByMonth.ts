// src/lib/releaseNotes/groupByMonth.ts
//
// 【設計意図】
// バージョン履歴モーダルの「月ごとの見出しで区切る」「直近2か月だけ開いた状態にする」を担う
// 純粋関数。UI（VersionHistoryModal.tsx）から計算ロジックを分離し、テストで固定する
// （filterByPeriod.ts と同じ「純粋関数に切り出す」流儀。CLAUDE.md Section 29参照）。

import type { ReleaseNoteEntry } from "../releaseNotes";

export interface ReleaseNoteMonthGroup {
  /** "YYYY-MM" */
  monthKey: string;
  /** "YYYY年M月" の表示ラベル */
  label: string;
  entries: ReleaseNoteEntry[];
}

/** "YYYY-MM-DD" → "YYYY-MM"。不正な文字列は先頭7文字をそのまま返す（呼び出し側で
 *  filterReleaseNotesByPeriod により date不正なエントリは事前に除外されているため、
 *  実運用でこの分岐に入ることは無い防御的処理）。 */
export function monthKeyOf(dateStr: string): string {
  return dateStr.slice(0, 7);
}

/** "YYYY-MM" → "YYYY年M月"。形式が不正な場合はそのまま返す。 */
export function monthLabelOf(monthKey: string): string {
  const parts = monthKey.split("-");
  const year = parts[0];
  const monthNum = Number(parts[1]);
  if (!year || !parts[1] || Number.isNaN(monthNum) || monthNum < 1 || monthNum > 12) return monthKey;
  return `${year}年${monthNum}月`;
}

function formatMonthKey(year: number, monthIndex0: number): string {
  return `${year}-${String(monthIndex0 + 1).padStart(2, "0")}`;
}

/**
 * 新しい順（日付降順）に並んだエントリを、月ごとの連続したグループへ区切る。
 * RELEASE_NOTESは常に新しい順のため、同じ月のエントリは連続して現れる前提で、
 * 隣接するエントリだけを1グループにまとめる（月をまたいで同じ月が再度現れても別グループになる。
 * 実データでは日付降順のため発生しないが、これは意図的な仕様＝表示順を尊重するため）。
 */
export function groupReleaseNotesByMonth(entries: ReleaseNoteEntry[]): ReleaseNoteMonthGroup[] {
  const groups: ReleaseNoteMonthGroup[] = [];
  for (const entry of entries) {
    const monthKey = monthKeyOf(entry.date);
    const last = groups[groups.length - 1];
    if (last && last.monthKey === monthKey) {
      last.entries.push(entry);
    } else {
      groups.push({ monthKey, label: monthLabelOf(monthKey), entries: [entry] });
    }
  }
  return groups;
}

/**
 * 月ごとの折りたたみの既定状態（開いている月のキー集合）を判定する。
 * - 期間で絞り込んでいるとき（hasPeriodFilter=true）：該当する月をすべて開く
 *   （「絞り込んだのに折りたたまれていて見えない」という状態を避けるため）。
 * - 絞り込んでいないとき：当月と前月だけを開く。それより前の月は既定で折りたたむ。
 * referenceDate は呼び出し側の「現在時刻」を明示的に渡す（テストで固定するため既定値は持たない）。
 */
export function defaultOpenMonthKeys(
  monthKeys: string[],
  referenceDate: Date,
  hasPeriodFilter: boolean,
): Set<string> {
  if (hasPeriodFilter) return new Set(monthKeys);
  const currentKey = formatMonthKey(referenceDate.getFullYear(), referenceDate.getMonth());
  const prevDate = new Date(referenceDate.getFullYear(), referenceDate.getMonth() - 1, 1);
  const previousKey = formatMonthKey(prevDate.getFullYear(), prevDate.getMonth());
  return new Set(monthKeys.filter(key => key === currentKey || key === previousKey));
}
