// src/lib/date/holidays.ts
// 日本の祝日判定の薄いラッパー。アプリ側は必ずこの isHoliday() 経由で祝日判定し、
// 祝日ライブラリ（japanese-holidays）を直接あちこちで呼ばない（将来の差し替えを容易にする）。
//
// 採用ライブラリ：japanese-holidays（依存ゼロ・純JS・振替休日/ハッピーマンデー/春分秋分の
// 計算式を含む・アルゴリズム計算のため祝日法改正にも比較的追従しやすい）。
// オフライン検証（2026-07-24・CLAUDE.md v3.05）：npm registry / unpkg 上のソース
// （index.js・lib/japanese-holidays.js）を確認し、http/https/fetch/XMLHttpRequest/net等の
// ネットワークアクセスコードが存在しないこと・実行時依存が0件であることを確認済み。

import * as JapaneseHolidays from "japanese-holidays";
import { toDate } from "../date";

/**
 * 日付文字列（YYYY-MM-DD）が祝日かどうかを判定する。
 * 振替休日を含めて判定し、祝日なら祝日名、そうでなければ null を返す。
 * 無効な日付文字列も null を返す（呼び出し側でのエラーハンドリングを不要にする）。
 */
export function isHoliday(dateStr: string): string | null {
  const d = toDate(dateStr);
  if (!d) return null;
  return JapaneseHolidays.isHoliday(d, true) ?? null;
}
