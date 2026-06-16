// src/lib/date.ts
// 日付操作ユーティリティ。全Viewで共有する。

/** 今日の日付を YYYY-MM-DD 形式で返す（ローカルタイムゾーン基準） */
export function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 文字列・null から Date を安全に生成する。無効な値は null を返す */
export function toDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  d.setHours(0, 0, 0, 0);
  return isNaN(d.getTime()) ? null : d;
}

/** Date を YYYY-MM-DD 形式の文字列に変換する（ローカルタイムゾーン基準） */
export function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Date に n 日加算して新しい Date を返す */
export function addDays(base: Date, n: number): Date {
  const r = new Date(base);
  r.setDate(r.getDate() + n);
  return r;
}

/** 今日から n 日後の日付を YYYY-MM-DD 形式で返す */
export function addDaysFromToday(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}

/** 2つの日付の差（日数）を返す。b - a の符号 */
export function diffDays(a: Date | string, b: Date | string): number {
  // new Date("YYYY-MM-DD") は UTC midnight を返すが toDate() はローカル midnight を返す。
  // 混在させると最大 ±0.5 日のずれが生じるため、文字列は toDate() で統一する。
  const da = typeof a === "string" ? (toDate(a) ?? new Date(a)) : a;
  const db = typeof b === "string" ? (toDate(b) ?? new Date(b)) : b;
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}

/** 今日から指定日付までの日数差を返す（過去は負値） */
export function diffDaysFromToday(s: string): number {
  return diffDays(todayStr(), s);
}

/** Date を「YYYY年M月」形式に変換する */
export function formatYM(d: Date): string {
  return `${d.getFullYear()}年${d.getMonth() + 1}月`;
}

/** 日付文字列を「M/D」形式に変換する */
export function formatMD(s: string): string {
  const d = toDate(s);
  if (!d) return "";
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * 日付（YYYY-MM-DD）→ 暦四半期（"1Q"〜"4Q"）。
 * CLAUDE.md Section 6-14 のルールに従う：
 * 1Q=1〜3月 / 2Q=4〜6月 / 3Q=7〜9月 / 4Q=10〜12月
 * 無効な値や null には null を返す。
 */
export function dateToQuarter(s: string | null | undefined): "1Q" | "2Q" | "3Q" | "4Q" | null {
  const d = toDate(s ?? null);
  if (!d) return null;
  const m = d.getMonth() + 1;
  if (m <= 3)  return "1Q";
  if (m <= 6)  return "2Q";
  if (m <= 9)  return "3Q";
  return "4Q";
}

/** 今日が属する四半期を返す */
export function currentQuarter(): "1Q" | "2Q" | "3Q" | "4Q" {
  return dateToQuarter(todayStr()) ?? "1Q";
}

/** start〜end の全日付を配列で返す（両端含む） */
export function getDaysInRange(start: Date, end: Date): Date[] {
  const days: Date[] = [];
  let cur = new Date(start);
  cur.setHours(0, 0, 0, 0);
  const endN = new Date(end);
  endN.setHours(0, 0, 0, 0);
  while (cur <= endN) {
    days.push(new Date(cur));
    cur = addDays(cur, 1);
  }
  return days;
}
